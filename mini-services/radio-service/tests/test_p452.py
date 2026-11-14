# -*- coding: utf-8 -*-
"""
Тесты этапа 2.3 «Интерференция C/I»: вендоренный P.452-18 (p452_port)
и эндпоинт /api/interference.

Два слоя:
1. Dispatch-тесты — на СИНТЕТИЧЕСКОМ npz (постоянные сетки DN50/N050,
   121×241, шаг 1.5° — размеры как у карт ITU): проверяют механику
   эндпоинта и bt_loss. CI запускает их всегда (карт ITU в CI нет).
2. Эталонная валидация — CSV-профили и ожидаемые Lb из официальных
   validation examples ITU-R SG3 (копия в tests/p452_validation_examples/,
   вендорится вместе с Py452). Запускаются только когда собран P452.npz
   из РЕАЛЬНЫХ карт (иначе — skip: синтетические карты не годятся для
   эталонных значений).
"""
import csv
import importlib
import os
import sys
from pathlib import Path

import numpy as np
import pytest

Svc = Path(__file__).resolve().parent.parent  # каталог radio-service
sys.path.insert(0, str(Svc))


def _make_synthetic_npz(path: Path) -> None:
    """Синтетический P452.npz: постоянные сетки DN50/N050 (шаг 1.5°,
    121×241 — как у карт ITU). Значения — правдоподобные константы
    (ΔN ≈ 40, N0 ≈ 320), результаты расчёта при них НЕ эталонные."""
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(path, DN50=np.full((121, 241), 40.0), N050=np.full((121, 241), 320.0))


@pytest.fixture()
def client_p452(tmp_path, monkeypatch):
    """TestClient с синтетическим P452.npz — механика /api/interference."""
    npz = tmp_path / "p452" / "P452.npz"
    _make_synthetic_npz(npz)
    monkeypatch.setenv("RADIO_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("RADIO_P452_NPZ", str(npz))
    import main as svc

    importlib.reload(svc)
    from fastapi.testclient import TestClient

    with TestClient(svc.app) as c:
        yield c
    importlib.reload(svc)  # восстановить привязки к реальному DATA_DIR


@pytest.fixture()
def client_no_p452(tmp_path, monkeypatch):
    """TestClient БЕЗ P452.npz — проверка «недоступен» (ожидаемо без карт ITU)."""
    monkeypatch.setenv("RADIO_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("RADIO_P452_NPZ", str(tmp_path / "нет" / "P452.npz"))
    for mod in ("p452_port", "p452_port.P452"):
        sys.modules.pop(mod, None)
    import main as svc

    importlib.reload(svc)
    from fastapi.testclient import TestClient

    with TestClient(svc.app) as c:
        yield c
    importlib.reload(svc)
    for mod in ("p452_port", "p452_port.P452"):
        sys.modules.pop(mod, None)


def _flat_profile(length_km: float, n: int = 12, base_m: float = 50.0):
    """Плоский профиль без clutter: d (км, от 0), h (м), g = h."""
    d = [round(length_km * i / (n - 1), 4) for i in range(n)]
    h = [base_m] * n
    return d, h, [x for x in h]


def _payload() -> dict:
    d, h, g = _flat_profile(10.0)
    return {
        "frequencyMhz": 2400,
        "polarization": "vertical",
        "p": [50, 1],
        "zone": 2,
        "paths": [
            {
                "id": "forward",
                "source": {"lat": 55.0, "lon": 37.0},
                "victim": {"lat": 55.1, "lon": 37.2},
                "txHeightM": 30,
                "rxHeightM": 10,
                "profile": {"d": d, "h": h, "g": g},
            }
        ],
    }


class TestP452Direct:
    """bt_loss напрямую (синтетические карты): детерминизм и базовые свойства."""

    def test_bt_loss_runs_and_deterministic(self, monkeypatch, tmp_path):
        npz = tmp_path / "P452.npz"
        _make_synthetic_npz(npz)
        monkeypatch.setenv("RADIO_P452_NPZ", str(npz))
        for mod in ("p452_port", "p452_port.P452"):
            sys.modules.pop(mod, None)
        try:
            from p452_port import bt_loss

            d, h, g = _flat_profile(10.0)
            zone = np.asarray([2] * len(d))
            args = (1.0, 50, np.asarray(d), np.asarray(h), np.asarray(g), zone, 30, 10,
                    37.0, 55.0, 37.2, 55.1, 0, 0, 2, 0, 0, 1013, 15)
            l1 = bt_loss(*args)
            l2 = bt_loss(*args)
            assert 60 < l1 < 220  # разумный диапазон базовых потерь
            assert l1 == l2  # детерминизм
        finally:
            for mod in ("p452_port", "p452_port.P452"):
                sys.modules.pop(mod, None)

    def test_short_term_loss_not_lower_than_median(self, monkeypatch, tmp_path):
        """P.452: потери, не превышаемые 1 % времени, не выше медианных 50 %
        (усиление связи на малых p — усиление помехи)."""
        npz = tmp_path / "P452.npz"
        _make_synthetic_npz(npz)
        monkeypatch.setenv("RADIO_P452_NPZ", str(npz))
        for mod in ("p452_port", "p452_port.P452"):
            sys.modules.pop(mod, None)
        try:
            from p452_port import bt_loss

            d, h, g = _flat_profile(40.0, n=16)
            zone = np.asarray([2] * len(d))
            common = (2.4, np.asarray(d), np.asarray(h), np.asarray(g), zone, 30, 10,
                      37.0, 55.0, 37.3, 55.2, 0, 0, 2, 0, 0, 1013, 15)
            l50 = bt_loss(*common[:1], 50, *common[1:])
            l1 = bt_loss(*common[:1], 1, *common[1:])
            assert l1 <= l50 + 1e-6
        finally:
            for mod in ("p452_port", "p452_port.P452"):
                sys.modules.pop(mod, None)

    def test_profile_too_short_raises(self, monkeypatch, tmp_path):
        npz = tmp_path / "P452.npz"
        _make_synthetic_npz(npz)
        monkeypatch.setenv("RADIO_P452_NPZ", str(npz))
        for mod in ("p452_port", "p452_port.P452"):
            sys.modules.pop(mod, None)
        try:
            from p452_port import bt_loss

            d, h, g = _flat_profile(10.0, n=3)
            with pytest.raises(ValueError):
                bt_loss(1.0, 50, np.asarray(d), np.asarray(h), np.asarray(g), np.asarray([2, 2, 2]), 30, 10,
                        37.0, 55.0, 37.2, 55.1, 0, 0, 2, 0, 0, 1013, 15)
        finally:
            for mod in ("p452_port", "p452_port.P452"):
                sys.modules.pop(mod, None)


class TestInterferenceDispatch:
    def test_capabilities_and_health(self, client_p452):
        caps = client_p452.get("/api/capabilities").json()
        assert caps["p452"]["available"] is True
        health = client_p452.get("/api/health").json()
        assert health["p452"] is True

    def test_interference_ok(self, client_p452):
        res = client_p452.post("/api/interference", json=_payload())
        assert res.status_code == 200
        data = res.json()
        assert data["engineUsed"].startswith("P.452-18")
        fwd = data["results"]["forward"]
        assert set(fwd.keys()) == {"50", "1"}
        # потери на 10 км 2.4 ГГц — в разумном диапазоне
        assert 60 < fwd["50"] < 220
        assert fwd["1"] <= fwd["50"] + 1e-6

    def test_interference_validation_errors(self, client_p452):
        bad = _payload()
        bad["frequencyMhz"] = 100
        assert client_p452.post("/api/interference", json=bad).status_code == 422
        bad2 = _payload()
        bad2["paths"][0]["profile"]["d"] = bad2["paths"][0]["profile"]["d"][:2]
        bad2["paths"][0]["profile"]["h"] = bad2["paths"][0]["profile"]["h"][:2]
        bad2["paths"][0]["profile"]["g"] = bad2["paths"][0]["profile"]["g"][:2]
        assert client_p452.post("/api/interference", json=bad2).status_code == 422
        bad3 = _payload()
        bad3["zone"] = 7
        assert client_p452.post("/api/interference", json=bad3).status_code == 422

    def test_unavailable_without_npz(self, client_no_p452):
        caps = client_no_p452.get("/api/capabilities").json()
        assert caps["p452"]["available"] is False
        assert health_ok(client_no_p452) is False
        res = client_no_p452.post("/api/interference", json=_payload())
        assert res.status_code == 400
        assert "P.452 недоступен" in res.json()["detail"]


def health_ok(client) -> bool:
    return client.get("/api/health").json()["p452"] is True


# ---------- Эталонная валидация SG3 (только с реальными картами ITU) ----------

EX_DIR = Svc / "tests" / "p452_validation_examples"
REAL_NPZ = Path(os.environ.get("RADIO_P452_NPZ", str(Svc / "data" / "p452" / "P452.npz")))

needs_real_maps = pytest.mark.skipif(
    not REAL_NPZ.exists(),
    reason="P452.npz из реальных карт ITU не собран — скачайте N050/DN50 "
    "(scripts/download_p452_maps.ps1) и запустите scripts/build_p452_npz.py",
)


def _load_profile_rows(path: Path):
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.reader(f))
    out = []
    for row in rows[1:]:
        if not row or len(row) < 5:
            continue
        out.append((float(row[0]), float(row[1]), float(row[2]), int(float(row[4]))))
    return out


def _load_result_rows(path: Path):
    """Заголовок official-файла содержит единицы ('f (GHz)', 'p (%)') —
    ключи нормализуются к первому слову в нижнем регистре ('f', 'p', 'lb')."""
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.reader(f))
    header = rows[0]
    idx = {cell.split()[0].lower(): i for i, cell in enumerate(header) if cell.strip()}
    out = []
    for row in rows[1:]:
        if not row or len(row) < len(header):
            continue
        out.append({k: row[i] for k, i in idx.items()})
    return out


@needs_real_maps
class TestP452ValidationExamples:
    """Эталонная валидация ITU-R SG3: ожидаемые Lb из официальных examples."""

    TOL_DB = 0.1  # практика SG3: |Δ| ≤ 0.1 дБ

    def test_validation_examples(self, monkeypatch):
        # p452_port читает npz по env при импорте: направляем на РЕАЛЬНЫЙ npz
        # (собранный из карт ITU) и сбрасываем кеш модулей — в этом процессе
        # p452_port мог быть уже импортирован с синтетическим npz dispatch-тестов
        monkeypatch.setenv("RADIO_P452_NPZ", str(REAL_NPZ))
        for mod in ("p452_port", "p452_port.P452"):
            sys.modules.pop(mod, None)
        pytest.importorskip("p452_port")
        profiles = sorted((EX_DIR / "profiles").glob("*.csv"))
        assert profiles, "Нет эталонных профилей в tests/p452_validation_examples"
        checked = 0
        for prof_path in profiles:
            res_path = EX_DIR / "results" / prof_path.name.replace("test_profile", "test_result")
            if not res_path.exists():
                continue
            pts = _load_profile_rows(prof_path)
            d = np.asarray([p[0] for p in pts])
            h = np.asarray([p[1] for p in pts])
            g = np.asarray([p[1] + p[2] for p in pts])
            zone = np.asarray([p[3] for p in pts])
            from p452_port import bt_loss

            for row in _load_result_rows(res_path):
                expected = float(row["lb"])
                got = bt_loss(
                    float(row["f"]), float(row["p"]), d, h, g, zone,
                    float(row["htg"]), float(row["hrg"]),
                    float(row["phit_e"]), float(row["phit_n"]),
                    float(row["phir_e"]), float(row["phir_n"]),
                    float(row["gt"]), float(row["gr"]),
                    int(float(row["pol"])), float(row["dct"]), float(row["dcr"]),
                    float(row["press"]), float(row["temp"]),
                )
                assert abs(got - expected) <= self.TOL_DB, (
                    f"{prof_path.name}: f={row['f']} p={row['p']} — {got:.3f} vs {expected:.3f} дБ"
                )
                checked += 1
        assert checked > 50, f"Слишком мало эталонных строк проверено: {checked}"

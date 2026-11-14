# -*- coding: utf-8 -*-
"""
Тесты роадмапа 2.6 «Полная P.2001-6»: вендоренный порт Py2001 (p2001_port),
адаптер p2001_model и ветка p2001 в /api/calculate.

Два слоя:
1. Dispatch/адаптер — на СИНТЕТИЧЕСКОМ npz (постоянные сетки 14 таблиц
   P.2001-6, размеры как у карт ITU): механика эндпоинта, адаптера и
   fallback на lite без координат. CI запускает их всегда (карт ITU в CI нет).
2. Эталонная валидация — официальные validation examples ITU-R SG3
   (копия в tests/p2001_validation_examples/, вендорится вместе с Py2001:
   профили b2iseac и prof4, 2215 строк результатов на каждый). Запускаются
   только когда собран P2001.npz из РЕАЛЬНЫХ карт (иначе — skip:
   синтетические карты не годятся для эталонных значений).
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

# Ключи P2001.npz (как в initiate_digital_maps.py оригинального Py2001)
SYNTH_MAPS = {
    "DN_Median": 40.0,
    "DN_SubSlope": 8.0,
    "DN_SupSlope": 8.0,
    "dndz_01": -250.0,
    "Esarain_Mt_v5": 20.0,
    "Esarain_Pr6_v5": 30.0,
    "Esarain_Beta_v5": 0.05,
    "FoEs0p1": 5.0,
    "FoEs01": 5.0,
    "FoEs10": 5.0,
    "FoEs50": 5.0,
    "h0": 2.5,
    "surfwv_50_fixed": 10.0,
}


def _make_synthetic_npz(path: Path) -> None:
    """Синтетический P2001.npz: постоянные сетки (121×241, шаг 1.5°, TropoClim
    360×720 — размеры как у карт ITU). Значения правдоподобные константы,
    результаты при них НЕ эталонные — только механика."""
    path.parent.mkdir(parents=True, exist_ok=True)
    maps = {k: np.full((121, 241), v) for k, v in SYNTH_MAPS.items()}
    maps["TropoClim"] = np.full((360, 720), 6, dtype=int)
    np.savez(path, **maps)


@pytest.fixture()
def client_p2001(tmp_path, monkeypatch):
    """TestClient с синтетическим P2001.npz — механика /api/calculate."""
    npz = tmp_path / "p2001" / "P2001.npz"
    _make_synthetic_npz(npz)
    monkeypatch.setenv("RADIO_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("RADIO_P2001_NPZ", str(npz))
    for mod in ("p2001_port", "p2001_port.P2001"):
        sys.modules.pop(mod, None)
    import main as svc

    importlib.reload(svc)
    from fastapi.testclient import TestClient

    with TestClient(svc.app) as c:
        yield c
    importlib.reload(svc)  # восстановить привязки к реальному DATA_DIR
    for mod in ("p2001_port", "p2001_port.P2001"):
        sys.modules.pop(mod, None)


@pytest.fixture()
def client_no_p2001(tmp_path, monkeypatch):
    """TestClient БЕЗ P2001.npz — проверка fallback на P.2001-lite."""
    monkeypatch.setenv("RADIO_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("RADIO_P2001_NPZ", str(tmp_path / "нет" / "P2001.npz"))
    for mod in ("p2001_port", "p2001_port.P2001"):
        sys.modules.pop(mod, None)
    import main as svc

    importlib.reload(svc)
    from fastapi.testclient import TestClient

    with TestClient(svc.app) as c:
        yield c
    importlib.reload(svc)
    for mod in ("p2001_port", "p2001_port.P2001"):
        sys.modules.pop(mod, None)


def _default_input(distance_m: float = 10000.0, with_points: bool = True) -> dict:
    """Дефолтный ввод /api/calculate: плоский профиль, Москва, 2400 МГц."""
    n = 112  # шаг ~90 м, как SRTM
    profile = [
        {"d": round(distance_m * i / (n - 1), 1), "elev": 150.0, "clutter": 0, "total": 150.0}
        for i in range(n)
    ]
    path: dict = {"distanceM": distance_m, "profile": profile}
    if with_points:
        path["points"] = [{"lat": 55.7558, "lon": 37.6173}, {"lat": 55.8305, "lon": 37.8501}]
    return {
        "frequencyMhz": 2400,
        "polarization": "vertical",
        "path": path,
        "txHeightM": 10,
        "rxHeightM": 1.5,
        "timePercents": [50, 90, 99, 99.9],
        "kFactor": 4 / 3,
        "atmosphere": {},
        "epsilon": 15,
        "sigma": 0.005,
        "climateZone": "K",
    }


# ---------- Dispatch: /api/calculate и health/capabilities ----------


class TestP2001Dispatch:
    """Механика ветки p2001 в /api/calculate на синтетическом npz."""

    def test_full_model_with_coordinates(self, client_p2001):
        r = client_p2001.post("/api/calculate", json={"model": "p2001", "input": _default_input()})
        assert r.status_code == 200, r.text
        prop = r.json()["propagation"]
        assert "P.2001-6" in prop["engineUsed"]
        assert prop["model"] == "p2001"
        # Разбивка: FSPL числом, избыточные потери ≥ 0, дождь/газы внутри Lb (нет в extraLoss)
        assert isinstance(prop["breakdown"]["freeSpaceDb"], float)
        assert prop["breakdown"]["diffractionDb"] >= 0
        assert "rainDb" not in prop["breakdown"] or prop["breakdown"]["rainDb"] is None
        # Медиана правдоподобна: FSPL(10 км, 2.4 ГГц) ≈ 120 дБ, полная модель выше
        assert 100 < prop["medianLossDb"] < 220
        # Квантили: потери убывают с ростом p (усиление) — по порядку в списке
        by_time = prop["byTimePercent"]
        assert [b["percent"] for b in by_time] == [50, 90, 99, 99.9]
        losses = [b["lossDb"] for b in by_time]
        assert losses[0] >= losses[1] >= losses[2] >= losses[3]

    def test_fallback_lite_without_coordinates(self, client_p2001):
        inp = _default_input(with_points=False)
        r = client_p2001.post("/api/calculate", json={"model": "p2001", "input": inp})
        assert r.status_code == 200, r.text
        prop = r.json()["propagation"]
        assert "P.2001-lite" in prop["engineUsed"]
        assert any("P.2001-6 недоступна" in w for w in prop["warnings"])

    def test_health_and_capabilities_with_synthetic(self, client_p2001):
        assert client_p2001.get("/api/health").json()["py2001"] is True
        caps = client_p2001.get("/api/capabilities").json()["p2001"]
        assert caps["available"] is True
        assert caps["supportsMaps"] is True
        assert "P.2001-6" in caps["engine"]

    def test_health_and_capabilities_without_npz(self, client_no_p2001):
        assert client_no_p2001.get("/api/health").json()["py2001"] is False
        caps = client_no_p2001.get("/api/capabilities").json()["p2001"]
        assert caps["available"] is True  # lite всегда доступна
        assert caps["supportsMaps"] is False
        assert "P.2001-lite" in caps["engine"]

    def test_lite_used_without_npz(self, client_no_p2001):
        r = client_no_p2001.post("/api/calculate", json={"model": "p2001", "input": _default_input()})
        assert r.status_code == 200, r.text
        assert "P.2001-lite" in r.json()["propagation"]["engineUsed"]


class TestP2001Adapter:
    """Адаптер p2001_model.calculate_full на синтетическом npz."""

    def _calc(self, inp: dict) -> dict:
        from p2001_model import calculate_full

        return calculate_full(inp)

    def test_sanity_and_structure(self):
        r = self._calc(_default_input())
        assert r["model"] == "p2001"
        assert 100 < r["medianLossDb"] < 220
        assert r["breakdown"]["freeSpaceDb"] == pytest.approx(120.05, abs=0.1)  # FSPL 10 км/2.4 ГГц
        assert r["breakdown"]["diffractionDb"] == pytest.approx(
            r["medianLossDb"] - r["breakdown"]["freeSpaceDb"], abs=1e-9
        )

    def test_missing_points_raises(self):
        with pytest.raises(ValueError, match="path.points"):
            self._calc(_default_input(with_points=False))

    def test_circular_polarization_warning(self):
        inp = _default_input()
        inp["polarization"] = "circular"
        r = self._calc(inp)
        assert any("круговая поляризация" in w.lower() for w in r["warnings"])

    def test_clutter_warning(self):
        inp = _default_input()
        inp["path"]["profile"][10]["clutter"] = 12.0
        inp["path"]["profile"][10]["total"] = inp["path"]["profile"][10]["elev"] + 12.0
        r = self._calc(inp)
        assert any("Clutter" in w for w in r["warnings"])

    def test_zones_mismatch_falls_back_to_inland(self):
        inp = _default_input()
        inp["zones"] = [1, 3]  # не соответствует длине профиля
        r = self._calc(inp)
        assert any("зона 4" in w for w in r["warnings"])
        assert 100 < r["medianLossDb"] < 220

    def test_duplicate_distances_deduplicated(self):
        inp = _default_input()
        inp["path"]["profile"][5]["d"] = inp["path"]["profile"][4]["d"]  # дубликат
        r = self._calc(inp)
        assert 100 < r["medianLossDb"] < 220

    def test_short_path_accuracy_warning(self):
        # bt_loss требует > 10 точек профиля: 500 м с шагом 45 м = 12 точек
        inp = _default_input(distance_m=500.0)
        inp["path"]["profile"] = [
            {"d": round(500 * i / 11, 1), "elev": 150.0, "clutter": 0, "total": 150.0} for i in range(12)
        ]
        r = self._calc(inp)
        assert any("наибольшей точности" in w for w in r["warnings"])


# ---------- Эталонная валидация SG3 (только с реальными картами ITU) ----------

EX_DIR = Svc / "tests" / "p2001_validation_examples"
REAL_NPZ = Path(os.environ.get("RADIO_P2001_NPZ", str(Svc / "data" / "p2001" / "P2001.npz")))

needs_real_maps = pytest.mark.skipif(
    not REAL_NPZ.exists(),
    reason="P2001.npz из реальных карт ITU не собран — скачайте 14 таблиц "
    "P.2001-6 (scripts/download_p2001_maps.ps1) и запустите scripts/build_p2001_npz.py",
)


def _load_profile(path: Path):
    """Профиль: 9 строк заголовка, далее d (км), h (м), z (зона 1/3/4)."""
    with open(path, encoding="utf-8", newline="") as f:
        rows = list(csv.reader(f))[9:]
    pts = [(float(r[0]), float(r[1]), int(r[2])) for r in rows if r and len(r) >= 3 and r[0]]
    return (
        np.asarray([p[0] for p in pts]),
        np.asarray([p[1] for p in pts]),
        np.asarray([p[2] for p in pts]),
    )


def _load_results(path: Path):
    with open(path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


@needs_real_maps
class TestP2001ValidationExamples:
    """Эталонная валидация ITU-R SG3: ожидаемые Lb из официальных examples
    (как tests/validateP2001.py оригинального Py2001)."""

    TOL_DB = 1e-6  # допуск валидатора Py2001

    @pytest.mark.parametrize("profile_name", ["b2iseac", "prof4"])
    def test_validation_profile(self, monkeypatch, profile_name):
        # p2001_port читает npz по env при импорте: направляем на РЕАЛЬНЫЙ npz
        # (собранный из карт ITU) и сбрасываем кеш модулей — в этом процессе
        # p2001_port мог быть уже импортирован с синтетическим npz
        monkeypatch.setenv("RADIO_P2001_NPZ", str(REAL_NPZ))
        for mod in ("p2001_port", "p2001_port.P2001"):
            sys.modules.pop(mod, None)
        pytest.importorskip("p2001_port")
        prof_path = EX_DIR / f"Validation_examples_ITU-R_P_2001_{profile_name}_profile.csv"
        res_path = EX_DIR / f"Validation_examples_ITU-R_P_2001_{profile_name}_results.csv"
        assert prof_path.exists() and res_path.exists()
        d, h, z = _load_profile(prof_path)
        from p2001_port import bt_loss

        worst, worst_row, checked = 0.0, None, 0
        for row in _load_results(res_path):
            got = bt_loss(
                d, h, z, float(row["GHz"]), float(row["Tpc"]),
                float(row["Phire"]), float(row["Phirn"]),
                float(row["Phite"]), float(row["Phitn"]),
                float(row["Hrg"]), float(row["Htg"]),
                float(row["Grx"]), float(row["Gtx"]),
                int(float(row["FlagVp"])),
            )
            delta = abs(got - float(row["Lb"]))
            if delta > worst:
                worst, worst_row = delta, (row["GHz"], row["Tpc"])
            checked += 1
        assert checked > 2000, f"Слишком мало эталонных строк: {checked}"
        assert worst <= self.TOL_DB, (
            f"{profile_name}: макс |Δ| = {worst:.2e} дБ (GHz={worst_row[0]}, Tpc={worst_row[1]})"
        )

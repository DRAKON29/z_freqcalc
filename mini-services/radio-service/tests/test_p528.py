# -*- coding: utf-8 -*-
"""
Тесты роадмапа 3.5 «Сравнение с P.528»: вендоренный порт PyP528 (p528_port)
и адаптер p528_model + эндпоинт /api/calculate (model=p528).

Два слоя:
1. Dispatch/адаптер — порт P.528 НЕ требует цифровых карт (гладкая сфера,
   атмосферные профили P.835 внутри): тесты всегда доступны, в CI в том числе.
2. Эталонная валидация — официальные Data Tables ITU-R P.528-5 (ZIP-E,
   копия в tests/p528_validation_examples/, не распространяется —
   scripts/download_p528_tables.ps1 или шаг CI). Skip, если таблиц нет.
"""
import csv
import importlib
import sys
from pathlib import Path

import pytest

Svc = Path(__file__).resolve().parent.parent  # каталог radio-service
sys.path.insert(0, str(Svc))


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """TestClient со стандартным DATA_DIR (P.528 карт не требует)."""
    monkeypatch.setenv("RADIO_DATA_DIR", str(tmp_path))
    import main as svc

    importlib.reload(svc)
    from fastapi.testclient import TestClient

    with TestClient(svc.app) as c:
        yield c
    importlib.reload(svc)


def _input(distance_m: float = 100000.0, tx_h: float = 30.0, rx_h: float = 3000.0, **overrides) -> dict:
    n = 50
    profile = [
        {"d": round(distance_m * i / (n - 1), 1), "elev": 150.0, "clutter": 0, "total": 150.0}
        for i in range(n)
    ]
    inp = {
        "frequencyMhz": 2400,
        "polarization": "vertical",
        "path": {
            "distanceM": distance_m,
            "profile": profile,
            "points": [{"lat": 55.0, "lon": 37.0}, {"lat": 55.9, "lon": 37.0}],
        },
        "txHeightM": tx_h,
        "rxHeightM": rx_h,
        "timePercents": [50, 90, 99, 99.9],
        "kFactor": 4 / 3,
        "atmosphere": {},
        "epsilon": 15,
        "sigma": 0.005,
        "climateZone": "K",
    }
    inp.update(overrides)
    return inp


class TestP528Adapter:
    """Адаптер p528_model.calculate_full (порт всегда доступен)."""

    def _calc(self, inp: dict) -> dict:
        from p528_model import calculate_full

        return calculate_full(inp)

    def test_los_sanity(self):
        """Короткая LOS-трасса над гладкой сферой ≈ FSPL + газы (P.676)."""
        r = self._calc(_input(distance_m=30000, tx_h=30, rx_h=3000))
        assert r["model"] == "p528"
        # FSPL(30 км, 2.4 ГГц) = 119.5 дБ; LOS P.528 близко к нему
        assert abs(r["medianLossDb"] - r["breakdown"]["freeSpaceDb"]) < 2.0
        assert r["breakdown"]["diffractionDb"] >= 0

    def test_transhorizon_far_and_high(self):
        """Перегоризонтная трасса 400 км: потери заметно выше FSPL, режим 2/3."""
        r = self._calc(_input(distance_m=400000, tx_h=30, rx_h=3000))
        assert r["medianLossDb"] > r["breakdown"]["freeSpaceDb"] + 20

    def test_time_percent_direction(self):
        """Клиентская конвенция «превышаются p%»: потери убывают с ростом p."""
        r = self._calc(_input(distance_m=400000))
        losses = [b["lossDb"] for b in r["byTimePercent"]]
        assert losses[0] >= losses[1] >= losses[2]

    def test_terrain_not_used_warning(self):
        r = self._calc(_input())
        assert any("гладкой" in w for w in r["warnings"])

    def test_height_clamped(self):
        r = self._calc(_input(rx_h=0.5))  # ниже 1.5 м
        assert any("зажата" in w for w in r["warnings"])

    def test_terminals_swapped(self):
        r = self._calc(_input(tx_h=10000, rx_h=30))
        assert any("переставлены" in w for w in r["warnings"])

    def test_percent_clamped(self):
        r = self._calc(_input())
        # 99.9 % → Tpc 0.1 % — вне 1..99, зажим с предупреждением
        assert any("зажаты" in w for w in r["warnings"])

    def test_zero_distance_raises(self):
        with pytest.raises(ValueError, match="положительную"):
            self._calc(_input(distance_m=0))


class TestP528Dispatch:
    """Ветка p528 в /api/calculate и health/capabilities."""

    def test_health_and_capabilities(self, client):
        assert client.get("/api/health").json()["p528"] is True
        caps = client.get("/api/capabilities").json()["p528"]
        assert caps["available"] is True
        assert "P.528-5" in caps["engine"]

    def test_calculate_endpoint(self, client):
        r = client.post("/api/calculate", json={"model": "p528", "input": _input()})
        assert r.status_code == 200, r.text
        prop = r.json()["propagation"]
        assert "P.528-5" in prop["engineUsed"]
        assert prop["model"] == "p528"
        assert 100 < prop["medianLossDb"] < 300

    def test_zero_distance_is_422(self, client):
        # d=0 отвергает валидация сервиса (10 м…300 км) до входа в модель
        r = client.post("/api/calculate", json={"model": "p528", "input": _input(distance_m=0)})
        assert r.status_code == 422


# ---------- Эталонная валидация (Data Tables ITU-R P.528-5) ----------

EX_DIR = Svc / "tests" / "p528_validation_examples"
needs_tables = pytest.mark.skipif(
    not any(EX_DIR.glob("*.csv")),
    reason="Таблицы ITU-R P.528-5 не скачаны — scripts/download_p528_tables.ps1 "
    "(или шаг CI); ZIP-E со страницы рекомендации P.528-5",
)


@needs_tables
class TestP528ValidationTables:
    """Эталонная валидация по официальным таблицам ITU-R P.528-5.

    Таблицы округлены до 0.1 дБ. Известные расхождения PyP528 0.1.0 (трёхсторонняя
    сверка 2026-11-14, 648 точек): медианы порт воспроизводит в пределах ~0.5 дБ;
    хвосты распределения (q = 0.01/0.95) расходятся с эталоном до ~7 дБ, при этом
    и эталонный C++ NTIA расходится с таблицами до 4.2 дБ на тех же точках.
    Допуск: медианы ±1.5 дБ, хвосты ±8 дБ; частоты — рабочий диапазон сервиса
    (500–7000 МГц). Выборка: 3 частоты × 5 квантилей × все пары (h1, h2)
    × 2 дальности — счётчик проверенных точек > 400.
    """

    TOL_MEDIAN_DB = 1.5
    TOL_TAIL_DB = 8.0
    FREQS = [600, 2400, 5100]
    DISTANCES = {300, 1000}

    def test_validation_tables(self):
        from p528_port import p528

        csv_files = sorted(EX_DIR.glob("*.csv"))
        assert len(csv_files) >= 20, f"Слишком мало таблиц: {len(csv_files)}"
        checked, worst, worst_case, bad = 0, 0.0, None, []
        for path in csv_files:
            stem = path.stem  # «2,400 MHz - Lb(0.50)_P528»
            freq = float(stem.split(" MHz")[0].replace(",", ""))
            q = float(stem.split("Lb(")[1].split(")")[0])
            if freq not in self.FREQS:
                continue
            rows = list(csv.reader(open(path, encoding="utf-8-sig")))
            h2 = rows[1][2:]
            h1 = rows[2][2:]
            for col in range(2, 2 + len(h2)):
                for row in rows[4:]:
                    if not row or not row[0].strip().isdigit():
                        continue
                    d = int(row[0])
                    if d not in self.DISTANCES:
                        continue
                    expected = float(row[col])
                    th1, th2 = float(h1[col - 2]), float(h2[col - 2])
                    if th1 == th2:
                        # порт вырождается при h1 == h2 (a__km = 0); модель
                        # непрерывна — 0.1 м воспроизводит табличное значение
                        # (внутри границ диапазона: вниз от h1, иначе вверх)
                        if th1 - 0.1 >= 1.5:
                            th1 = th1 - 0.1
                        else:
                            th2 = th2 + 0.1
                    got = p528(
                        d__km=float(d),
                        h_1__meter=th1,
                        h_2__meter=th2,
                        f__mhz=freq,
                        T_pol=1,
                        p=q * 100,
                    ).A__db
                    delta = abs(got - expected)
                    tol = self.TOL_MEDIAN_DB if q == 0.5 else self.TOL_TAIL_DB
                    checked += 1
                    if delta > worst:
                        worst, worst_case = delta, (freq, q, d, h1[col - 2], h2[col - 2], round(got, 2), expected)
                    if delta > tol:
                        bad.append((freq, q, d, th1, th2, round(got, 2), expected, delta))
        assert checked > 400, f"Слишком мало эталонных точек: {checked}"
        assert not bad, (
            "Точки вне допуска (первые 5): "
            + "; ".join(f"f={b[0]} q={b[1]} d={b[2]} h=({b[3]},{b[4]}): {b[5]} vs {b[6]} (Δ={b[7]:.2f})" for b in bad[:5])
        )
        assert worst <= self.TOL_TAIL_DB, (
            f"макс |Δ| = {worst:.3f} дБ (f={worst_case[0]}, q={worst_case[1]}, "
            f"d={worst_case[2]}, h1={worst_case[3]}, h2={worst_case[4]}): "
            f"{worst_case[5]} vs {worst_case[6]}"
        )

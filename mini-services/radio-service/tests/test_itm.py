# -*- coding: utf-8 -*-
"""Тесты модели Longley-Rice ITM (роадмап 2.1): адаптер itm_calculate.

Эталоны получены на синтетических профилях (детерминированы):
  • LOS плоский 10 км @2400 МГц: медиана ≈ FSPL (избыток −0.002 дБ);
  • гора +160 м посередине: медиана 128.69 дБ (избыток +8.64 дБ);
  • за горизонтом 150 км: медиана 199.99 дБ (избыток +56.41 дБ);
  • кривая потерь убывает с ростом p % времени (конвенция ITU/ITU-R).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

from itm_model import itm_calculate, _z_for_percent


def _profile(dist, elev_fn, n=51):
    return [{"d": dist * i / (n - 1), "elev": elev_fn(dist * i / (n - 1)), "clutter": 0} for i in range(n)]


def _input(profile, dist, freq=2400, percents=(50, 90, 99, 99.9)):
    return {
        "frequencyMhz": freq,
        "polarization": "vertical",
        "path": {
            "points": [{"lat": 55.75, "lon": 37.62}, {"lat": 55.8, "lon": 37.62}],
            "distanceM": dist,
            "profile": profile,
        },
        "txHeightM": 30,
        "rxHeightM": 10,
        "timePercents": list(percents),
        "kFactor": 4 / 3,
        "epsilon": 15,
        "sigma": 0.005,
        "climateZone": "K",
        "atmosphere": {"gases": False, "vegetation": False},
    }


class TestItmCalculate:
    def test_los_flat_close_to_fspl(self):
        r = itm_calculate(_input(_profile(10000, lambda d: 100.0), 10000))
        fs = r["breakdown"]["freeSpaceDb"]
        assert fs == pytest.approx(120.05, abs=0.05)
        assert r["medianLossDb"] == pytest.approx(fs, abs=0.05)
        assert r["breakdown"]["diffractionDb"] == pytest.approx(0.0, abs=0.05)

    def test_blocked_hill_reference(self):
        hill = _profile(10000, lambda d: 100.0)
        hill[25]["elev"] = 260.0
        r = itm_calculate(_input(hill, 10000))
        assert r["medianLossDb"] == pytest.approx(128.69, abs=0.05)
        assert r["medianLossDb"] > r["breakdown"]["freeSpaceDb"] + 8

    def test_beyond_horizon_reference(self):
        r = itm_calculate(_input(_profile(150000, lambda d: 100.0, 101), 150000))
        assert r["medianLossDb"] == pytest.approx(199.99, abs=0.15)
        assert r["breakdown"]["diffractionDb"] == pytest.approx(56.4, abs=0.3)

    def test_curve_direction_itu_convention(self):
        """Потери, превышаемые p % времени, убывают с ростом p (p > 50)."""
        hill = _profile(10000, lambda d: 100.0)
        hill[25]["elev"] = 260.0
        r = itm_calculate(_input(hill, 10000))
        losses = [t["lossDb"] for t in r["byTimePercent"]]
        assert losses == sorted(losses, reverse=True)
        assert r["byTimePercent"][0]["percent"] == 50

    def test_result_shape(self):
        r = itm_calculate(_input(_profile(10000, lambda d: 100.0), 10000))
        assert r["model"] == "itm"
        assert set(r) >= {"model", "medianLossDb", "byTimePercent", "breakdown", "engineUsed", "warnings"}
        assert len(r["byTimePercent"]) == 4
        assert any("ITM" in w for w in r["warnings"])
        assert any("континентальный умеренный" in w for w in r["warnings"])

    def test_short_profile_raises(self):
        with pytest.raises(ValueError):
            itm_calculate(_input([{"d": 0, "elev": 100}, {"d": 1000, "elev": 100}], 1000))

    def test_z_for_percent_direction(self):
        """zT = Φ⁻¹(p/100): p<50 → отрицательный (глубокие замирания), p>50 → положительный."""
        assert _z_for_percent(10) < 0
        assert _z_for_percent(50) == pytest.approx(0, abs=1e-9)
        assert _z_for_percent(99) > 0


class TestItmDispatch:
    def test_calculate_endpoint_itm(self):
        """POST /api/calculate с model=itm отдаёт модель itm и доступна в capabilities."""
        from fastapi.testclient import TestClient
        import main as svc

        with TestClient(svc.app) as client:
            caps = client.get("/api/capabilities").json()
            assert caps["itm"]["available"] is True

            body = {
                "model": "itm",
                "input": _input(_profile(10000, lambda d: 100.0), 10000),
            }
            res = client.post("/api/calculate", json=body)
            assert res.status_code == 200
            prop = res.json()["propagation"]
            assert prop["model"] == "itm"
            assert "ITM" in prop["engineUsed"]

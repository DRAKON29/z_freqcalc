"""Тесты reports.py — зеркало availability-отчёта P.530 (те же контрольные, что в TS)."""
import math

import pytest

from reports import (
    HOURS_PER_YEAR,
    availability_report,
    multipath_occurrence_factor,
    multipath_outage_percent,
    rain_attenuation_001_db,
    rain_attenuation_at_percent_db,
    rain_path_reduction_d0_km,
    required_margin_for_availability,
    solve_rain_outage_percent,
)
from p2001_lite import rain_specific_attenuation


def test_multipath_occurrence_factor():
    # зона K: cf = 1.1, d = 50 км → p0 = 0.055 %; 25 км → /8
    assert multipath_occurrence_factor("K", 50) == pytest.approx(0.055, abs=1e-10)
    assert multipath_occurrence_factor("K", 25) == pytest.approx(0.055 / 8, abs=1e-10)


def test_multipath_outage():
    # FM = 20 дБ → 0.055·10⁻² = 5.5e-4 %
    assert multipath_outage_percent(0.055, 20) == pytest.approx(5.5e-4, abs=1e-12)
    assert multipath_outage_percent(0, 20) == 0


def test_rain_path_reduction_d0():
    # R0.01 = 30 → 35·e^(−0.45) = 22.2714 км; 0 → 35; очень сильный дождь → clamp 4
    assert rain_path_reduction_d0_km(30) == pytest.approx(35 * math.exp(-0.45), abs=1e-6)
    assert rain_path_reduction_d0_km(0) == 35
    assert rain_path_reduction_d0_km(200) == 4


def test_rain_attenuation_interpolation():
    # A(1) = 0.12·A001; A(0.01) ≈ 0.9981·A001; A(0.1) = 0.3821·A001
    assert rain_attenuation_at_percent_db(10, 1) == pytest.approx(1.2, abs=1e-9)
    assert rain_attenuation_at_percent_db(10, 0.01) == pytest.approx(9.981, abs=0.01)
    assert rain_attenuation_at_percent_db(10, 0.1) == pytest.approx(3.821, abs=0.01)


def test_rain_attenuation_001_db():
    # γR(30, 6000, V) = 0.0046 дБ/км; d0(30) = 22.271 км → dэфф = 15.408 км
    a001 = rain_attenuation_001_db(50000, 30, 6000, "vertical")
    d0 = rain_path_reduction_d0_km(30)
    assert a001 == pytest.approx(rain_specific_attenuation(30, 6000, "vertical") * (50 / (1 + 50 / d0)), abs=1e-9)


def test_solve_rain_outage():
    a001 = rain_attenuation_001_db(50000, 30, 6000, "vertical")
    # корень 0.043x² + 0.546x + lg(FM/(0.12·A001)) = 0 → p ≈ 0.0241 %
    p = solve_rain_outage_percent(a001, 0.05)
    assert p is not None
    assert p == pytest.approx(0.0241, abs=0.001)
    # FM глубже достижимого → None
    assert solve_rain_outage_percent(a001, 20) is None


def test_required_margin():
    # без дождя: FM = 10·lg(p0/p_out); 99.99 % → 10lg(5.5) = 7.40 дБ; 99.9 % → 0 (p_out > p0)
    assert required_margin_for_availability(0.055, None, 99.99) == pytest.approx(10 * math.log10(5.5), abs=1e-3)
    assert required_margin_for_availability(0.055, None, 99.9) == 0
    # с дождём требуемый запас не меньше
    a001 = rain_attenuation_001_db(50000, 30, 6000, "vertical")
    assert required_margin_for_availability(0.055, a001, 99.99) >= required_margin_for_availability(0.055, None, 99.99)


def test_availability_report_reference():
    # эталон: 50 км, зона K, FM = 20 дБ, дождь пользователя 30 мм/ч, 6000 МГц
    inp = {
        "frequencyMhz": 6000,
        "polarization": "vertical",
        "path": {"distanceM": 50000},
        "climateZone": "K",
        "atmosphere": {"gases": False, "vegetation": False, "rainRateMmH": 30, "rainSource": "user"},
    }
    r = availability_report(inp, 20.0)
    assert r["multipathP0Percent"] == pytest.approx(0.055, abs=1e-10)
    assert r["rainSource"] == "user"
    assert r["rainRate001"] == 30
    assert r["outage"]["multipathPercent"] == pytest.approx(5.5e-4, abs=1e-12)
    assert r["outage"]["rainPercent"] == 0
    assert r["outage"]["totalHoursPerYear"] == pytest.approx(5.5e-4 / 100 * HOURS_PER_YEAR, abs=1e-4)
    t9999 = next(t for t in r["targets"] if t["availabilityPercent"] == 99.99)
    assert t9999["requiredMarginDb"] == pytest.approx(7.4, abs=0.1)
    assert t9999["met"] is True


def test_availability_report_zone_fallback():
    # без ввода дождя — R0.01 по зоне K (P.837-3) = 42 мм/ч
    inp = {
        "frequencyMhz": 6000,
        "polarization": "vertical",
        "path": {"distanceM": 50000},
        "climateZone": "K",
        "atmosphere": {"gases": False, "vegetation": False},
    }
    r = availability_report(inp, 20.0)
    assert r["rainSource"] == "zone"
    assert r["rainRate001"] == 42
    assert r["rainAttenuation001Db"] == pytest.approx(rain_attenuation_001_db(50000, 42, 6000, "vertical"), abs=1e-9)


def test_availability_report_no_margin():
    # запас ≤ 0: линия не обеспечивается — 100 % недоступности
    inp = {
        "frequencyMhz": 6000,
        "polarization": "vertical",
        "path": {"distanceM": 50000},
        "climateZone": "K",
        "atmosphere": {"gases": False, "vegetation": False, "rainRateMmH": 30, "rainSource": "user"},
    }
    r = availability_report(inp, -5.0)
    assert r["outage"]["totalPercent"] == 100
    assert r["outage"]["totalHoursPerYear"] == HOURS_PER_YEAR
    assert r["outage"]["availabilityPercent"] == 0

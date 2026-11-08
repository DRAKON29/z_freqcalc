# -*- coding: utf-8 -*-
"""Юнит-тесты формул (ТЗ 7.1): P.2001-lite, P.838, P.676, бюджет линии, доплер."""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from p2001_lite import (
    fspl_db,
    knife_edge_loss_db,
    knife_edge_v,
    bullington_loss_db,
    deygout_loss_db,
    epstein_peterson_loss_db,
    earth_bulge_m,
    extract_edges,
    diffraction_loss_db,
    rain_specific_attenuation,
    gas_specific_attenuation,
    vegetation_loss_db,
    radio_horizon_km,
    calculate,
    compute_budget,
    doppler_tolerance_hz,
    doppler_loss_db,
    p2001_lite_calculate,
    man_made_noise_fa_db,
)


class TestFspl:
    def test_1km_1ghz(self):
        assert abs(fspl_db(1000, 1000) - 92.44) < 0.01

    def test_50km_2ghz(self):
        assert abs(fspl_db(50_000, 2000) - 132.44) < 0.01

    def test_doubling_plus_6db(self):
        assert fspl_db(20_000, 2400) - fspl_db(10_000, 2400) == pytest.approx(6.02, abs=0.01)


class TestDiffraction:
    def test_v0_6db(self):
        assert knife_edge_loss_db(0.0) == pytest.approx(6.02, abs=0.1)

    def test_deep_negative_v_zero(self):
        assert knife_edge_loss_db(-1.0) == 0.0

    def test_bullington_6db(self):
        profile = [{"d": 0, "elev": 100}, {"d": 10_000, "elev": 109.5}, {"d": 20_000, "elev": 100}]
        edges = extract_edges(profile)
        loss = bullington_loss_db(edges, 120, 110, 20_000, 2000, 4 / 3)
        assert 3 < loss < 10

    def test_deygout_tall_hill(self):
        profile = [{"d": 0, "elev": 100}, {"d": 10_000, "elev": 160}, {"d": 20_000, "elev": 100}]
        edges = extract_edges(profile)
        assert deygout_loss_db(edges, 120, 110, 20_000, 2000, 4 / 3) > 15

    def test_max_of_methods(self):
        profile = [{"d": 0, "elev": 100}, {"d": 8_000, "elev": 180}, {"d": 14_000, "elev": 150}, {"d": 20_000, "elev": 100}]
        edges = extract_edges(profile)
        combined = diffraction_loss_db(profile, 120, 110, 2000, 4 / 3)
        assert combined == pytest.approx(
            max(
                deygout_loss_db(edges, 120, 110, 20_000, 2000, 4 / 3),
                bullington_loss_db(edges, 120, 110, 20_000, 2000, 4 / 3),
            ),
            abs=1e-6,
        )

    def test_epstein_peterson_two_edge_reference(self):
        """Эталон 2-краевой трассы (ручной расчёт, зеркалит TS-тест):
        30 км, 2400 МГц, K=4/3, антенны 20 м, рёбра 60 м на 10 и 20 км.
        Дейгаут ≈ 35.8, ЭП ≈ 33.2, Буллингтон ≈ 21.0 (занижает)."""
        d, f, k = 30_000, 2400, 4 / 3
        edges = [{"d": 10_000, "h": 60}, {"d": 20_000, "h": 60}]
        v_dom = knife_edge_v(10_000, 20_000, 60 + earth_bulge_m(10_000, d, k) - 20, f)
        v_right = knife_edge_v(10_000, 10_000, 20, f)
        v_ep = knife_edge_v(10_000, 10_000, 60 + earth_bulge_m(10_000, 20_000, k) - 40, f)
        assert epstein_peterson_loss_db(edges, 20, 20, d, f, k) == pytest.approx(2 * knife_edge_loss_db(v_ep), abs=1e-6)
        assert epstein_peterson_loss_db(edges, 20, 20, d, f, k) == pytest.approx(33.21, abs=0.1)
        assert bullington_loss_db(edges, 20, 20, d, f, k) == pytest.approx(knife_edge_loss_db(v_dom), abs=1e-6)
        assert deygout_loss_db(edges, 20, 20, d, f, k) == pytest.approx(
            knife_edge_loss_db(v_dom) + knife_edge_loss_db(v_right), abs=1e-6
        )
        # Буллингтон занижает относительно остальных методов
        assert bullington_loss_db(edges, 20, 20, d, f, k) < epstein_peterson_loss_db(edges, 20, 20, d, f, k)

    def test_epstein_peterson_single_edge_equals_knife_edge(self):
        """Одиночное ребро: ЭП совпадает с ножевым ребром и Дейгаутом."""
        edges = [{"d": 15_000, "h": 80}]
        ep = epstein_peterson_loss_db(edges, 20, 20, 30_000, 2400, 4 / 3)
        v = knife_edge_v(15_000, 15_000, 80 + earth_bulge_m(15_000, 30_000, 4 / 3) - 20, 2400)
        assert ep == pytest.approx(knife_edge_loss_db(v), abs=1e-9)
        assert deygout_loss_db(edges, 20, 20, 30_000, 2400, 4 / 3) == pytest.approx(ep, abs=1e-9)


class TestRainP838:
    def test_growth_with_rate(self):
        assert rain_specific_attenuation(50, 5000, "vertical") > rain_specific_attenuation(10, 5000, "vertical") > 0

    def test_reasonable_value_6ghz(self):
        g = rain_specific_attenuation(42, 6000, "horizontal")
        assert 0.005 < g < 0.5


class TestGasesP676:
    def test_1ghz_small(self):
        assert gas_specific_attenuation(1000) < 0.02

    def test_oxygen_peak_60ghz(self):
        assert gas_specific_attenuation(60_000) > gas_specific_attenuation(1000) * 100

    def test_water_line_22ghz(self):
        assert gas_specific_attenuation(22_235) > gas_specific_attenuation(20_000)


class TestVegetationP833:
    def test_weissberger_30m_1ghz(self):
        assert vegetation_loss_db(30, 1000) == pytest.approx(0.45 * 1000**0.284 * 30, abs=0.5)


class TestBudget:
    def setup_method(self):
        self.inp = {
            "frequencyMhz": 2400,
            "polarization": "vertical",
            "path": {
                "points": [{"lat": 55.75, "lon": 37.62}, {"lat": 55.8, "lon": 37.62}],
                "distanceM": 5560,
                "profile": [
                    {"d": 0, "elev": 150, "clutter": 0, "total": 150},
                    {"d": 2780, "elev": 160, "clutter": 0, "total": 160},
                    {"d": 5560, "elev": 145, "clutter": 0, "total": 145},
                ],
            },
            "txHeightM": 30,
            "rxHeightM": 10,
            "timePercents": [50, 90, 99, 99.9],
            "kFactor": 4 / 3,
            "atmosphere": {"gases": False, "vegetation": False},
            "climateZone": "K",
        }
        self.equipment = {
            "mode": "simple",
            # Всенаправленная антенна (≥180°) — без потерь наведения, формулы явные
            "tx": {"gainDbi": 10, "polarization": "vertical", "beamwidthDeg": 360},
            "rx": {"gainDbi": 3, "polarization": "vertical", "beamwidthDeg": 360},
            "transmitter": {"powerDbm": 30, "sensitivityDbm": -100},
            "receiver": {"powerDbm": 0, "sensitivityDbm": -100, "noiseBandwidthHz": 1e6,
                         "noiseFigureDb": 5, "modulation": "QPSK", "requiredEbN0Db": 9.6},
        }

    def test_formulas_tz_4_4_4(self):
        prop = calculate(self.inp, engine_note="test")
        b = compute_budget(self.inp, self.equipment, prop)
        assert b["eirpDbm"] == 40
        assert b["prxDbm"] == pytest.approx(40 - prop["medianLossDb"] + 3, abs=1e-6)
        ktb = 10 * math.log10(1.380649e-23 * 290 * 1e3) + 60
        assert b["ktbDbm"] == pytest.approx(ktb, abs=0.01)
        assert b["snrDb"] == pytest.approx(b["prxDbm"] - b["noisePowerDbm"], abs=1e-6)
        assert b["linkMarginDb"] == pytest.approx(b["snrDb"] - 9.6, abs=1e-6)

    def test_detailed_feeder_mismatch(self):
        self.equipment["mode"] = "detailed"
        self.equipment["tx"]["feederLossDb"] = 2
        self.equipment["tx"]["mismatchLossDb"] = 1
        prop = calculate(self.inp)
        b = compute_budget(self.inp, self.equipment, prop)
        assert b["eirpDbm"] == 30 - 2 - 1 + 10

    def test_pointing_loss_beamwidth(self):
        """Ширина луча: параболическая модель наведения, всенаправленная — 0."""
        self.equipment["tx"]["beamwidthDeg"] = 30
        self.equipment["rx"]["beamwidthDeg"] = 360
        prop = calculate(self.inp)
        b = compute_budget(self.inp, self.equipment, prop)
        assert b["eirpDbm"] == pytest.approx(40 - 12 * (10 / 30) ** 2, abs=1e-6)
        assert b["prxDbm"] == pytest.approx(b["eirpDbm"] - prop["medianLossDb"] + 3, abs=1e-6)

    def test_noise_environment_default_unchanged(self):
        """Без окружения (none/по умолчанию) бюджет идентичен прежнему: N = kTB + NF."""
        prop = calculate(self.inp)
        base = compute_budget(self.inp, self.equipment, prop)
        self.equipment["noiseEnvironment"] = "none"
        b = compute_budget(self.inp, self.equipment, prop)
        assert b["noisePowerDbm"] == pytest.approx(base["noisePowerDbm"], abs=1e-9)
        assert b["faDb"] is None
        # rural на 2400 МГц — фит ниже теплового пола → 0 дБ, бюджет тот же
        self.equipment["noiseEnvironment"] = "rural"
        b = compute_budget(self.inp, self.equipment, prop)
        assert b["noisePowerDbm"] == pytest.approx(base["noisePowerDbm"], abs=1e-9)


class TestNoiseP372:
    """Фиты техногенного шума P.372-17 (Table 1) и комбинация шум-факторов."""

    def test_fits_reference_values(self):
        # Fam = c − d·lg f (f в МГц)
        assert man_made_noise_fa_db("business", 100) == pytest.approx(21.4, abs=1e-6)
        assert man_made_noise_fa_db("residential", 250) == pytest.approx(72.5 - 27.7 * math.log10(250), abs=1e-6)
        assert man_made_noise_fa_db("rural", 50) == pytest.approx(67.2 - 27.7 * math.log10(50), abs=1e-6)
        assert man_made_noise_fa_db("quiet-rural", 30) == pytest.approx(53.6 - 28.6 * math.log10(30), abs=1e-6)

    def test_order_of_environments(self):
        for f in (50, 100, 250):
            values = [man_made_noise_fa_db(e, f) for e in ("quiet-rural", "rural", "residential", "business")]
            assert values == sorted(values)

    def test_clamp_below_thermal_floor(self):
        # экстраполяция за 250 МГц зажата на 0 дБ
        assert man_made_noise_fa_db("rural", 2400) == 0
        assert man_made_noise_fa_db("business", 2400) == 0
        assert man_made_noise_fa_db("business", 500) > 0
        assert man_made_noise_fa_db("none", 500) == 0

    def test_budget_combination(self):
        """Fa > NF → N = kTB + 10lg(f_rx + f_a − 1); строка faDb в бюджете."""
        inp = {"frequencyMhz": 500, "polarization": "vertical", "path": {"distanceM": 5560}}
        equipment = {
            "mode": "simple",
            "noiseEnvironment": "business",
            "tx": {"gainDbi": 10, "polarization": "vertical", "beamwidthDeg": 360},
            "rx": {"gainDbi": 3, "polarization": "vertical", "beamwidthDeg": 360},
            "transmitter": {"powerDbm": 30, "sensitivityDbm": -100},
            "receiver": {"powerDbm": 0, "sensitivityDbm": -100, "noiseBandwidthHz": 1e6,
                         "noiseFigureDb": 5, "modulation": "QPSK", "requiredEbN0Db": 9.6},
        }
        prop = {"medianLossDb": 113.3, "breakdown": {}}
        b = compute_budget(inp, equipment, prop)
        fa = man_made_noise_fa_db("business", 500)
        assert b["faDb"] == pytest.approx(fa, abs=1e-9)
        ktb = 10 * math.log10(1.380649e-23 * 290 * 1e3) + 60
        # simple-режим: NF форсируется в 3 дБ
        expected = ktb + 10 * math.log10(10 ** (3 / 10) + 10 ** (fa / 10) - 1)
        assert b["noisePowerDbm"] == pytest.approx(expected, abs=1e-9)


class TestDoppler:
    def test_tolerance_qpsk(self):
        assert doppler_tolerance_hz(1e6, "QPSK") == pytest.approx(50_000, rel=0.01)

    def test_zero_below_tolerance(self):
        assert doppler_loss_db(100, 1e6, "QPSK") == 0

    def test_outage_beyond_4x(self):
        tol = doppler_tolerance_hz(1e6, "QPSK")
        assert doppler_loss_db(4 * tol + 10, 1e6, "QPSK") == 99

    def test_formula_v_over_c(self):
        df = (100 / 299_792_458) * 1e9
        assert df == pytest.approx(333.56, abs=0.5)


class TestP2001Lite:
    def setup_method(self):
        self.inp = {
            "frequencyMhz": 2000,
            "polarization": "vertical",
            "path": {
                "points": [{"lat": 55.75, "lon": 37.62}, {"lat": 55.75, "lon": 38.07}],
                "distanceM": 30_000,
                "profile": [
                    {"d": 0, "elev": 150, "clutter": 0, "total": 150},
                    {"d": 15_000, "elev": 210, "clutter": 0, "total": 210},
                    {"d": 30_000, "elev": 140, "clutter": 0, "total": 140},
                ],
            },
            "txHeightM": 30,
            "rxHeightM": 15,
            "timePercents": [50, 90, 99, 99.9],
            "kFactor": 4 / 3,
            "atmosphere": {"gases": False, "vegetation": False},
            "climateZone": "K",
        }

    def test_diffraction_adds_loss(self):
        r = calculate(self.inp)
        fspl_flat = 20 * math.log10(30) + 20 * math.log10(2000) + 32.44
        assert r["medianLossDb"] > fspl_flat
        assert r["breakdown"]["diffractionDb"] > 0

    def test_time_percent_curve_p2001_convention(self):
        r = calculate(self.inp)
        by_time = {t["percent"]: t["lossDb"] for t in r["byTimePercent"]}
        assert by_time[99] < by_time[90] < by_time[50]

    def test_pyodide_entrypoint(self):
        out = json.loads(p2001_lite_calculate(json.dumps(self.inp)))
        assert "medianLossDb" in out and out["medianLossDb"] > 0

    def test_clutter_building_accounted(self):
        inp2 = json.loads(json.dumps(self.inp))
        inp2["path"]["profile"][1]["clutter"] = 40  # здание 40 м на вершине
        r1 = calculate(self.inp)
        r2 = calculate(inp2)
        assert r2["medianLossDb"] > r1["medianLossDb"]

    def test_horizon(self):
        assert 55 < radio_horizon_km(100, 50, 4 / 3) < 75

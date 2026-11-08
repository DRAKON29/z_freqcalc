# -*- coding: utf-8 -*-
"""
P.2001-lite — расчётное ядро распространения радиоволн на Python.

Используется в двух режимах:
  • FastAPI-сервис (http-режим,): приоритетная модель ITU-R P.2001.
    При установленном пакете py2001 и картах ITU вызывается py2001;
    иначе — статистическая аппроксимация P.2001-lite.
  • Pyodide в браузере (wasm-режим,): та же модель без зависимостей.

Формулы: FSPL (P.525), дифракция (P.526: ножевое ребро, Буллингтон, Дейгаут),
дождь (P.838), газы (P.676, упрощённая), растительность (P.833, Вайсбергер),
бюджет линии, доплер.
"""
from __future__ import annotations

import json
import math

C_LIGHT = 299_792_458.0
K_B = 1.380649e-23
T0 = 290.0
R_EARTH = 6_371_000.0
KTB_DBM_HZ = 10 * math.log10(K_B * T0 * 1e3)  # ≈ -173.98

MODULATIONS = {
    "BPSK": {"ebn0": 9.6, "bits": 1},
    "QPSK": {"ebn0": 9.6, "bits": 2},
    "16QAM": {"ebn0": 14.0, "bits": 4},
    "64QAM": {"ebn0": 18.5, "bits": 6},
}


# ---------- Базовые модели ----------

def fspl_db(d_m: float, f_mhz: float) -> float:
    """FSPL (P.525): 20lg d_км + 20lg f_МГц + 32.44."""
    d_km = d_m / 1000.0
    if d_km <= 0:
        return 0.0
    return 20 * math.log10(d_km) + 20 * math.log10(f_mhz) + 32.44


def earth_bulge_m(d1: float, d_total: float, k: float) -> float:
    """Выпуклость Земли (P.453): d1·(d−d1)/(2·k·a)."""
    ae = k * R_EARTH
    return d1 * (d_total - d1) / (2 * ae)


def knife_edge_v(d1: float, d2: float, h_above: float, f_mhz: float) -> float:
    """Параметр v (P.526 §4.2.1): h·√2 / √(λ·d1·d2/(d1+d2))."""
    lam = 299.792458 / f_mhz
    if d1 <= 0 or d2 <= 0:
        return 0.0
    denom = math.sqrt(lam * d1 * d2 / (d1 + d2))
    return h_above * math.sqrt(2) / denom if denom > 0 else 0.0


def knife_edge_loss_db(v: float) -> float:
    """J(v) (P.526 §4.2.2)."""
    if v <= -0.78:
        return 0.0
    return 6.9 + 20 * math.log10(math.sqrt((v - 0.1) ** 2 + 1) + v - 0.1)


def bullington_loss_db(edges, tx_h, rx_h, d_total, f_mhz, k):
    """Метод Буллингтона (P.526 §4.5.2)."""
    if not edges:
        return 0.0
    s_t = s_r = -math.inf
    for e in edges:
        if e["d"] <= 0 or e["d"] >= d_total:
            continue
        h_eff = e["h"] + earth_bulge_m(e["d"], d_total, k)
        s_t = max(s_t, (h_eff - tx_h) / e["d"])
        s_r = max(s_r, (h_eff - rx_h) / (e["d"] - d_total))
    if not math.isfinite(s_t) or not math.isfinite(s_r):
        return 0.0
    d_cross = (rx_h - s_r * d_total - tx_h) / (s_t - s_r)
    if d_cross <= 0 or d_cross >= d_total:
        return 0.0
    h_cross = tx_h + s_t * d_cross
    h_los = tx_h + (rx_h - tx_h) * d_cross / d_total
    h_above = h_cross - h_los
    if h_above <= 0:
        return 0.0
    v = knife_edge_v(d_cross, d_total - d_cross, h_above, f_mhz)
    return knife_edge_loss_db(v)


def deygout_loss_db(edges, tx_h, rx_h, d_total, f_mhz, k):
    """Метод Дейгаута (P.526 §4.4) с рекурсией по подпутям."""
    if not edges:
        return 0.0
    los = lambda d: tx_h + (rx_h - tx_h) * d / d_total
    eff = lambda e: e["h"] + earth_bulge_m(e["d"], d_total, k)
    worst, worst_v = None, -math.inf
    for e in edges:
        if e["d"] <= 0 or e["d"] >= d_total:
            continue
        v = knife_edge_v(e["d"], d_total - e["d"], eff(e) - los(e["d"]), f_mhz)
        if v > worst_v:
            worst, worst_v = e, v
    if worst is None or worst_v <= 0:
        return 0.0
    loss = knife_edge_loss_db(worst_v)
    h_main = eff(worst)
    left = [e for e in edges if e["d"] < worst["d"]]
    right = [e for e in edges if e["d"] > worst["d"]]
    if left:
        loss += deygout_loss_db(left, tx_h, h_main, worst["d"], f_mhz, k)
    if right:
        rebased = [{"d": e["d"] - worst["d"], "h": e["h"]} for e in right]
        loss += deygout_loss_db(rebased, h_main, rx_h, d_total - worst["d"], f_mhz, k)
    return loss


def epstein_peterson_loss_db(edges, tx_h, rx_h, d_total, f_mhz, k):
    """Метод Эпштейна–Петерсона (P.526 §4.5.1): последовательные рёбра,
    каждое — препятствие подпутя между соседними рёбрами (или Tx/Rx);
    потери суммируются. На одиночном ребре совпадает с ножевым ребром."""
    if not edges:
        return 0.0
    pts = [{"d": 0, "h": tx_h}] + [e for e in edges if 0 < e["d"] < d_total] + [{"d": d_total, "h": rx_h}]
    loss = 0.0
    for i in range(1, len(pts) - 1):
        a, edge, b = pts[i - 1], pts[i], pts[i + 1]
        sub = b["d"] - a["d"]
        d1 = edge["d"] - a["d"]
        d2 = b["d"] - edge["d"]
        if d1 <= 0 or d2 <= 0:
            continue
        h_eff = edge["h"] + earth_bulge_m(d1, sub, k)
        los = a["h"] + (b["h"] - a["h"]) * d1 / sub
        loss += knife_edge_loss_db(knife_edge_v(d1, d2, h_eff - los, f_mhz))
    return loss


def extract_edges(profile):
    """Локальные максимумы профиля."""
    edges = []
    for i in range(1, len(profile) - 1):
        p0, p1, p2 = profile[i - 1], profile[i], profile[i + 1]
        if p1["elev"] >= p0["elev"] and p1["elev"] >= p2["elev"]:
            edges.append({"d": p1["d"], "h": p1["elev"]})
    if not edges and len(profile) >= 3:
        mx = max(range(1, len(profile) - 1), key=lambda i: profile[i]["elev"])
        edges.append({"d": profile[mx]["d"], "h": profile[mx]["elev"]})
    return edges


def diffraction_loss_db(profile, tx_h, rx_h, f_mhz, k, clutter_edges=None):
    """max(Дейгаут, Буллингтон)"""
    if len(profile) < 3:
        return 0.0
    d_total = profile[-1]["d"]
    edges = extract_edges(profile) + (clutter_edges or [])
    edges.sort(key=lambda e: e["d"])
    if not edges:
        return 0.0
    return max(
        deygout_loss_db(edges, tx_h, rx_h, d_total, f_mhz, k),
        bullington_loss_db(edges, tx_h, rx_h, d_total, f_mhz, k),
    )


# ---------- Атмосфера ----------

def rain_specific_attenuation(r_mm_h: float, f_mhz: float, pol: str) -> float:
    """γR = k·R^α (P.838-3, аппроксимация 0.5–7 ГГц)."""
    if r_mm_h <= 0 or f_mhz < 100:
        return 0.0
    l = math.log10(f_mhz / 1000.0)
    if pol == "horizontal":
        k = 1.21e-5 * math.exp(1.42 * l**3 - 2.31 * l**2 + 2.52 * l)
        alpha = 1.934 - 0.912 * l + 0.283 * l**2 + 0.097 * l**3
    elif pol == "circular":
        kh = 1.21e-5 * math.exp(1.42 * l**3 - 2.31 * l**2 + 2.52 * l)
        kv = 1.32e-5 * math.exp(1.31 * l**3 - 2.12 * l**2 + 2.24 * l)
        k = (kh + kv + 2 * kv * kh) / 4
        ah = 1.934 - 0.912 * l + 0.283 * l**2 + 0.097 * l**3
        av = 1.862 - 0.842 * l + 0.256 * l**2 + 0.088 * l**3
        alpha = (ah * av + ah + av) / 4
    else:
        k = 1.32e-5 * math.exp(1.31 * l**3 - 2.12 * l**2 + 2.24 * l)
        alpha = 1.862 - 0.842 * l + 0.256 * l**2 + 0.088 * l**3
    return k * r_mm_h**alpha


def rain_loss_db(d_m, r_mm_h, f_mhz, pol):
    """Потери в дожде: γR·d_eff, d_eff = d/(1+d/35) (P.530/P.838)."""
    if r_mm_h <= 0:
        return 0.0
    d_km = d_m / 1000.0
    return rain_specific_attenuation(r_mm_h, f_mhz, pol) * d_km / (1 + d_km / 35)


def gas_specific_attenuation(f_mhz: float, p_hpa=1013.25, rho_g_m3=7.5, t_k=288.15) -> float:
    """Удельное затухание газов (P.676, упрощённая модель, ≤57 ГГц)."""
    f = f_mhz / 1000.0
    if f <= 0:
        return 0.0
    p_n = p_hpa / 1013.25
    t_n = (300.0 / t_k) ** 0.85
    rho = rho_g_m3 / 7.5
    w_o = 1.2 * p_n * t_n
    go = 0.0098 * p_n * t_n * f * f / (f * f + 1) + 0.006 * p_n * t_n * f * f * w_o / ((f - 60) ** 2 + w_o**2)
    w_w = 2.6 * rho
    gw = 0.0003 * rho * f * f / (f * f + 25) + 0.0035 * rho * f * f * w_w / ((f - 22.235) ** 2 + w_w**2)
    return max(0.0, go + gw)


def gases_loss_db(d_m, f_mhz, elevation_deg=5.0):
    g = gas_specific_attenuation(f_mhz)
    h_eff_km = min(d_m / 1000.0, 3.2)
    el = max(0.01, math.radians(elevation_deg))
    return g * h_eff_km / math.sin(el)


def vegetation_loss_db(depth_m: float, f_mhz: float) -> float:
    """P.833 / Weissberger: L = 0.45·f^0.284·d (d<400 м)."""
    if depth_m <= 0:
        return 0.0
    at400 = 0.45 * f_mhz**0.284 * 400
    if depth_m <= 400:
        return 0.45 * f_mhz**0.284 * depth_m
    slope = 0.45 * f_mhz**0.284 * 0.06
    return min(at400, at400 * 0.6 + slope * depth_m)


# ---------- Статистическая часть P.2001-lite ----------

def radio_horizon_km(h1, h2, k):
    kk = max(0.5, k)
    return 4.12 * (math.sqrt(max(0, h1)) + math.sqrt(max(0, h2))) * math.sqrt(kk / (4 / 3))


CLIMATE_FACTOR = {"A": 0.2, "B": 0.4, "C": 0.6, "D": 0.8, "E": 0.3, "F": 0.9, "G": 1.2,
                  "H": 1.5, "J": 1.0, "K": 1.1, "L": 0.7, "M": 0.5, "N": 0.4, "P": 0.3, "Q": 0.35}


# ---------- Основной расчёт ----------

def calculate(inp: dict, engine_note: str = "py: P.2001-lite") -> dict:
    f = float(inp["frequencyMhz"])
    pol = inp.get("polarization", "vertical")
    path = inp["path"]
    d_m = float(path["distanceM"])
    profile = path["profile"]
    k = float(inp.get("kFactor", 4 / 3))
    atm = inp.get("atmosphere", {})
    warnings = []

    tx_base = profile[0]["elev"] if profile else 0.0
    rx_base = profile[-1]["elev"] if profile else 0.0
    tx_h = tx_base + float(inp.get("txHeightM", 10))
    rx_h = rx_base + float(inp.get("rxHeightM", 10))

    # FSPL + дифракция по рельефу
    fspl = fspl_db(d_m, f)
    diff = diffraction_loss_db(
        [{"d": p["d"], "elev": p["elev"]} for p in profile], tx_h, rx_h, f, k
    )

    # Здания/растительность из clutter: точки антенн не учитываются
    building_edges = [
        {"d": p["d"], "h": p["elev"] + p["clutter"]}
        for p in profile
        if p.get("clutter", 0) > 0 and 0 < p["d"] < d_m
    ]
    diff_with_clutter = (
        diffraction_loss_db(
            [{"d": p["d"], "elev": p["elev"]} for p in profile], tx_h, rx_h, f, k, building_edges
        )
        if building_edges
        else diff
    )
    clutter_diff_db = max(0.0, diff_with_clutter - diff)

    # Растительность (P.833)
    step = profile[1]["d"] - profile[0]["d"] if len(profile) > 1 else 0.0
    veg_depth = step * sum(1 for p in profile if p.get("clutter", 0) > 0 and 0 < p["d"] < d_m)
    veg_db = vegetation_loss_db(veg_depth, f) if atm.get("vegetation") else 0.0

    # Дождь (P.837/P.838) — для частот > 3 ГГц
    rain_rate = float(atm.get("rainRateMmH") or 0)
    rain_db = rain_loss_db(d_m, rain_rate, f, pol) if f > 3000 and rain_rate > 0 else 0.0

    # Газы (P.676)
    gases_db = 0.0
    if atm.get("gases"):
        gases_db = gases_loss_db(d_m, f, 5.0)
        if gases_db <= 0:
            warnings.append("Упрощённая модель газов P.676 применима до 57 ГГц — вклад не учтён")

    # Тропосферное рассеяние за радиогоризонтом (упрощённая аппроксимация P.2001)
    horizon_km = radio_horizon_km(tx_h, rx_h, k)
    d_km = d_m / 1000.0
    beyond = max(0.0, d_km - horizon_km)
    scatter = beyond * (0.11 + 0.002 * f / 1000) + 10 * math.log10(1 + beyond / horizon_km) if beyond > 0 else 0.0

    median = fspl + diff + scatter + clutter_diff_db + veg_db + rain_db + gases_db

    # Изменчивость во времени (P.2001-lite): потери, превышаемые p% времени
    cf = CLIMATE_FACTOR.get(inp.get("climateZone", "K"), 0.8)
    p0 = cf * (d_km / 50) ** 3 * 0.05
    by_time = []
    for p in inp.get("timePercents", [50]):
        if p < 50:
            rayleigh = 10 * math.log10(50.0 / p)
            reach = min(1.0, p0 / 6.0) if p0 > 0.001 else 0.15
            delta = rayleigh * (0.35 + 0.65 * reach)
        else:
            delta = -min(4.0, 2 * math.log10(p / 50.0))
        by_time.append({"percent": p, "lossDb": median + delta})

    result = {
        "model": "p2001",
        "medianLossDb": median,
        "byTimePercent": by_time,
        "breakdown": {
            "freeSpaceDb": fspl,
            "diffractionDb": diff + clutter_diff_db,
            "troposcatterDb": scatter,
            "rainDb": rain_db if rain_db > 0 else None,
            "gasesDb": gases_db if gases_db > 0 else None,
            "vegetationDb": veg_db if veg_db > 0 else None,
        },
        "engineUsed": engine_note,
        "warnings": warnings,
    }
    return result


def p2001_lite_calculate(json_input: str) -> str:
    """Точка входа для Pyodide: JSON-строка → JSON-строка."""
    return json.dumps(calculate(json.loads(json_input)))


# Номинальное отклонение оси антенны от направления на корреспондента, °
# (подвижный объект и антенны без идеального автосопровождения)
NOMINAL_POINTING_ERROR_DEG = 10.0


def _pointing_loss_db(ant: dict) -> float:
    """Потери на неточное наведение — параболическая модель главного лепестка:
    A(θ) = 12·(θ/θ3дБ)² дБ, ограничены уровнем боковых лепестков. При ширине
    луча ≥ 180° (всенаправленная антенна) не учитываются."""
    bw = ant.get("beamwidthDeg", 30)
    if not bw or bw <= 0 or bw >= 180:
        return 0.0
    return min(12.0 * (NOMINAL_POINTING_ERROR_DEG / bw) ** 2, -ant.get("sidelobeDb", -25))


def compute_budget(inp: dict, equipment: dict, prop: dict, doppler_loss_db: float = 0.0) -> dict:
    """Бюджет линии по формулам"""
    detailed = equipment.get("mode") == "detailed"
    tx, rx = equipment["tx"], equipment["rx"]
    transmitter, receiver = equipment["transmitter"], equipment["receiver"]

    tx_feeder = tx.get("feederLossDb", 0) if detailed else 0
    rx_feeder = rx.get("feederLossDb", 0) if detailed else 0
    tx_mis = tx.get("mismatchLossDb", 0) if detailed else 0
    rx_mis = rx.get("mismatchLossDb", 0) if detailed else 0
    tx_point = _pointing_loss_db(tx)
    rx_point = _pointing_loss_db(rx)

    eirp = transmitter["powerDbm"] - tx_feeder - tx_mis - tx_point + tx["gainDbi"]
    extra = (prop["breakdown"].get("rainDb") or 0) + (prop["breakdown"].get("gasesDb") or 0) \
        + (prop["breakdown"].get("vegetationDb") or 0) + doppler_loss_db
    prx = eirp - prop["medianLossDb"] - extra + rx["gainDbi"] - rx_feeder - rx_mis - rx_point

    nf = receiver.get("noiseFigureDb", 3) if detailed else 3
    b_hz = receiver.get("noiseBandwidthHz", 1e6) if detailed else 1e6
    ktb = KTB_DBM_HZ + 10 * math.log10(b_hz)
    # Шум антенны Fa (P.372-17 §6.1.1): сложение шум-факторов f = f_rx + f_a − 1
    fa = man_made_noise_fa_db(equipment.get("noiseEnvironment", "none"), inp.get("frequencyMhz", 0))
    noise = ktb + 10 * math.log10(10 ** (nf / 10) + 10 ** (fa / 10) - 1) if fa > 0 else ktb + nf
    snr = prx - noise

    mod = receiver.get("modulation", "QPSK")
    ebn0_req = receiver.get("requiredEbN0Db", MODULATIONS.get(mod, {"ebn0": 9.6})["ebn0"])
    bits = MODULATIONS.get(mod, {"bits": 2})["bits"]
    rb = b_hz * bits
    ebn0_actual = snr + 10 * math.log10(b_hz / rb)
    margin = snr - ebn0_req

    return {
        "eirpDbm": eirp, "pathLossDb": prop["medianLossDb"], "prxDbm": prx,
        "noisePowerDbm": noise, "ktbDbm": ktb, "nfDb": nf, "snrDb": snr,
        "ebN0ActualDb": ebn0_actual, "ebN0RequiredDb": ebn0_req, "linkMarginDb": margin,
        "faDb": fa if fa > 0 else None,
        "dopplerLossDb": doppler_loss_db if doppler_loss_db > 0 else None,
    }


# Техногенный шум P.372-17 (§6.1.1, Table 1): Fam = c − d·lg f (f в МГц);
# фит валиден 0.3–250 МГц, выше — экстраполяция с зажимом снизу на 0 дБ
P372_MAN_MADE_FITS = {
    "business": (76.8, 27.7),
    "residential": (72.5, 27.7),
    "rural": (67.2, 27.7),
    "quiet-rural": (53.6, 28.6),
}


def man_made_noise_fa_db(environment: str, f_mhz: float) -> float:
    """Медианный техногенный шум Fa, дБ выше kT0 (0 — не учитывать/ниже пола)."""
    fit = P372_MAN_MADE_FITS.get(environment)
    if not fit or not f_mhz > 0:
        return 0.0
    c, d = fit
    return min(60.0, max(0.0, c - d * math.log10(f_mhz)))


def doppler_tolerance_hz(b_hz: float, modulation: str) -> float:
    bits = MODULATIONS.get(modulation, {"bits": 2})["bits"]
    factor = 0.05 if modulation in ("BPSK", "QPSK") else 0.02 / (bits / 4)
    return b_hz * factor


def doppler_loss_db(doppler_hz: float, b_hz: float, modulation: str) -> float:
    tol = doppler_tolerance_hz(b_hz, modulation)
    a = abs(doppler_hz)
    if a <= tol:
        return 0.0
    if a > 4 * tol:
        return 99.0
    return min(30.0, 0.5 * math.ceil((a - tol) / (tol / 2) * 2) / 2)

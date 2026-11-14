# Copyright (c) 2026 Evgeny Gennadievich Prutkov <sviazist.pr@gmail.com>
# SPDX-License-Identifier: MIT
#
# Python implementation of ITU-R P.835-7.
# See README.md and NOTICE for attribution.

"""
core/itu/p835/seasonal_atmosphere.py — Сезонные эталонные атмосферы
по ITU-R P.835-7, Annex 2.

Реализует пять профилей:
    1. Low latitude annual (15°N, все сезоны)
    2. Mid latitude summer (45°N, лето)
    3. Mid latitude winter (45°N, зима)
    4. High latitude summer (60°N, лето)
    5. High latitude winter (60°N, зима)

Интерполяция по широте:
    0°–15°N: low annual
    15°–45°N (лето/зима): линейная между low и mid
    45°–60°N (лето/зима): линейная между mid и high
    ≥ 60°N: high

Все формулы дают T(K) и P(hPa) как функции Z(km), где Z —
геометрическая высота.
"""

import math
from enum import Enum


class AtmosphereRegion(Enum):
    """Тип региональной атмосферы."""
    LOW_LATITUDE_ANNUAL = "low_annual"
    MID_LATITUDE_SUMMER = "mid_summer"
    MID_LATITUDE_WINTER = "mid_winter"
    HIGH_LATITUDE_SUMMER = "high_summer"
    HIGH_LATITUDE_WINTER = "high_winter"


class Season(Enum):
    """Сезон."""
    SUMMER = "summer"
    WINTER = "winter"


# =====================================================================
# ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
# =====================================================================

def _pressure_exponential_from_10_and_72(
    z_km: float,
    P10_hpa: float,
    P72_hpa: float,
    decay_10_72: float,
    decay_72_100: float,
) -> float:
    """
    Универсальная формула для P(Z) в верхних слоях.

    P.835-7, ур. (10b/10c), (13b/13c), (16b/16c), (19b/19c), (22b/22c).

    Args:
        z_km: высота.
        P10_hpa: давление на 10 км.
        P72_hpa: давление на 72 км.
        decay_10_72: коэффициент затухания на 10–72 км (обычно 0.147).
        decay_72_100: коэффициент на 72–100 км (обычно 0.150–0.165).

    Returns:
        Давление, гПа.
    """
    if z_km <= 10.0:
        raise ValueError("Функция только для Z > 10 км")
    if z_km <= 72.0:
        return P10_hpa * math.exp(-decay_10_72 * (z_km - 10.0))
    return P72_hpa * math.exp(-decay_72_100 * (z_km - 72.0))


# =====================================================================
# 1. LOW-LATITUDE ANNUAL (15°N, все сезоны)
# =====================================================================

def low_latitude_annual_temperature(z_km: float) -> float:
    """
    T(Z) для low-latitude annual (15°N).
    P.835-7, ур. (9a–9e).
    """
    if z_km < 0.0 or z_km > 100.0:
        raise ValueError(f"Z={z_km} вне [0, 100]")

    if z_km < 17.0:
        return 300.4222 - 6.3533 * z_km + 0.005886 * z_km * z_km
    elif z_km < 47.0:
        return 194.0 + 2.533 * (z_km - 17.0)
    elif z_km < 52.0:
        return 270.0
    elif z_km < 80.0:
        return 270.0 - 3.0714 * (z_km - 52.0)
    else:
        return 184.0


def low_latitude_annual_pressure(z_km: float) -> float:
    """
    P(Z) для low-latitude annual (15°N).
    P.835-7, ур. (10a–10c).
    """
    if z_km < 0.0 or z_km > 100.0:
        raise ValueError(f"Z={z_km} вне [0, 100]")

    if z_km <= 10.0:
        return 1012.0306 - 109.0338 * z_km + 3.6316 * z_km * z_km
    P10 = 1012.0306 - 109.0338 * 10.0 + 3.6316 * 100.0
    if z_km <= 72.0:
        return P10 * math.exp(-0.147 * (z_km - 10.0))
    P72 = P10 * math.exp(-0.147 * 62.0)
    return P72 * math.exp(-0.165 * (z_km - 72.0))


def low_latitude_annual_water_vapour(z_km: float) -> float:
    """
    ρ(Z) для low-latitude annual (15°N).
    P.835-7, ур. (11a, 11b).
    """
    if z_km < 0.0:
        raise ValueError(f"Z={z_km} < 0")
    if z_km > 15.0:
        return 0.0
    z = z_km
    exponent = (-0.2313 * z - 0.1122 * z * z
                + 0.01351 * z * z * z
                - 0.0005923 * z * z * z * z)
    return 19.6542 * math.exp(exponent)


# =====================================================================
# 2. MID-LATITUDE SUMMER (45°N, лето)
# =====================================================================

def mid_latitude_summer_temperature(z_km: float) -> float:
    """T(Z) для mid-latitude summer. P.835-7, ур. (12a–12f)."""
    if z_km < 0.0 or z_km > 100.0:
        raise ValueError(f"Z={z_km} вне [0, 100]")

    if z_km < 13.0:
        return 294.9838 - 5.2159 * z_km - 0.07109 * z_km * z_km
    elif z_km < 17.0:
        return 215.15
    elif z_km < 47.0:
        return 215.15 * math.exp(0.008128 * (z_km - 17.0))
    elif z_km < 53.0:
        return 275.0
    elif z_km < 80.0:
        return 275.0 + 111.57755 * (1.0 - math.exp(0.0237 * (z_km - 53.0)))
    else:
        return 175.0


def mid_latitude_summer_pressure(z_km: float) -> float:
    """P(Z) для mid-latitude summer. P.835-7, ур. (13a–13c)."""
    if z_km < 0.0 or z_km > 100.0:
        raise ValueError(f"Z={z_km} вне [0, 100]")

    if z_km <= 10.0:
        return 1012.8186 - 111.5569 * z_km + 3.8646 * z_km * z_km
    P10 = 1012.8186 - 111.5569 * 10.0 + 3.8646 * 100.0
    if z_km <= 72.0:
        return P10 * math.exp(-0.147 * (z_km - 10.0))
    P72 = P10 * math.exp(-0.147 * 62.0)
    return P72 * math.exp(-0.165 * (z_km - 72.0))


def mid_latitude_summer_water_vapour(z_km: float) -> float:
    """ρ(Z) для mid-latitude summer. P.835-7, ур. (14a, 14b)."""
    if z_km < 0.0:
        raise ValueError(f"Z={z_km} < 0")
    if z_km > 15.0:
        return 0.0
    z = z_km
    exponent = -0.4174 * z - 0.02290 * z * z + 0.001007 * z * z * z
    return 14.3542 * math.exp(exponent)


# =====================================================================
# 3. MID-LATITUDE WINTER (45°N, зима)
# =====================================================================

def mid_latitude_winter_temperature(z_km: float) -> float:
    """T(Z) для mid-latitude winter. P.835-7, ур. (15a–15f)."""
    if z_km < 0.0 or z_km > 100.0:
        raise ValueError(f"Z={z_km} вне [0, 100]")

    if z_km < 10.0:
        return 272.7241 - 3.6217 * z_km - 0.1759 * z_km * z_km
    elif z_km < 33.0:
        return 218.0
    elif z_km < 47.0:
        return 218.0 + 3.3571 * (z_km - 33.0)
    elif z_km < 53.0:
        return 265.0
    elif z_km < 80.0:
        return 265.0 - 2.0370 * (z_km - 53.0)
    else:
        return 210.0


def mid_latitude_winter_pressure(z_km: float) -> float:
    """P(Z) для mid-latitude winter. P.835-7, ур. (16a–16c)."""
    if z_km < 0.0 or z_km > 100.0:
        raise ValueError(f"Z={z_km} вне [0, 100]")

    if z_km <= 10.0:
        return 1018.8627 - 124.2954 * z_km + 4.8307 * z_km * z_km
    P10 = 1018.8627 - 124.2954 * 10.0 + 4.8307 * 100.0
    if z_km <= 72.0:
        return P10 * math.exp(-0.147 * (z_km - 10.0))
    P72 = P10 * math.exp(-0.147 * 62.0)
    return P72 * math.exp(-0.155 * (z_km - 72.0))


def mid_latitude_winter_water_vapour(z_km: float) -> float:
    """ρ(Z) для mid-latitude winter. P.835-7, ур. (17a, 17b)."""
    if z_km < 0.0:
        raise ValueError(f"Z={z_km} < 0")
    if z_km > 10.0:
        return 0.0
    z = z_km
    exponent = -0.2697 * z - 0.03604 * z * z + 0.0004489 * z * z * z
    return 3.4742 * math.exp(exponent)


# =====================================================================
# 4. HIGH-LATITUDE SUMMER (60°N, лето)
# =====================================================================

def high_latitude_summer_temperature(z_km: float) -> float:
    """T(Z) для high-latitude summer. P.835-7, ур. (18a–18f)."""
    if z_km < 0.0 or z_km > 100.0:
        raise ValueError(f"Z={z_km} вне [0, 100]")

    if z_km < 10.0:
        return 286.8374 - 4.7805 * z_km - 0.1402 * z_km * z_km
    elif z_km < 23.0:
        return 225.0
    elif z_km < 48.0:
        return 225.0 * math.exp(0.008317 * (z_km - 23.0))
    elif z_km < 53.0:
        return 277.0
    elif z_km < 79.0:
        return 277.0 - 4.0769 * (z_km - 53.0)
    else:
        return 171.0


def high_latitude_summer_pressure(z_km: float) -> float:
    """P(Z) для high-latitude summer. P.835-7, ур. (19a–19c)."""
    if z_km < 0.0 or z_km > 100.0:
        raise ValueError(f"Z={z_km} вне [0, 100]")

    if z_km <= 10.0:
        return 1008.0278 - 113.2494 * z_km + 3.9408 * z_km * z_km
    P10 = 1008.0278 - 113.2494 * 10.0 + 3.9408 * 100.0
    if z_km <= 72.0:
        return P10 * math.exp(-0.140 * (z_km - 10.0))
    P72 = P10 * math.exp(-0.140 * 62.0)
    return P72 * math.exp(-0.165 * (z_km - 72.0))


def high_latitude_summer_water_vapour(z_km: float) -> float:
    """ρ(Z) для high-latitude summer. P.835-7, ур. (20a, 20b)."""
    if z_km < 0.0:
        raise ValueError(f"Z={z_km} < 0")
    if z_km > 15.0:
        return 0.0
    z = z_km
    exponent = -0.3614 * z - 0.005402 * z * z - 0.001955 * z * z * z
    return 8.988 * math.exp(exponent)


# =====================================================================
# 5. HIGH-LATITUDE WINTER (60°N, зима)
# =====================================================================

def high_latitude_winter_temperature(z_km: float) -> float:
    """T(Z) для high-latitude winter. P.835-7, ур. (21a–21e)."""
    if z_km < 0.0 or z_km > 100.0:
        raise ValueError(f"Z={z_km} вне [0, 100]")

    if z_km < 8.5:
        return (257.4345 + 2.3474 * z_km
                - 1.5479 * z_km * z_km
                + 0.08473 * z_km * z_km * z_km)
    elif z_km < 30.0:
        return 217.5
    elif z_km < 50.0:
        return 217.5 + 2.125 * (z_km - 30.0)
    elif z_km < 54.0:
        return 260.0
    else:
        return 260.0 - 1.667 * (z_km - 54.0)


def high_latitude_winter_pressure(z_km: float) -> float:
    """P(Z) для high-latitude winter. P.835-7, ур. (22a–22c)."""
    if z_km < 0.0 or z_km > 100.0:
        raise ValueError(f"Z={z_km} вне [0, 100]")

    if z_km <= 10.0:
        return 1010.8828 - 122.2411 * z_km + 4.554 * z_km * z_km
    P10 = 1010.8828 - 122.2411 * 10.0 + 4.554 * 100.0
    if z_km <= 72.0:
        return P10 * math.exp(-0.147 * (z_km - 10.0))
    P72 = P10 * math.exp(-0.147 * 62.0)
    return P72 * math.exp(-0.150 * (z_km - 72.0))


def high_latitude_winter_water_vapour(z_km: float) -> float:
    """ρ(Z) для high-latitude winter. P.835-7, ур. (23a, 23b)."""
    if z_km < 0.0:
        raise ValueError(f"Z={z_km} < 0")
    if z_km > 10.0:
        return 0.0
    z = z_km
    exponent = 0.07481 * z - 0.0981 * z * z + 0.00281 * z * z * z
    return 1.2319 * math.exp(exponent)


# =====================================================================
# УНИВЕРСАЛЬНЫЙ ДОСТУП ПО РЕГИОНУ
# =====================================================================

_REGION_TEMPERATURE = {
    AtmosphereRegion.LOW_LATITUDE_ANNUAL:  low_latitude_annual_temperature,
    AtmosphereRegion.MID_LATITUDE_SUMMER:  mid_latitude_summer_temperature,
    AtmosphereRegion.MID_LATITUDE_WINTER:  mid_latitude_winter_temperature,
    AtmosphereRegion.HIGH_LATITUDE_SUMMER: high_latitude_summer_temperature,
    AtmosphereRegion.HIGH_LATITUDE_WINTER: high_latitude_winter_temperature,
}

_REGION_PRESSURE = {
    AtmosphereRegion.LOW_LATITUDE_ANNUAL:  low_latitude_annual_pressure,
    AtmosphereRegion.MID_LATITUDE_SUMMER:  mid_latitude_summer_pressure,
    AtmosphereRegion.MID_LATITUDE_WINTER:  mid_latitude_winter_pressure,
    AtmosphereRegion.HIGH_LATITUDE_SUMMER: high_latitude_summer_pressure,
    AtmosphereRegion.HIGH_LATITUDE_WINTER: high_latitude_winter_pressure,
}

_REGION_WATER_VAPOUR = {
    AtmosphereRegion.LOW_LATITUDE_ANNUAL:  low_latitude_annual_water_vapour,
    AtmosphereRegion.MID_LATITUDE_SUMMER:  mid_latitude_summer_water_vapour,
    AtmosphereRegion.MID_LATITUDE_WINTER:  mid_latitude_winter_water_vapour,
    AtmosphereRegion.HIGH_LATITUDE_SUMMER: high_latitude_summer_water_vapour,
    AtmosphereRegion.HIGH_LATITUDE_WINTER: high_latitude_winter_water_vapour,
}


def regional_temperature(z_km: float, region: AtmosphereRegion) -> float:
    """T(Z) для заданного региона."""
    return _REGION_TEMPERATURE[region](z_km)


def regional_pressure(z_km: float, region: AtmosphereRegion) -> float:
    """P(Z) для заданного региона."""
    return _REGION_PRESSURE[region](z_km)


def regional_water_vapour(z_km: float, region: AtmosphereRegion) -> float:
    """ρ(Z) для заданного региона."""
    return _REGION_WATER_VAPOUR[region](z_km)


def get_region_for_latitude(
    lat_deg: float, season: Season
) -> AtmosphereRegion:
    """
    Возвращает региональную атмосферу по широте и сезону.

    Логика Annex 2:
        0°–15°N: low annual (все сезоны)
        ≥ 60°N:  high (по сезону)
        между 15° и 45° или 45° и 60° — интерполяция (см. interp)
        Для отрицательных широт (южное полушарие) — по модулю.

    Args:
        lat_deg: широта в градусах.
        season: Season.SUMMER или Season.WINTER.

    Returns:
        AtmosphereRegion (без интерполяции). Для интерполяции
        используйте interpolated_temperature / _pressure / _water_vapour.
    """
    abs_lat = abs(lat_deg)
    if abs_lat <= 15.0:
        return AtmosphereRegion.LOW_LATITUDE_ANNUAL
    if abs_lat >= 60.0:
        return (AtmosphereRegion.HIGH_LATITUDE_SUMMER if season == Season.SUMMER
                else AtmosphereRegion.HIGH_LATITUDE_WINTER)
    if abs_lat <= 45.0:
        return (AtmosphereRegion.MID_LATITUDE_SUMMER if season == Season.SUMMER
                else AtmosphereRegion.MID_LATITUDE_WINTER)
    return (AtmosphereRegion.HIGH_LATITUDE_SUMMER if season == Season.SUMMER
            else AtmosphereRegion.HIGH_LATITUDE_WINTER)


def _interp_between_regions(
    z_km: float,
    lat_deg: float,
    season: Season,
    accessor,
) -> float:
    """
    Внутренняя: интерполяция между двумя регионами по широте.

    Args:
        z_km: высота.
        lat_deg: широта.
        season: сезон.
        accessor: функция, возвращающая T(Z, region) для нужного параметра.
    """
    abs_lat = abs(lat_deg)

    if abs_lat <= 15.0:
        return accessor(z_km, AtmosphereRegion.LOW_LATITUDE_ANNUAL)

    low_val = accessor(z_km, AtmosphereRegion.LOW_LATITUDE_ANNUAL)

    if abs_lat <= 45.0:
        mid_region = (AtmosphereRegion.MID_LATITUDE_SUMMER if season == Season.SUMMER
                      else AtmosphereRegion.MID_LATITUDE_WINTER)
        mid_val = accessor(z_km, mid_region)
        t = (abs_lat - 15.0) / (45.0 - 15.0)
        return low_val * (1.0 - t) + mid_val * t

    if abs_lat < 60.0:
        mid_region = (AtmosphereRegion.MID_LATITUDE_SUMMER if season == Season.SUMMER
                      else AtmosphereRegion.MID_LATITUDE_WINTER)
        high_region = (AtmosphereRegion.HIGH_LATITUDE_SUMMER if season == Season.SUMMER
                       else AtmosphereRegion.HIGH_LATITUDE_WINTER)
        mid_val = accessor(z_km, mid_region)
        high_val = accessor(z_km, high_region)
        t = (abs_lat - 45.0) / (60.0 - 45.0)
        return mid_val * (1.0 - t) + high_val * t

    return accessor(z_km, (
        AtmosphereRegion.HIGH_LATITUDE_SUMMER if season == Season.SUMMER
        else AtmosphereRegion.HIGH_LATITUDE_WINTER
    ))


def interpolated_temperature(
    z_km: float, lat_deg: float, season: Season
) -> float:
    """T(Z) с линейной интерполяцией по широте."""
    return _interp_between_regions(z_km, lat_deg, season, regional_temperature)


def interpolated_pressure(
    z_km: float, lat_deg: float, season: Season
) -> float:
    """P(Z) с линейной интерполяцией по широте."""
    return _interp_between_regions(z_km, lat_deg, season, regional_pressure)


def interpolated_water_vapour(
    z_km: float, lat_deg: float, season: Season
) -> float:
    """ρ(Z) с линейной интерполяцией по широте."""
    return _interp_between_regions(z_km, lat_deg, season, regional_water_vapour)


__all__ = [
    'AtmosphereRegion', 'Season',
    # Low
    'low_latitude_annual_temperature',
    'low_latitude_annual_pressure',
    'low_latitude_annual_water_vapour',
    # Mid summer
    'mid_latitude_summer_temperature',
    'mid_latitude_summer_pressure',
    'mid_latitude_summer_water_vapour',
    # Mid winter
    'mid_latitude_winter_temperature',
    'mid_latitude_winter_pressure',
    'mid_latitude_winter_water_vapour',
    # High summer
    'high_latitude_summer_temperature',
    'high_latitude_summer_pressure',
    'high_latitude_summer_water_vapour',
    # High winter
    'high_latitude_winter_temperature',
    'high_latitude_winter_pressure',
    'high_latitude_winter_water_vapour',
    # Региональный доступ
    'regional_temperature', 'regional_pressure', 'regional_water_vapour',
    'get_region_for_latitude',
    'interpolated_temperature', 'interpolated_pressure',
    'interpolated_water_vapour',
]

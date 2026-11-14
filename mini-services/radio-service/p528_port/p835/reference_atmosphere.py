# Copyright (c) 2026 Evgeny Gennadievich Prutkov <sviazist.pr@gmail.com>
# SPDX-License-Identifier: MIT
#
# Python implementation of ITU-R P.835-7.
# See README.md and NOTICE for attribution.

"""
core/itu/p835/reference_atmosphere.py — ITU-R reference atmosphere
по ITU-R P.835-7, Annex 1.

Реализует:
    * GlobalTemperature(Z) — температура, K
    * GlobalPressure(Z) — давление, гПа
    * GlobalWaterVapourDensity(Z, rho_0) — плотность H₂O, г/м³
    * GlobalWetPressure(Z, rho_0) — парциальное давление H₂O, гПа

Диапазон высот: Z ∈ [0, 100] км.

Два режима (P.835-7, Annex 1 §1.1):
    * Regime 1: Z ≤ 86 км → вычисляется через геопотенциальную высоту H.
    * Regime 2: 86 < Z ≤ 100 км → вычисляется напрямую по Z.

ВАЖНО: в документе P.835-7 (08/2024) формула (4b) для T(Z) в regime 2
содержит опечатку OCR: T = 263.1905 − 76.3232·[1 − ((Z−91)/19.9429)^½]².
Правильная формула — с квадратом (без корня) внутри скобок:
    T = 263.1905 − 76.3232·√(1 − ((Z−91)/19.9429)²)
Это классическая U.S. Standard Atmosphere 1976.
"""

import math

from .common.constants import (
    P835_Z_MIN_KM,
    P835_Z_MAX_KM,
    P835_Z_REGIME1_MAX_KM,
    P835_H_REGIME1_MAX_KM,
    RHO0_WATER_G_M3,
)
from .common.exceptions import ITUValidationError
from .conversions import (
    convert_to_geopotential_height,
    water_vapour_density_to_pressure,
)


MODEL_NAME = "ITU-R P.835-7"


# =====================================================================
# ТЕМПЕРАТУРА
# =====================================================================

def _global_temperature_regime1(h_prime_km: float) -> float:
    """
    Температура T(H) для geopotential height H ≤ 84.852 км.
    P.835-7, ур. (2a–2g).

    Args:
        h_prime_km: геопотенциальная высота, км.

    Returns:
        Температура, K.
    """
    if h_prime_km < 0.0:
        raise ITUValidationError(
            MODEL_NAME, "H'", h_prime_km, ">= 0"
        )

    if h_prime_km <= 11.0:
        return 288.15 - 6.5 * h_prime_km
    elif h_prime_km <= 20.0:
        return 216.65
    elif h_prime_km <= 32.0:
        return 216.65 + (h_prime_km - 20.0)
    elif h_prime_km <= 47.0:
        return 228.65 + 2.8 * (h_prime_km - 32.0)
    elif h_prime_km <= 51.0:
        return 270.65
    elif h_prime_km <= 71.0:
        return 270.65 - 2.8 * (h_prime_km - 51.0)
    elif h_prime_km <= P835_H_REGIME1_MAX_KM:
        return 214.65 - 2.0 * (h_prime_km - 71.0)
    else:
        raise ITUValidationError(
            MODEL_NAME, "H'", h_prime_km,
            f"<= {P835_H_REGIME1_MAX_KM}"
        )


def _global_temperature_regime2(z_km: float) -> float:
    """
    Температура T(Z) для geometric height 86 ≤ Z ≤ 100 км.
    P.835-7, ур. (4a, 4b).

    Ур. (4a): T = 186.8673                       для 86 < Z ≤ 91
    Ур. (4b): T = 263.1905 − 76.3232·√(1 − ((Z−91)/19.9429)²) для 91 < Z ≤ 100

    Args:
        z_km: геометрическая высота, км.

    Returns:
        Температура, K.
    """
    if z_km < P835_Z_REGIME1_MAX_KM:
        raise ITUValidationError(
            MODEL_NAME, "Z", z_km, f">= {P835_Z_REGIME1_MAX_KM}"
        )
    if z_km > P835_Z_MAX_KM:
        raise ITUValidationError(
            MODEL_NAME, "Z", z_km, f"<= {P835_Z_MAX_KM}"
        )

    if z_km <= 91.0:
        return 186.8673

    ratio = (z_km - 91.0) / 19.9429
    arg = 1.0 - ratio * ratio
    if arg < 0.0:
        arg = 0.0
    return 263.1905 - 76.3232 * math.sqrt(arg)


def global_temperature(z_km: float) -> float:
    """
    Температура T(Z) на высоте Z, K.

    Args:
        z_km: геометрическая высота, км (0 ≤ Z ≤ 100).

    Returns:
        Температура, K.

    Raises:
        ITUValidationError: если Z вне [0, 100].
    """
    if z_km < P835_Z_MIN_KM or z_km > P835_Z_MAX_KM:
        raise ITUValidationError(
            MODEL_NAME, "Z", z_km,
            f"[{P835_Z_MIN_KM}, {P835_Z_MAX_KM}]"
        )

    if z_km < P835_Z_REGIME1_MAX_KM:
        h_prime = convert_to_geopotential_height(z_km)
        return _global_temperature_regime1(h_prime)
    else:
        return _global_temperature_regime2(z_km)


# =====================================================================
# ДАВЛЕНИЕ
# =====================================================================

def _global_pressure_regime1(h_prime_km: float) -> float:
    """
    Давление P(H) для geopotential height H ≤ 84.852 км.
    P.835-7, ур. (3a–3g).

    Args:
        h_prime_km: геопотенциальная высота, км.

    Returns:
        Давление, гПа.
    """
    if h_prime_km < 0.0:
        raise ITUValidationError(
            MODEL_NAME, "H'", h_prime_km, ">= 0"
        )

    if h_prime_km <= 11.0:
        return 1013.25 * (288.15 / (288.15 - 6.5 * h_prime_km)) ** (-34.1632 / 6.5)
    elif h_prime_km <= 20.0:
        return 226.3226 * math.exp(-34.1632 * (h_prime_km - 11.0) / 216.65)
    elif h_prime_km <= 32.0:
        return 54.74980 * (216.65 / (216.65 + (h_prime_km - 20.0))) ** 34.1632
    elif h_prime_km <= 47.0:
        return 8.680422 * (228.65 / (228.65 + 2.8 * (h_prime_km - 32.0))) ** (34.1632 / 2.8)
    elif h_prime_km <= 51.0:
        return 1.109106 * math.exp(-34.1632 * (h_prime_km - 47.0) / 270.65)
    elif h_prime_km <= 71.0:
        return 0.6694167 * (270.65 / (270.65 - 2.8 * (h_prime_km - 51.0))) ** (-34.1632 / 2.8)
    elif h_prime_km <= P835_H_REGIME1_MAX_KM:
        return 0.03956649 * (214.65 / (214.65 - 2.0 * (h_prime_km - 71.0))) ** (-34.1632 / 2.0)
    else:
        raise ITUValidationError(
            MODEL_NAME, "H'", h_prime_km,
            f"<= {P835_H_REGIME1_MAX_KM}"
        )


def _global_pressure_regime2(z_km: float) -> float:
    """
    Давление P(Z) для geometric height 86 ≤ Z ≤ 100 км.
    P.835-7, ур. (5).

    Args:
        z_km: геометрическая высота, км.

    Returns:
        Давление, гПа.
    """
    if z_km < P835_Z_REGIME1_MAX_KM:
        raise ITUValidationError(
            MODEL_NAME, "Z", z_km, f">= {P835_Z_REGIME1_MAX_KM}"
        )
    if z_km > P835_Z_MAX_KM:
        raise ITUValidationError(
            MODEL_NAME, "Z", z_km, f"<= {P835_Z_MAX_KM}"
        )

    a0 = 95.571899
    a1 = -4.011801
    a2 = 6.424731e-2
    a3 = -4.789660e-4
    a4 = 1.340543e-6

    z = z_km
    return math.exp(
        a0 + a1 * z + a2 * z * z + a3 * z * z * z + a4 * z * z * z * z
    )


def global_pressure(z_km: float) -> float:
    """
    Давление P(Z) на высоте Z, гПа.

    Args:
        z_km: геометрическая высота, км (0 ≤ Z ≤ 100).

    Returns:
        Давление, гПа.

    Raises:
        ITUValidationError: если Z вне [0, 100].
    """
    if z_km < P835_Z_MIN_KM or z_km > P835_Z_MAX_KM:
        raise ITUValidationError(
            MODEL_NAME, "Z", z_km,
            f"[{P835_Z_MIN_KM}, {P835_Z_MAX_KM}]"
        )

    if z_km < P835_Z_REGIME1_MAX_KM:
        h_prime = convert_to_geopotential_height(z_km)
        return _global_pressure_regime1(h_prime)
    else:
        return _global_pressure_regime2(z_km)


# =====================================================================
# ПЛОТНОСТЬ ВОДЯНОГО ПАРА
# =====================================================================

def global_water_vapour_density(
    z_km: float, rho_0_g_m3: float = RHO0_WATER_G_M3
) -> float:
    """
    Плотность водяного пара ρ(Z), г/м³.

    P.835-7, ур. (6), (8):
        ρ(Z) = 7.5·exp(−Z/2)                              (6)
        ρ(Z) = 2e−6 · P(Z)·216.7 / T(Z)  (выше точки смешивания) (8)

    Точка смешивания: e(Z)/P(Z) = 2e−6, где e(Z) — парциальное
    давление H₂O из ур. (7). Выше этой точки используется ур. (8).

    Args:
        z_km: геометрическая высота, км (0 ≤ Z ≤ 100).
        rho_0_g_m3: плотность H₂O у поверхности, г/м³ (по умолчанию 7.5).

    Returns:
        Плотность водяного пара, г/м³.

    Raises:
        ITUValidationError: если Z вне [0, 100].
    """
    if z_km < P835_Z_MIN_KM or z_km > P835_Z_MAX_KM:
        raise ITUValidationError(
            MODEL_NAME, "Z", z_km,
            f"[{P835_Z_MIN_KM}, {P835_Z_MAX_KM}]"
        )

    # Базовая экспонента (ур. 6)
    rho_exp = rho_0_g_m3 * math.exp(-z_km / 2.0)

    # Парциальное давление (ур. 7)
    T = global_temperature(z_km)
    e_hpa = water_vapour_density_to_pressure(rho_exp, T)
    P_hpa = global_pressure(z_km)

    # Проверяем mixing ratio
    if P_hpa <= 0.0:
        return 0.0
    mixing_ratio = e_hpa / P_hpa

    # Если mixing ratio ниже 2e-6 — используем ур. (8)
    if mixing_ratio < 2.0e-6:
        return 2.0e-6 * P_hpa * 216.7 / T

    return rho_exp


def global_wet_pressure(
    z_km: float, rho_0_g_m3: float = RHO0_WATER_G_M3
) -> float:
    """
    Парциальное давление водяного пара e(Z), гПа.

    P.835-7, ур. (7):
        e(Z) = ρ(Z)·T(Z) / 216.7

    Args:
        z_km: геометрическая высота, км.
        rho_0_g_m3: плотность H₂O у поверхности, г/м³.

    Returns:
        Парциальное давление, гПа.
    """
    rho = global_water_vapour_density(z_km, rho_0_g_m3)
    T = global_temperature(z_km)
    return water_vapour_density_to_pressure(rho, T)


__all__ = [
    'global_temperature',
    'global_pressure',
    'global_water_vapour_density',
    'global_wet_pressure',
    'MODEL_NAME',
]

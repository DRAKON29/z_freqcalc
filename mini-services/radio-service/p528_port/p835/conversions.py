# Copyright (c) 2026 Evgeny Gennadievich Prutkov <sviazist.pr@gmail.com>
# SPDX-License-Identifier: MIT
#
# Python implementation of ITU-R P.835-7.
# See README.md and NOTICE for attribution.

"""
core/itu/p835/conversions.py — Преобразования высот и давлений
по ITU-R P.835-7 (Annex 1).

Формулы:
    (1a): H = 6356.766·Z / (6356.766 + Z)
    (1b): Z = 6356.766·H / (6356.766 − H)
    (7):  e = ρ·T / 216.7
"""

from .common.constants import EARTH_RADIUS_P835_KM


def convert_to_geopotential_height(z_km: float) -> float:
    """
    Геометрическая высота Z (км) → геопотенциальная H (км).

    P.835-7, ур. (1a):
        H = 6356.766·Z / (6356.766 + Z)

    Args:
        z_km: геометрическая высота, км (0..100).

    Returns:
        Геопотенциальная высота, км.
    """
    r = EARTH_RADIUS_P835_KM
    return (r * z_km) / (r + z_km)


def convert_to_geometric_height(h_km: float) -> float:
    """
    Геопотенциальная высота H (км) → геометрическая Z (км).

    P.835-7, ур. (1b):
        Z = 6356.766·H / (6356.766 − H)

    Args:
        h_km: геопотенциальная высота, км (0..84.852).

    Returns:
        Геометрическая высота, км.

    Raises:
        ValueError: если h_km >= 6356.766 (вырожденный случай).
    """
    r = EARTH_RADIUS_P835_KM
    if h_km >= r:
        raise ValueError(
            f"convert_to_geometric_height: H={h_km} км ≥ {r} км"
        )
    return (r * h_km) / (r - h_km)


def water_vapour_density_to_pressure(
    rho_g_m3: float, temperature_k: float
) -> float:
    """
    Плотность водяного пара ρ (г/м³) → парциальное давление e (гПа).

    P.835-7, ур. (7):
        e = ρ·T / 216.7

    Args:
        rho_g_m3: плотность водяного пара, г/м³.
        temperature_k: температура, K.

    Returns:
        Парциальное давление водяного пара, гПа.
    """
    return rho_g_m3 * temperature_k / 216.7


def water_vapour_pressure_to_density(
    e_hpa: float, temperature_k: float
) -> float:
    """
    Парциальное давление e (гПа) → плотность ρ (г/м³).

    Обратная к (7):
        ρ = e·216.7 / T

    Args:
        e_hpa: парциальное давление, гПа.
        temperature_k: температура, K.

    Returns:
        Плотность водяного пара, г/м³.
    """
    if temperature_k <= 0:
        return 0.0
    return e_hpa * 216.7 / temperature_k


__all__ = [
    'convert_to_geopotential_height',
    'convert_to_geometric_height',
    'water_vapour_density_to_pressure',
    'water_vapour_pressure_to_density',
]

# Copyright (c) 2026 Evgeny Gennadievich Prutkov <sviazist.pr@gmail.com>
# SPDX-License-Identifier: MIT
#
# Python implementation of ITU-R P.528-5.
# See README.md and NOTICE for attribution.

"""
core/itu/p528/smooth_earth.py — Smooth Earth diffraction.
Порт C++ SmoothEarthDiffraction.cpp, §10.
"""

import math

from .constants import (
    sigma, epsilon_r,
    POLARIZATION__HORIZONTAL, POLARIZATION__VERTICAL,
    THIRD,
)


def _distance_function(x__km: float) -> float:
    """G(x) = 0.05751·x − 10·log₁₀(x)."""
    return 0.05751 * x__km - 10.0 * math.log10(x__km)


def _height_function(x__km: float, K: float) -> float:
    """F(x) — функция высоты (Vogler 1964, FAA-ES-83-3)."""
    y__db = 40.0 * math.log10(x__km) - 117.0
    G_x__db = _distance_function(x__km)

    if x__km <= 200.0:
        x_t__km = 450.0 / -(math.log10(K) ** 3)

        if x__km >= x_t__km:
            F_x__db = y__db if abs(y__db) < 117 else -117.0
        else:
            F_x__db = 20.0 * math.log10(K) - 15.0 + (0.000025 * x__km ** 2 / K)
    elif x__km > 2000.0:
        F_x__db = G_x__db
    else:
        W = 0.0134 * x__km * math.exp(-0.005 * x__km)
        F_x__db = W * y__db + (1.0 - W) * G_x__db

    return F_x__db


def smooth_earth_diffraction(
    d_1__km: float, d_2__km: float, f__mhz: float, d_0__km: float, T_pol: int
) -> float:
    """
    Smooth Earth diffraction loss (§10, ур. 78).

    Args:
        d_1__km: расстояние до горизонта терминала 1, км.
        d_2__km: расстояние до горизонта терминала 2, км.
        f__mhz: частота, МГц.
        d_0__km: интересующее расстояние, км.
        T_pol: 0 = HORIZONTAL, 1 = VERTICAL.

    Returns:
        A_d — дифракционные потери, дБ.
    """
    s = 18000.0 * sigma / f__mhz

    # [Eqn 80]
    if T_pol == POLARIZATION__HORIZONTAL:
        K = (0.01778 * f__mhz ** (-THIRD)
             * ((epsilon_r - 1) ** 2 + s ** 2) ** (-0.25))
    else:
        K = (0.01778 * f__mhz ** (-THIRD)
             * ((epsilon_r ** 2 + s ** 2) / ((epsilon_r - 1) ** 2 + s ** 2) ** 0.5) ** 0.5)

    B_0 = 1.607

    # [Eqn 81] — normalized distances
    x_0__km = (B_0 - K) * f__mhz ** THIRD * d_0__km
    x_1__km = (B_0 - K) * f__mhz ** THIRD * d_1__km
    x_2__km = (B_0 - K) * f__mhz ** THIRD * d_2__km

    # [Eqn 82]
    G_x__db = _distance_function(x_0__km)

    # [Eqn 83-88]
    F_x1__db = _height_function(x_1__km, K)
    F_x2__db = _height_function(x_2__km, K)

    # [Eqn 78]
    return G_x__db - F_x1__db - F_x2__db - 20.0


__all__ = ['smooth_earth_diffraction']

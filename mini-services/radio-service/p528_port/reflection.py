# Copyright (c) 2026 Evgeny Gennadievich Prutkov <sviazist.pr@gmail.com>
# SPDX-License-Identifier: MIT
#
# Python implementation of ITU-R P.528-5.
# See README.md and NOTICE for attribution.

"""
core/itu/p528/reflection.py — Ground reflection coefficients.
Порт C++ ReflectionCoefficients.cpp, §9.
"""

import math

from .constants import (
    sigma, epsilon_r,
    POLARIZATION__HORIZONTAL, POLARIZATION__VERTICAL,
    PI,
)


def reflection_coefficients(psi__rad: float, f__mhz: float, T_pol: int):
    """
    Коэффициенты отражения от земли (§9).

    Args:
        psi__rad: угол отражения, рад.
        f__mhz: частота, МГц.
        T_pol: 0 = HORIZONTAL, 1 = VERTICAL.

    Returns:
        (R_g, phi_g) — модуль и фаза коэффициента отражения.
    """
    # Обработка крайних случаев
    if psi__rad <= 0.0:
        psi__rad = 0.0
        sin_psi = 0.0
        cos_psi = 1.0
    elif psi__rad >= PI / 2:
        psi__rad = PI / 2
        sin_psi = 1.0
        cos_psi = 0.0
    else:
        sin_psi = math.sin(psi__rad)
        cos_psi = math.cos(psi__rad)

    X = (18000.0 * sigma) / f__mhz                       # [Eqn 9-1]
    Y = epsilon_r - cos_psi ** 2                          # [Eqn 9-2]
    T = math.sqrt(Y ** 2 + X ** 2) + Y                    # [Eqn 9-3]
    P = math.sqrt(T * 0.5)                                # [Eqn 9-4]
    Q = X / (2.0 * P)                                     # [Eqn 9-5]

    # [Eqn 9-6]
    if T_pol == POLARIZATION__HORIZONTAL:
        B = 1.0 / (P ** 2 + Q ** 2)
    else:
        B = (epsilon_r ** 2 + X ** 2) / (P ** 2 + Q ** 2)

    # [Eqn 9-7]
    if T_pol == POLARIZATION__HORIZONTAL:
        A = (2.0 * P) / (P ** 2 + Q ** 2)
    else:
        A = (2.0 * (P * epsilon_r + Q * X)) / (P ** 2 + Q ** 2)

    # [Eqn 9-8]
    R_g = math.sqrt(
        (1.0 + B * sin_psi ** 2 - A * sin_psi)
        / (1.0 + B * sin_psi ** 2 + A * sin_psi)
    )

    # [Eqn 9-9]
    if T_pol == POLARIZATION__HORIZONTAL:
        alpha = math.atan2(-Q, sin_psi - P)
    else:
        alpha = math.atan2((epsilon_r * sin_psi) - Q, epsilon_r * sin_psi - P)

    # [Eqn 9-10]
    if T_pol == POLARIZATION__HORIZONTAL:
        beta = math.atan2(Q, sin_psi + P)
    else:
        beta = math.atan2((X * sin_psi) + Q, epsilon_r * sin_psi + P)

    # [Eqn 9-11]
    phi_g = alpha - beta

    return R_g, phi_g


__all__ = ['reflection_coefficients']

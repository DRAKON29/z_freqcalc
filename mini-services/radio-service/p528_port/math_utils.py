# Copyright (c) 2026 Evgeny Gennadievich Prutkov <sviazist.pr@gmail.com>
# SPDX-License-Identifier: MIT
#
# Python implementation of ITU-R P.528-5.
# See README.md and NOTICE for attribution.

"""
core/itu/p528/math_utils.py — Математические утилиты P.528-5.
Порт C++ LinearInterpolation.cpp, InverseComplementaryCumulativeDistributionFunction.cpp,
CombineDistributions.cpp.
"""

import math


def linear_interpolation(x1: float, y1: float, x2: float, y2: float,
                          x: float) -> float:
    """Линейная интерполяция (C++ LinearInterpolation)."""
    return (y1 * (x2 - x) + y2 * (x - x1)) / (x2 - x1)


def inverse_complementary_cdf(q: float) -> float:
    """
    Обратная дополнительная CDF (C++ InverseComplementaryCumulativeDistributionFunction).

    Аппроксимация Abramowitz & Stegun 26.2.23, |ε(p)| < 4.5e-4.

    Args:
        q: вероятность, 0 < q < 1.

    Returns:
        Q⁻¹(q).
    """
    C_0 = 2.515516
    C_1 = 0.802853
    C_2 = 0.010328
    D_1 = 1.432788
    D_2 = 0.189269
    D_3 = 0.001308

    x = q
    if q > 0.5:
        x = 1.0 - x

    T_x = math.sqrt(-2.0 * math.log(x))
    zeta_x = ((C_2 * T_x + C_1) * T_x + C_0) / (
        ((D_3 * T_x + D_2) * T_x + D_1) * T_x + 1.0
    )

    Q_q = T_x - zeta_x
    if q > 0.5:
        Q_q = -Q_q

    return Q_q


def combine_distributions(A_M: float, A_p: float,
                          B_M: float, B_p: float, p: float) -> float:
    """
    Комбинирует два распределения (C++ CombineDistributions).

    Args:
        A_M: среднее распределения A.
        A_p: p% распределения A.
        B_M: среднее распределения B.
        B_p: p% распределения B.
        p: процент.

    Returns:
        C_p — p% результирующего распределения.
    """
    C_M = A_M + B_M
    Y_1 = A_p - A_M
    Y_2 = B_p - B_M
    Y_3 = math.sqrt(Y_1 ** 2 + Y_2 ** 2)

    if p < 50:
        return C_M + Y_3
    return C_M - Y_3


__all__ = [
    'linear_interpolation',
    'inverse_complementary_cdf',
    'combine_distributions',
]

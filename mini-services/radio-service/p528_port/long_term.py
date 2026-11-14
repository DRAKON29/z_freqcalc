# Copyright (c) 2026 Evgeny Gennadievich Prutkov <sviazist.pr@gmail.com>
# SPDX-License-Identifier: MIT
#
# Python implementation of ITU-R P.528-5.
# See README.md and NOTICE for attribution.

"""
core/itu/p528/long_term.py — LongTermVariability (§14).
Порт C++ LongTermVariability.cpp.
"""

import math
from bisect import bisect_left

from .data import P
from .math_utils import linear_interpolation, inverse_complementary_cdf
from .constants import THIRD


def long_term_variability(
    d_r1__km: float,
    d_r2__km: float,
    d__km: float,
    f__mhz: float,
    p: float,
    f_theta_h: float,
    A_T: float,
):
    """
    Long term variability (§14).

    Args:
        d_r1__km: горизонт нижнего терминала, км.
        d_r2__km: горизонт верхнего терминала, км.
        d__km: расстояние, км.
        f__mhz: частота, МГц.
        p: процент времени.
        f_theta_h: параметр из §13.
        A_T: потери (дифракция или тропосфера), дБ (вход в §14 — как −A_T).

    Returns:
        (Y_e__db, A_Y) — вариабельность и корректировочный фактор.
    """
    # [Eqn 14-1]
    d_qs__km = 65.0 * (100.0 / f__mhz) ** THIRD

    # [Eqn 14-2]
    d_Lq__km = d_r1__km + d_r2__km

    # [Eqn 14-3]
    d_q__km = d_Lq__km + d_qs__km

    # [Eqn 14-4]
    if d__km <= d_q__km:
        d_e__km = (130.0 * d__km) / d_q__km
    else:
        d_e__km = 130.0 + d__km - d_q__km

    # [Eqn 14-5, 14-6]
    if f__mhz > 1600.0:
        g_10 = 1.05
        g_90 = 1.05
    else:
        g_10 = 0.21 * math.sin(5.22 * math.log10(f__mhz / 200.0)) + 1.28
        g_90 = 0.18 * math.sin(5.22 * math.log10(f__mhz / 200.0)) + 1.23

    # Данные из Tech Note 101
    c_1 = [2.93e-4, 5.25e-4, 1.59e-5]
    c_2 = [3.78e-8, 1.57e-6, 1.56e-11]
    c_3 = [1.02e-7, 4.70e-7, 2.77e-8]

    n_1 = [2.00, 1.97, 2.32]
    n_2 = [2.88, 2.31, 4.08]
    n_3 = [3.15, 2.90, 3.25]

    f_inf = [3.2, 5.4, 0.0]
    f_m = [8.2, 10.0, 3.9]

    # Z__db = [Y_0(90), Y_0(10), V(50)]
    Z__db = [0.0, 0.0, 0.0]
    for i in range(3):
        f_2 = f_inf[i] + ((f_m[i] - f_inf[i])
                           * math.exp(-c_2[i] * d_e__km ** n_2[i]))
        Z__db[i] = ((c_1[i] * d_e__km ** n_1[i] - f_2)
                     * math.exp(-c_3[i] * d_e__km ** n_3[i]) + f_2)

    # Y_p
    if p == 50:
        Y_p__db = Z__db[2]
    elif p > 50:
        z_90 = inverse_complementary_cdf(90.0 / 100.0)
        z_p = inverse_complementary_cdf(p / 100.0)
        c_p = z_p / z_90
        Y = c_p * (-Z__db[0] * g_90)
        Y_p__db = Y + Z__db[2]
    else:
        if p >= 10:
            z_10 = inverse_complementary_cdf(10.0 / 100.0)
            z_p = inverse_complementary_cdf(p / 100.0)
            c_p = z_p / z_10
        else:
            ps = [1.0, 2.0, 5.0, 10.0]
            c_ps = [1.9507, 1.7166, 1.3265, 1.0000]
            upper = bisect_left(list(P), p)
            dist = upper
            c_p = linear_interpolation(ps[dist - 1], c_ps[dist - 1],
                                        ps[dist], c_ps[dist], p)

        Y = c_p * (Z__db[1] * g_10)
        Y_p__db = Y + Z__db[2]

    # [Eqn 14-20]
    Y_10__db = (Z__db[1] * g_10) + Z__db[2]

    # [Eqn 14-21, 14-22]
    Y_eI__db = f_theta_h * Y_p__db
    Y_eI_10__db = f_theta_h * Y_10__db

    # [Eqn 14-23] — вход A_T используется со знаком + (в C++ так)
    A_YI = (A_T + Y_eI_10__db) - 3.0
    A_Y = max(A_YI, 0.0)                                    # [Eqn 14-24]
    Y_e__db = Y_eI__db - A_Y                                 # [Eqn 14-25]

    # Correction for p < 10
    if p < 10:
        c_Y = [-5.0, -4.5, -3.7, 0.0]
        upper = bisect_left(list(P), p)
        dist = upper
        c_Yi = linear_interpolation(P[dist - 1], c_Y[dist - 1],
                                      P[dist], c_Y[dist], p)

        Y_e__db += A_T
        if Y_e__db > -c_Yi:
            Y_e__db = -c_Yi
        Y_e__db -= A_T

    return Y_e__db, A_Y

    return Y_e__db, A_Y


__all__ = ['long_term_variability']

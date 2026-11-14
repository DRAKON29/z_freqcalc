# Copyright (c) 2026 Evgeny Gennadievich Prutkov <sviazist.pr@gmail.com>
# SPDX-License-Identifier: MIT
#
# Python implementation of ITU-R P.528-5.
# See README.md and NOTICE for attribution.

"""
itu/p528/nakagami_rice.py — Распределение Nakagami-Rice.
Без numpy: K, P, NakagamiRiceCurves — кортежи tuple.
"""

from bisect import bisect_left

from .data import P, K, NakagamiRiceCurves
from .constants import Y_pi_99_INDEX
from .math_utils import linear_interpolation


_K_list = list(K)
_P_list = list(P)


def nakagami_rice(K_val: float, p: float) -> float:
    d_K = bisect_left(_K_list, K_val)
    d_p = bisect_left(_P_list, p)

    if d_K == 0:
        if d_p == 0:
            return float(NakagamiRiceCurves[0][0])
        return linear_interpolation(
            P[d_p], NakagamiRiceCurves[0][d_p],
            P[d_p - 1], NakagamiRiceCurves[0][d_p - 1], p)
    elif d_K == len(K):
        if d_p == 0:
            return float(NakagamiRiceCurves[d_K - 1][0])
        return linear_interpolation(
            P[d_p], NakagamiRiceCurves[d_K - 1][d_p],
            P[d_p - 1], NakagamiRiceCurves[d_K - 1][d_p - 1], p)
    else:
        if d_p == 0:
            return linear_interpolation(
                K[d_K], NakagamiRiceCurves[d_K][0],
                K[d_K - 1], NakagamiRiceCurves[d_K - 1][0], K_val)
        v1 = linear_interpolation(
            K[d_K], NakagamiRiceCurves[d_K][d_p],
            K[d_K - 1], NakagamiRiceCurves[d_K - 1][d_p], K_val)
        v2 = linear_interpolation(
            K[d_K], NakagamiRiceCurves[d_K][d_p - 1],
            K[d_K - 1], NakagamiRiceCurves[d_K - 1][d_p - 1], K_val)
        return linear_interpolation(P[d_p], v1, P[d_p - 1], v2, p)


def find_k_for_ypi_at_99(Y_pi_99__db: float) -> float:
    if Y_pi_99__db < NakagamiRiceCurves[0][Y_pi_99_INDEX]:
        return float(K[0])
    for i in range(len(K)):
        y_hi = NakagamiRiceCurves[i][Y_pi_99_INDEX]
        if Y_pi_99__db - y_hi < 0:
            y_lo = NakagamiRiceCurves[i - 1][Y_pi_99_INDEX]
            return float(
                (K[i] * (Y_pi_99__db - y_lo)
                 - K[i - 1] * (Y_pi_99__db - y_hi))
                / (y_hi - y_lo))
    return float(K[-1])


__all__ = ['nakagami_rice', 'find_k_for_ypi_at_99']

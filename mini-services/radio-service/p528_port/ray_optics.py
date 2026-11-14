# Copyright (c) 2026 Evgeny Gennadievich Prutkov <sviazist.pr@gmail.com>
# SPDX-License-Identifier: MIT
#
# Python implementation of ITU-R P.528-5.
# See README.md and NOTICE for attribution.

"""
core/itu/p528/ray_optics.py — RayOptics (§7).
Порт C++ RayOptics.cpp.
"""

import math

from .constants import a_0__km, a_e__km
from .types import Terminal, LineOfSightParams


def ray_optics(terminal_1: Terminal, terminal_2: Terminal,
               psi: float, params: LineOfSightParams) -> None:
    """
    LOS ray optics (§7).

    Args:
        terminal_1: нижний терминал.
        terminal_2: верхний терминал.
        psi: угол отражения, рад.
        params: LineOfSightParams (модифицируется in-place).
    """
    z = (a_0__km / a_e__km) - 1                              # [Eqn 7-1]
    k_a = 1.0 / (1.0 + z * math.cos(psi))                    # [Eqn 7-2]
    params.a_a__km = a_0__km * k_a                            # [Eqn 7-3]

    # [Eqn 7-4]
    delta_h_a1__km = terminal_1.delta_h__km * (params.a_a__km - a_0__km) / (a_e__km - a_0__km)
    delta_h_a2__km = terminal_2.delta_h__km * (params.a_a__km - a_0__km) / (a_e__km - a_0__km)

    # [Eqn 7-5]
    H__km = [
        terminal_1.h_r__km - delta_h_a1__km,
        terminal_2.h_r__km - delta_h_a2__km,
    ]

    Hprime__km = [0.0, 0.0]
    for i in range(2):
        params.z__km[i] = params.a_a__km + H__km[i]                                  # [Eqn 7-6]
        params.theta[i] = math.acos(params.a_a__km * math.cos(psi) / params.z__km[i]) - psi  # [Eqn 7-7]
        params.D__km[i] = params.z__km[i] * math.sin(params.theta[i])                # [Eqn 7-8]

        # [Eqn 7-9]
        if psi > 1.56:
            Hprime__km[i] = H__km[i]
        else:
            Hprime__km[i] = params.D__km[i] * math.tan(psi)

    delta_z = abs(params.z__km[0] - params.z__km[1])          # [Eqn 7-10]

    # [Eqn 7-11]
    params.d__km = max(params.a_a__km * (params.theta[0] + params.theta[1]), 0.0)

    # [Eqn 7-12]
    # При psi = pi/2 D__km[0] + D__km[1] может стать ровно 0.0
    # (из-за округления acos), и Python бросит ZeroDivisionError.
    # В C++ деление на 0.0 даёт ±inf, и atan(±inf) = ±pi/2.
    # Воспроизводим это поведение явной проверкой.
    _D_sum = params.D__km[0] + params.D__km[1]
    if _D_sum == 0.0:
        _num = Hprime__km[1] - Hprime__km[0]
        if _num > 0.0:
            alpha = math.pi / 2.0
        elif _num < 0.0:
            alpha = -math.pi / 2.0
        else:
            alpha = 0.0
    else:
        alpha = math.atan((Hprime__km[1] - Hprime__km[0]) / _D_sum)

    # [Eqn 7-13]
    params.r_0__km = max(delta_z,
                          (params.D__km[0] + params.D__km[1]) / math.cos(alpha))

    # [Eqn 7-14]
    # При psi = pi/2 cos(psi) = 6.1e-17 (не 0.0 в IEEE-754), и
    # D[0]+D[1] = 0.0, поэтому r_12 = 0.0. Это то же, что в C++.
    params.r_12__km = (params.D__km[0] + params.D__km[1]) / math.cos(psi)

    # [Eqn 7-15]
    # r_0 > 0, r_12 >= 0, поэтому знаменатель > 0.
    # Если в каких-то экзотических случаях r_0 + r_12 = 0.0 — тогда
    # тоже воспроизведём поведение C++: 4*Hp0*Hp1 / 0.
    _denom = params.r_0__km + params.r_12__km
    if _denom == 0.0:
        _num2 = 4.0 * Hprime__km[0] * Hprime__km[1]
        if _num2 > 0.0:
            params.delta_r__km = float('inf')
        elif _num2 < 0.0:
            params.delta_r__km = float('-inf')
        else:
            params.delta_r__km = 0.0
    else:
        params.delta_r__km = 4.0 * Hprime__km[0] * Hprime__km[1] / _denom

    # [Eqn 7-16, 7-17]
    params.theta_h1__rad = alpha - params.theta[0]
    params.theta_h2__rad = -(alpha + params.theta[1])


__all__ = ['ray_optics']

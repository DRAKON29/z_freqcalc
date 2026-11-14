# Copyright (c) 2026 Evgeny Gennadievich Prutkov <sviazist.pr@gmail.com>
# SPDX-License-Identifier: MIT
#
# Python implementation of ITU-R P.528-5.
# See README.md and NOTICE for attribution.

"""
core/itu/p528/troposcatter.py — Troposcatter (§11).
Порт C++ Troposcatter.cpp.
"""

import math

from .constants import a_0__km, a_e__km, N_s
from .types import Path, Terminal, TroposcatterParams


def troposcatter(
    path: Path,
    terminal_1: Terminal,
    terminal_2: Terminal,
    d__km: float,
    f__mhz: float,
    tropo: TroposcatterParams,
) -> None:
    """
    Troposcatter loss (§11, ур. 89).

    Args:
        path: Path (не используется напрямую, оставлено для совместимости).
        terminal_1, terminal_2: терминалы.
        d__km: расстояние, км.
        f__mhz: частота, МГц.
        tropo: TroposcatterParams (модифицируется in-place).
    """
    # [Eqn 11-2]
    tropo.d_s__km = d__km - terminal_1.d_r__km - terminal_2.d_r__km

    if tropo.d_s__km <= 0.0:
        tropo.d_z__km = 0.0
        tropo.A_s__db = 0.0
        tropo.d_s__km = 0.0
        tropo.h_v__km = 0.0
        tropo.theta_s = 0.0
        tropo.theta_A = 0.0
        return

    # [Eqn 11-6]
    tropo.d_z__km = 0.5 * tropo.d_s__km

    # [Eqn 11-7, 11-8, 11-9]
    A_m = 1.0 / a_0__km
    dN = A_m - (1.0 / a_e__km)
    gamma_e__km = (N_s * 1e-6) / dN

    # [Eqn 11-10, 11-11]
    z_a__km = 1.0 / (2.0 * a_e__km) * (tropo.d_z__km / 2.0) ** 2
    z_b__km = 1.0 / (2.0 * a_e__km) * tropo.d_z__km ** 2

    # [Eqn 11-12]
    Q_o = A_m - dN

    # [Eqn 11-13] — с clamp аргумента экспоненты 35
    Q_a = A_m - dN / math.exp(min(35.0, z_a__km / gamma_e__km))
    Q_b = A_m - dN / math.exp(min(35.0, z_b__km / gamma_e__km))

    # [Eqn 11-14, 11-15]
    Z_a__km = (7.0 * Q_o + 6.0 * Q_a - Q_b) * (tropo.d_z__km ** 2 / 96.0)
    Z_b__km = (Q_o + 2.0 * Q_a) * (tropo.d_z__km ** 2 / 6.0)

    # [Eqn 11-16]
    Q_A = A_m - dN / math.exp(min(35.0, Z_a__km / gamma_e__km))
    Q_B = A_m - dN / math.exp(min(35.0, Z_b__km / gamma_e__km))

    # [Eqn 11-17, 11-18, 11-19]
    tropo.h_v__km = (Q_o + 2.0 * Q_A) * (tropo.d_z__km ** 2 / 6.0)
    tropo.theta_A = (Q_o + 4.0 * Q_A + Q_B) * tropo.d_z__km / 6.0
    tropo.theta_s = 2.0 * tropo.theta_A

    # [Eqn 11-20, 11-21]
    epsilon_1 = 5.67e-6 * N_s ** 2 - 0.00232 * N_s + 0.031
    epsilon_2 = 0.0002 * N_s ** 2 - 0.06 * N_s + 6.6

    # [Eqn 11-22]
    gamma = 0.1424 * (1.0 + epsilon_1 / math.exp(
        min(35.0, (tropo.h_v__km / 4.0) ** 6)
    ))

    # [Eqn 11-23]
    S_e__db = (83.1
               - epsilon_2 / (1.0 + 0.07716 * tropo.h_v__km ** 2)
               + 20.0 * math.log10(
                   (0.1424 / gamma) ** 2 * math.exp(gamma * tropo.h_v__km)
               ))

    # [Eqn 11-24]
    X_A1__km2 = (terminal_1.h_e__km ** 2
                 + 4.0 * (a_e__km + terminal_1.h_e__km) * a_e__km
                 * math.sin(terminal_1.d_r__km / (a_e__km * 2.0)) ** 2)
    X_A2__km2 = (terminal_2.h_e__km ** 2
                 + 4.0 * (a_e__km + terminal_2.h_e__km) * a_e__km
                 * math.sin(terminal_2.d_r__km / (a_e__km * 2.0)) ** 2)

    # [Eqn 11-25, 11-26]
    ell_1__km = math.sqrt(X_A1__km2) + tropo.d_z__km
    ell_2__km = math.sqrt(X_A2__km2) + tropo.d_z__km
    ell__km = ell_1__km + ell_2__km

    # [Eqn 11-27, 11-28, 11-29]
    s = (ell_1__km - ell_2__km) / ell__km
    eta = gamma * tropo.theta_s * ell__km / 2.0
    kappa = f__mhz / 0.0477

    # [Eqn 11-30]
    rho_1__km = 2.0 * kappa * tropo.theta_s * terminal_1.h_e__km
    rho_2__km = 2.0 * kappa * tropo.theta_s * terminal_2.h_e__km

    SQRT2 = math.sqrt(2.0)

    A = (1.0 - s ** 2) ** 2                              # [Eqn 11-36]
    X_v1 = (1.0 + s) ** 2 * eta                          # [Eqn 11-32]
    X_v2 = (1.0 - s) ** 2 * eta                          # [Eqn 11-33]

    q_1 = X_v1 ** 2 + rho_1__km ** 2                     # [Eqn 11-34]
    q_2 = X_v2 ** 2 + rho_2__km ** 2                     # [Eqn 11-35]

    # [Eqn 11-37]
    B_s = (6.0 + 8.0 * s ** 2
           + 8.0 * (1.0 - s) * X_v1 ** 2 * rho_1__km ** 2 / q_1 ** 2
           + 8.0 * (1.0 + s) * X_v2 ** 2 * rho_2__km ** 2 / q_2 ** 2
           + 2.0 * (1.0 - s ** 2)
           * (1.0 + 2.0 * X_v1 ** 2 / q_1)
           * (1.0 + 2.0 * X_v2 ** 2 / q_2))

    # [Eqn 11-38]
    C_s = (12.0
           * ((rho_1__km + SQRT2) / rho_1__km) ** 2
           * ((rho_2__km + SQRT2) / rho_2__km) ** 2
           * (rho_1__km + rho_2__km)
           / (rho_1__km + rho_2__km + 2.0 * SQRT2))

    temp = ((A * eta ** 2 + B_s * eta) * q_1 * q_2
            / (rho_1__km ** 2 * rho_2__km ** 2))

    S_v__db = 10.0 * math.log10(temp + C_s)

    # [Eqn 11-31]
    tropo.A_s__db = (S_e__db + S_v__db
                     + 10.0 * math.log10(kappa * tropo.theta_s ** 3 / ell__km))


__all__ = ['troposcatter']

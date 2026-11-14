# Copyright (c) 2026 Evgeny Gennadievich Prutkov <sviazist.pr@gmail.com>
# SPDX-License-Identifier: MIT
#
# Python implementation of ITU-R P.528-5.
# See README.md and NOTICE for attribution.

"""
core/itu/p528/los.py — LineOfSight + GetPathLoss + FindPsiAt* (§6, §8).
Порт C++ LineOfSight.cpp + GetPathLoss.cpp + FindPsiAt*.
"""

import math
import cmath

from .constants import (
    PI, LOS_EPSILON, PROP_MODE__LOS,
    POLARIZATION__HORIZONTAL,
)
from .types import Path, Terminal, LineOfSightParams, Result
from .ray_optics import ray_optics
from .reflection import reflection_coefficients
from .long_term import long_term_variability
from .nakagami_rice import nakagami_rice, find_k_for_ypi_at_99
from .math_utils import combine_distributions
from .p676.ray_trace import ray_trace  # VENDORED CHANGE (2026-11-14): p676 вендорится субпакетом
from .terminal import _build_p528_atmosphere_config


# =====================================================================
# FindPsiAtDistance / FindPsiAtDeltaR / FindDistanceAtDeltaR
# =====================================================================

def find_psi_at_distance(d__km, path, terminal_1, terminal_2):
    """Binary search для psi по заданному d."""
    if d__km == 0:
        return PI / 2

    psi = PI / 2
    delta_psi = -PI / 4

    params_temp = LineOfSightParams()
    while True:
        psi += delta_psi
        ray_optics(terminal_1, terminal_2, psi, params_temp)
        d_psi__km = params_temp.d__km

        if d_psi__km > d__km:
            delta_psi = abs(delta_psi) / 2.0
        else:
            delta_psi = -abs(delta_psi) / 2.0

        if abs(d__km - d_psi__km) <= 1e-3 or abs(delta_psi) <= 1e-12:
            break

    return psi


def find_psi_at_delta_r(delta_r__km, path, terminal_1, terminal_2, terminate):
    """Binary search для psi по заданному delta_r."""
    psi = PI / 2
    delta_psi = -PI / 4
    params_temp = LineOfSightParams()

    while True:
        psi += delta_psi
        ray_optics(terminal_1, terminal_2, psi, params_temp)

        if params_temp.delta_r__km > delta_r__km:
            delta_psi = -abs(delta_psi) / 2.0
        else:
            delta_psi = abs(delta_psi) / 2.0

        if abs(params_temp.delta_r__km - delta_r__km) <= terminate:
            break

    return psi


def find_distance_at_delta_r(delta_r__km, path, terminal_1, terminal_2, terminate):
    """Binary search для d по заданному delta_r."""
    psi = PI / 2
    delta_psi = -PI / 4
    params_temp = LineOfSightParams()

    while True:
        psi += delta_psi
        ray_optics(terminal_1, terminal_2, psi, params_temp)

        if params_temp.delta_r__km > delta_r__km:
            delta_psi = -abs(delta_psi) / 2.0
        else:
            delta_psi = abs(delta_psi) / 2.0

        if abs(params_temp.delta_r__km - delta_r__km) <= terminate:
            break

    return params_temp.d__km


# =====================================================================
# GetPathLoss (§8)
# =====================================================================

def get_path_loss(psi__rad, path, f__mhz, psi_limit,
                   A_dML__db, A_d_0__db, T_pol, params):
    """
    LOS loss (§8). Порт C++ GetPathLoss.

    Args:
        psi__rad: угол отражения, рад.
        path: Path.
        f__mhz: частота, МГц.
        psi_limit: граница FS / 2-ray, рад.
        A_dML__db: дифракционные потери на d_ML.
        A_d_0__db: потери на d_0.
        T_pol: поляризация.
        params: LineOfSightParams (модифицируется).

    Returns:
        R_Tg — коэффициент отражения.
    """
    R_g, phi_g = reflection_coefficients(psi__rad, f__mhz, T_pol)

    # Divergence factor
    if math.tan(psi__rad) >= 0.1:
        D_v = 1.0
    else:
        r_1 = params.D__km[0] / math.cos(psi__rad)
        r_2 = params.D__km[1] / math.cos(psi__rad)
        R_r = (r_1 * r_2) / params.r_12__km

        term_1 = (2.0 * R_r * (1.0 + math.sin(psi__rad) ** 2)) / (params.a_a__km * math.sin(psi__rad))
        term_2 = (2.0 * R_r / params.a_a__km) ** 2
        D_v = (1.0 + term_1 + term_2) ** (-0.5)

    # Ray-length factor, [Eqn 8-6].
    # В C++ r_0 / 0.0 = +inf (IEEE-754), min(+inf, 1.0) = 1.0.
    # Python бросает ZeroDivisionError, поэтому воспроизводим
    # поведение C++ явной проверкой.
    if params.r_12__km == 0.0:
        F_r = 1.0
    else:
        F_r = min(params.r_0__km / params.r_12__km, 1.0)

    R_Tg = R_g * D_v * F_r

    if params.d__km > path.d_0__km:
        # [Eqn 8-1]
        params.A_LOS__db = (
            (params.d__km - path.d_0__km)
            * (A_dML__db - A_d_0__db)
            / (path.d_ML__km - path.d_0__km)
            + A_d_0__db
        )
    else:
        lambda__km = 0.2997925 / f__mhz
        if psi__rad > psi_limit:
            params.A_LOS__db = 0.0
        else:
            phi_Tg = (2.0 * PI * params.delta_r__km / lambda__km) + phi_g
            cplx = complex(R_Tg * math.cos(phi_Tg), -R_Tg * math.sin(phi_Tg))
            W_RL = min(abs(1.0 + cplx), 1.0)
            W_R0 = W_RL ** 2
            params.A_LOS__db = 10.0 * math.log10(W_R0) if W_R0 > 0 else -200.0

    return R_Tg


# =====================================================================
# LineOfSight (§6) — главная
# =====================================================================

def line_of_sight(
    path: Path,
    terminal_1: Terminal,
    terminal_2: Terminal,
    los_params: LineOfSightParams,
    f__mhz: float,
    A_dML__db: float,
    p: float,
    d__km: float,
    T_pol: int,
    result: Result,
):
    """
    Расчёт LOS (§6).

    Args:
        path, terminal_1, terminal_2, los_params, f__mhz, A_dML__db, p, d__km, T_pol.
        result: Result (модифицируется).

    Returns:
        K_LOS — K-фактор для последующих расчётов.
    """
    lambda__km = 0.2997925 / f__mhz
    terminate = lambda__km / 1e6

    # psi_limit — граница FS / 2-ray
    psi_limit = find_psi_at_delta_r(lambda__km / 2.0, path, terminal_1, terminal_2, terminate)

    # d_y6
    d_y6__km = find_distance_at_delta_r(lambda__km / 6.0, path, terminal_1, terminal_2, terminate)

    # Step 6-4: Determine d_0
    if terminal_1.d_r__km >= path.d_d__km or path.d_d__km >= path.d_ML__km:
        if terminal_1.d_r__km > d_y6__km or d_y6__km > path.d_ML__km:
            path.d_0__km = terminal_1.d_r__km
        else:
            path.d_0__km = d_y6__km
    elif path.d_d__km < d_y6__km < path.d_ML__km:
        path.d_0__km = d_y6__km
    else:
        path.d_0__km = path.d_d__km

    # Step 6-5: Tune d_0
    d_temp__km = path.d_0__km
    while True:
        psi_tmp = find_psi_at_distance(d_temp__km, path, terminal_1, terminal_2)
        los_result_tmp = LineOfSightParams()
        ray_optics(terminal_1, terminal_2, psi_tmp, los_result_tmp)

        if (los_result_tmp.d__km >= path.d_0__km
                or (d_temp__km + 0.001) >= path.d_ML__km):
            path.d_0__km = los_result_tmp.d__km
            break
        d_temp__km += 0.001

    # Step 6-6: Loss at d_0
    psi_d0 = find_psi_at_distance(path.d_0__km, path, terminal_1, terminal_2)
    ray_optics(terminal_1, terminal_2, psi_d0, los_params)
    R_Tg = get_path_loss(psi_d0, path, f__mhz, psi_limit, A_dML__db, 0.0, T_pol, los_params)

    # Step 6-7: desired distance
    psi = find_psi_at_distance(d__km, path, terminal_1, terminal_2)
    ray_optics(terminal_1, terminal_2, psi, los_params)
    R_Tg = get_path_loss(psi, path, f__mhz, psi_limit, A_dML__db,
                          los_params.A_LOS__db, T_pol, los_params)

    # Step 6-9: atmospheric absorption
    config = _build_p528_atmosphere_config()
    slant = ray_trace(
        f__ghz=f__mhz / 1000.0,
        h_1__km=terminal_1.h_r__km,
        h_2__km=terminal_2.h_r__km,
        beta_1__rad=PI / 2 - los_params.theta_h1__rad,
        config=config,
    )
    result.A_a__db = slant.A_gas__db

    # Step 6-10: free space loss
    result.A_fs__db = (20.0 * math.log10(los_params.r_0__km)
                        + 20.0 * math.log10(f__mhz) + 32.45)

    # Step 6-11: variability
    # f_theta_h (§13-1)
    if los_params.theta_h1__rad <= 0.0:
        f_theta_h = 1.0
    elif los_params.theta_h1__rad >= 1.0:
        f_theta_h = 0.0
    else:
        f_theta_h = max(
            0.5 - (1.0 / PI) * math.atan(20.0 * math.log10(32.0 * los_params.theta_h1__rad)),
            0.0
        )

    Y_e__db, A_Y = long_term_variability(
        terminal_1.d_r__km, terminal_2.d_r__km, d__km,
        f__mhz, p, f_theta_h, los_params.A_LOS__db
    )
    Y_e_50__db, _ = long_term_variability(
        terminal_1.d_r__km, terminal_2.d_r__km, d__km,
        f__mhz, 50, f_theta_h, los_params.A_LOS__db
    )

    # [Eqn 13-2]
    if A_Y <= 0.0:
        F_AY = 1.0
    elif A_Y >= 9.0:
        F_AY = 0.1
    else:
        F_AY = (1.1 + 0.9 * math.cos((A_Y / 9.0) * PI)) / 2.0

    # [Eqn 13-3] F_delta_r
    if los_params.delta_r__km >= (lambda__km / 2.0):
        F_delta_r = 1.0
    elif los_params.delta_r__km <= lambda__km / 6.0:
        F_delta_r = 0.1
    else:
        F_delta_r = 0.5 * (1.1 - 0.9 * math.cos(
            ((3.0 * PI) / lambda__km) * (los_params.delta_r__km - lambda__km / 6.0)
        ))

    R_s = R_Tg * F_delta_r * F_AY

    # [Eqn 13-5]
    Y_pi_99__db = 10.0 * math.log10(f__mhz * slant.a__km ** 3) - 84.26
    K_t = find_k_for_ypi_at_99(Y_pi_99__db)

    # [Eqn 13-6, 13-7, 13-8]
    W_a = 10.0 ** (K_t / 10.0)
    W_R = R_s ** 2 + 0.01 ** 2
    W = W_R + W_a

    # [Eqn 13-9]
    if W <= 0.0:
        K_LOS = -40.0
    else:
        K_LOS = 10.0 * math.log10(W)
        if K_LOS < -40.0:
            K_LOS = -40.0

    Y_pi_50__db = 0.0
    Y_pi__db = nakagami_rice(K_LOS, p)

    Y_total__db = -combine_distributions(Y_e_50__db, Y_e__db, Y_pi_50__db, Y_pi__db, p)

    result.d__km = los_params.d__km
    result.A__db = (result.A_fs__db + result.A_a__db
                     - los_params.A_LOS__db + Y_total__db)
    result.theta_h1__rad = los_params.theta_h1__rad

    return K_LOS


__all__ = [
    'find_psi_at_distance', 'find_psi_at_delta_r',
    'find_distance_at_delta_r', 'get_path_loss', 'line_of_sight',
]

# Copyright (c) 2026 Evgeny Gennadievich Prutkov <sviazist.pr@gmail.com>
# SPDX-License-Identifier: MIT
#
# Python implementation of ITU-R P.528-5.
# See README.md and NOTICE for attribution.

"""
core/itu/p528/p528.py — Главная функция P528 (порт P528.cpp).
"""

import math

from .constants import (
    a_e__km, THIRD,
    PROP_MODE__LOS, PROP_MODE__DIFFRACTION, PROP_MODE__SCATTERING,
    PROP_MODE__NOT_SET,
    SUCCESS, ERROR_HEIGHT_AND_DISTANCE,
    CASE_1, CASE_2, CONST_MODE__DIFFRACTION,
    PI,
)
from .types import Path, Terminal, TroposcatterParams, LineOfSightParams, Result
from .validation import validate_inputs
from .terminal import terminal_geometry, _build_p528_atmosphere_config
from .smooth_earth import smooth_earth_diffraction
from .los import line_of_sight
from .transhorizon import transhorizon_search
from .troposcatter import troposcatter
from .long_term import long_term_variability
from .nakagami_rice import nakagami_rice
from .math_utils import combine_distributions
from .p676.ray_trace import ray_trace  # VENDORED CHANGE (2026-11-14): p676 вендорится субпакетом


def p528_ex(
    d__km: float,
    h_1__meter: float,
    h_2__meter: float,
    f__mhz: float,
    T_pol: int,
    p: float,
    result: Result,
    terminal_1: Terminal,
    terminal_2: Terminal,
    tropo: TroposcatterParams,
    path: Path,
    los_params: LineOfSightParams,
) -> int:
    """
    Главный расчёт P.528-5 (порт P528_Ex).
    """
    # Reset
    result.A_fs__db = 0.0
    result.A_a__db = 0.0
    result.A__db = 0.0
    result.d__km = 0.0
    result.theta_h1__rad = 0.0
    result.propagation_mode = PROP_MODE__NOT_SET

    err = validate_inputs(d__km, h_1__meter, h_2__meter, f__mhz, T_pol, p)
    if err != SUCCESS:
        if err == ERROR_HEIGHT_AND_DISTANCE:
            return SUCCESS
        return err

    # Step 1: Terminal geometry
    terminal_1.h_r__km = h_1__meter / 1000.0
    terminal_geometry(f__mhz, terminal_1)

    terminal_2.h_r__km = h_2__meter / 1000.0
    terminal_geometry(f__mhz, terminal_2)

    # Step 2
    path.d_ML__km = terminal_1.d_r__km + terminal_2.d_r__km

    # Step 3.1
    d_3__km = path.d_ML__km + 0.5 * (a_e__km ** 2 / f__mhz) ** THIRD
    d_4__km = path.d_ML__km + 1.5 * (a_e__km ** 2 / f__mhz) ** THIRD

    # Step 3.2
    A_3__db = smooth_earth_diffraction(terminal_1.d_r__km, terminal_2.d_r__km,
                                        f__mhz, d_3__km, T_pol)
    A_4__db = smooth_earth_diffraction(terminal_1.d_r__km, terminal_2.d_r__km,
                                        f__mhz, d_4__km, T_pol)

    # Step 3.3
    M_d = (A_4__db - A_3__db) / (d_4__km - d_3__km)
    A_d0 = A_4__db - M_d * d_4__km

    # Step 3.4
    A_dML__db = (M_d * path.d_ML__km) + A_d0


    path.d_d__km = -(A_d0 / M_d) if M_d != 0 else 0.0

    K_LOS = 0.0

    # Step 4: LOS?
    if path.d_ML__km - d__km > 0.001:
        result.propagation_mode = PROP_MODE__LOS
        line_of_sight(path, terminal_1, terminal_2, los_params,
                       f__mhz, -A_dML__db, p, d__km, T_pol, result)
        return SUCCESS

    # Transhorizon
    K_LOS = line_of_sight(path, terminal_1, terminal_2, los_params,
                           f__mhz, -A_dML__db, p, path.d_ML__km - 1.0, T_pol, result)

    # Step 6: Search crossover
    M_d, A_d0, d_crx__km, CASE, rtn = transhorizon_search(
        path, terminal_1, terminal_2, f__mhz, A_dML__db, M_d, A_d0
    )

    # Step 7.1
    A_d__db = M_d * d__km + A_d0

    # Step 7.2
    troposcatter(path, terminal_1, terminal_2, d__km, f__mhz, tropo)

    # Step 7.3
    if d__km < d_crx__km:
        A_T__db = A_d__db
        result.propagation_mode = PROP_MODE__DIFFRACTION
    else:
        if CASE == CASE_1:
            if tropo.A_s__db <= A_d__db:
                A_T__db = tropo.A_s__db
                result.propagation_mode = PROP_MODE__SCATTERING
            else:
                A_T__db = A_d__db
                result.propagation_mode = PROP_MODE__DIFFRACTION
        else:  # CASE_2
            A_T__db = tropo.A_s__db
            result.propagation_mode = PROP_MODE__SCATTERING

    # Step 11-12: Variability
    f_theta_h = 1.0


    Y_e__db, _ = long_term_variability(
        terminal_1.d_r__km, terminal_2.d_r__km, d__km,
        f__mhz, p, f_theta_h, -A_T__db
    )
    Y_e_50__db, _ = long_term_variability(
        terminal_1.d_r__km, terminal_2.d_r__km, d__km,
        f__mhz, 50, f_theta_h, -A_T__db
    )

    ANGLE = 0.02617993878  # 1.5 deg
    if tropo.theta_s >= ANGLE:
        K_t__db = 20.0
    elif tropo.theta_s <= 0.0:
        K_t__db = K_LOS
    else:
        K_t__db = (tropo.theta_s * (20.0 - K_LOS) / ANGLE) + K_LOS

    Y_pi_50__db = 0.0
    Y_pi__db = nakagami_rice(K_t__db, p)
    Y_total__db = combine_distributions(Y_e_50__db, Y_e__db,
                                          Y_pi_50__db, Y_pi__db, p)

    Y_pi_50__db = 0.0
    Y_pi__db = nakagami_rice(K_t__db, p)
    Y_total__db = combine_distributions(Y_e_50__db, Y_e__db,
                                          Y_pi_50__db, Y_pi__db, p)



    # Atmospheric absorption for transhorizon
    config = _build_p528_atmosphere_config()
    result_v = ray_trace(
        f__ghz=f__mhz / 1000.0, h_1__km=0.0, h_2__km=tropo.h_v__km,
        beta_1__rad=PI / 2, config=config
    )


    result.A_a__db = (terminal_1.A_a__db + terminal_2.A_a__db
                       + 2.0 * result_v.A_gas__db)

    # Free space loss
    r_fs__km = terminal_1.a__km + terminal_2.a__km + 2.0 * result_v.a__km
    result.A_fs__db = (20.0 * math.log10(f__mhz)
                        + 20.0 * math.log10(r_fs__km) + 32.45)

    result.d__km = d__km


    result.A__db = (result.A_fs__db + result.A_a__db
                     + A_T__db - Y_total__db)


    result.theta_h1__rad = -terminal_1.theta__rad

    return rtn


def p528(
    d__km: float,
    h_1__meter: float,
    h_2__meter: float,
    f__mhz: float,
    T_pol: int,
    p: float,
) -> Result:
    """
    Публичная функция P.528-5.

    Args:
        d__km: расстояние, км.
        h_1__meter: высота нижнего терминала, м.
        h_2__meter: высота верхнего терминала, м.
        f__mhz: частота, МГц.
        T_pol: 0 = HORIZONTAL, 1 = VERTICAL.
        p: процент времени.

    Returns:
        Result.
    """
    result = Result()
    terminal_1 = Terminal()
    terminal_2 = Terminal()
    tropo = TroposcatterParams()
    path = Path()
    los_params = LineOfSightParams()

    p528_ex(d__km, h_1__meter, h_2__meter, f__mhz, T_pol, p, result,
             terminal_1, terminal_2, tropo, path, los_params)

    return result


__all__ = ['p528', 'p528_ex']

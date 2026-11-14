# Copyright (c) 2026 Evgeny Gennadievich Prutkov <sviazist.pr@gmail.com>
# SPDX-License-Identifier: MIT
#
# Python implementation of ITU-R P.528-5.
# See README.md and NOTICE for attribution.

"""
core/itu/p528/transhorizon.py — TranshorizonSearch (§3, Step 6).
Порт C++ TranshorizonSearch.cpp.
"""

from .constants import (
    CONST_MODE__SEARCH, CONST_MODE__DIFFRACTION,
    CASE_1, CASE_2, SUCCESS,
    WARNING__DFRAC_TROPO_REGION,
)
from .types import Path, Terminal, TroposcatterParams
from .troposcatter import troposcatter


def transhorizon_search(
    path: Path,
    terminal_1: Terminal,
    terminal_2: Terminal,
    f__mhz: float,
    A_dML__db: float,
    M_d: float,
    A_d0: float,
):
    """
    Поиск точки перехода между дифракцией и тропосферой (Step 6).

    Возвращает:
        (M_d_new, A_d0_new, d_crx__km, CASE, rtn)
    """
    CASE = CONST_MODE__SEARCH
    k = 0

    tropo = TroposcatterParams()
    tropo.A_s__db = 0.0

    # Step 6.1
    d_search__km = [path.d_ML__km + 3.0, path.d_ML__km + 2.0]
    A_s__db = [0.0, 0.0]
    M_s = 0.0

    SEARCH_LIMIT = 100

    for _ in range(SEARCH_LIMIT):
        A_s__db[1] = A_s__db[0]

        # Step 6.2
        troposcatter(path, terminal_1, terminal_2, d_search__km[0], f__mhz, tropo)
        A_s__db[0] = tropo.A_s__db

        # Step 6.5: результаты < 20 дБ невалидны
        if tropo.A_s__db < 20.0:
            d_search__km[1] = d_search__km[0]
            d_search__km[0] += 1.0
            continue

        k += 1
        if k <= 1:
            d_search__km[1] = d_search__km[0]
            d_search__km[0] += 1.0
            continue

        # Step 6.3
        M_s = ((A_s__db[0] - A_s__db[1])
               / (d_search__km[0] - d_search__km[1]))

        # Step 6.4
        if M_s <= M_d:
            d_crx__km = d_search__km[0]

            # Step 6.6
            A_d__db = M_d * d_search__km[1] + A_d0

            if A_s__db[1] >= A_d__db:
                CASE = CASE_1
            else:
                # Step 6.6 (Case 2): пересчёт M_d, A_d0
                M_d = ((A_s__db[1] - A_dML__db)
                       / (d_search__km[1] - path.d_ML__km))
                A_d0 = A_s__db[1] - (M_d * d_search__km[1])
                CASE = CASE_2

            return M_d, A_d0, d_crx__km, CASE, SUCCESS

        d_search__km[1] = d_search__km[0]
        d_search__km[0] += 1.0

    # M_s всегда больше M_d
    CASE = CONST_MODE__DIFFRACTION
    d_crx__km = d_search__km[1]
    return M_d, A_d0, d_crx__km, CASE, WARNING__DFRAC_TROPO_REGION


__all__ = ['transhorizon_search']

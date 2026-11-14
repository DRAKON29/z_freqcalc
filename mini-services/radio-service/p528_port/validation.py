# Copyright (c) 2026 Evgeny Gennadievich Prutkov <sviazist.pr@gmail.com>
# SPDX-License-Identifier: MIT
#
# Python implementation of ITU-R P.528-5.
# See README.md and NOTICE for attribution.

"""
core/itu/p528/validation.py — Валидация входных данных ITU-R P.528-5.
Порт C++ ValidateInputs.cpp.
"""

from .constants import (
    POLARIZATION__HORIZONTAL, POLARIZATION__VERTICAL,
    ERROR_VALIDATION__D_KM, ERROR_VALIDATION__H_1,
    ERROR_VALIDATION__H_2, ERROR_VALIDATION__TERM_GEO,
    ERROR_VALIDATION__F_MHZ_LOW, ERROR_VALIDATION__F_MHZ_HIGH,
    ERROR_VALIDATION__POLARIZATION, ERROR_VALIDATION__PERCENT_LOW,
    ERROR_VALIDATION__PERCENT_HIGH, ERROR_HEIGHT_AND_DISTANCE,
    SUCCESS,
)


def validate_inputs(
    d__km: float,
    h_1__meter: float,
    h_2__meter: float,
    f__mhz: float,
    T_pol: int,
    p: float,
) -> int:
    """
    Проверяет входные параметры P.528-5.

    Returns:
        SUCCESS (0) или код ошибки.
    """
    if d__km < 0:
        return ERROR_VALIDATION__D_KM

    if h_1__meter < 1.5 or h_1__meter > 20000:
        return ERROR_VALIDATION__H_1

    if h_2__meter < 1.5 or h_2__meter > 20000:
        return ERROR_VALIDATION__H_2

    if h_1__meter > h_2__meter:
        return ERROR_VALIDATION__TERM_GEO

    if f__mhz < 100:
        return ERROR_VALIDATION__F_MHZ_LOW

    if f__mhz > 30000:
        return ERROR_VALIDATION__F_MHZ_HIGH

    if T_pol != POLARIZATION__HORIZONTAL and T_pol != POLARIZATION__VERTICAL:
        return ERROR_VALIDATION__POLARIZATION

    if p < 1:
        return ERROR_VALIDATION__PERCENT_LOW

    if p > 99:
        return ERROR_VALIDATION__PERCENT_HIGH

    if h_1__meter == h_2__meter and d__km == 0:
        return ERROR_HEIGHT_AND_DISTANCE

    return SUCCESS


__all__ = ['validate_inputs']

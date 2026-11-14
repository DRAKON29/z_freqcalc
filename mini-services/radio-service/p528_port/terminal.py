# Copyright (c) 2026 Evgeny Gennadievich Prutkov <sviazist.pr@gmail.com>
# SPDX-License-Identifier: MIT
#
# Python implementation of ITU-R P.528-5.
# See README.md and NOTICE for attribution.

"""
core/itu/p528/terminal.py — TerminalGeometry (P.528-5 §4).
Порт C++ TerminalGeometry.cpp с кэшированием конфига атмосферы.
"""

import math

from .constants import a_0__km, a_e__km, PI
from .types import Terminal


# =====================================================================
# КЭШ КОНФИГУРАЦИИ АТМОСФЕРЫ
# =====================================================================
# _build_p528_atmosphere_config() вызывается для каждого терминала
# в terminal_geometry(). Внутри создаётся RayTraceConfig с замыканиями,
# которые дёргают P.835. Это дорого и не меняется от вызова к вызову,
# поэтому создаём конфиг один раз и кэшируем.
_P528_ATMOSPHERE_CONFIG = None


def _build_p528_atmosphere_config():
    """
    Собирает RayTraceConfig из P.835 (mean annual global reference).
    Результат кэшируется — конфиг один на всё время работы программы.
    """
    global _P528_ATMOSPHERE_CONFIG
    if _P528_ATMOSPHERE_CONFIG is not None:
        return _P528_ATMOSPHERE_CONFIG

    from .p835 import (
        global_temperature,
        global_pressure,
        global_water_vapour_density,
    )
    from .p835.conversions import water_vapour_density_to_pressure
    from .p676.ray_trace import RayTraceConfig

    Z_MIN_KM = 0.0
    Z_MAX_KM = 100.0

    def _clamp_z(z__km: float) -> float:
        if z__km < Z_MIN_KM:
            return Z_MIN_KM
        if z__km > Z_MAX_KM:
            return Z_MAX_KM
        return z__km

    def _temperature(h__km: float) -> float:
        return global_temperature(_clamp_z(h__km))

    def _pressure(h__km: float) -> float:
        return global_pressure(_clamp_z(h__km))

    def _wet_pressure(h__km: float) -> float:
        """GlobalWetPressure из C++ (P.676 GlobalWetPressure.cpp)."""
        z = _clamp_z(h__km)
        T__k = global_temperature(z)
        P__hpa = global_pressure(z)
        rho = max(
            global_water_vapour_density(z, 7.5),
            2.0e-6 * 216.7 * P__hpa / T__k
        )
        return water_vapour_density_to_pressure(rho, T__k)

    _P528_ATMOSPHERE_CONFIG = RayTraceConfig(
        temperature=_temperature,
        dry_pressure=_pressure,
        wet_pressure=_wet_pressure,
    )
    return _P528_ATMOSPHERE_CONFIG


def terminal_geometry(f__mhz: float, terminal: Terminal) -> None:
    """
    Вычисляет геометрию терминала (§4).

    Args:
        f__mhz: частота, МГц.
        terminal: структура Terminal (модифицируется in-place).
    """
    from .p676.ray_trace import ray_trace

    config = _build_p528_atmosphere_config()

    theta_tx__rad = 0.0
    result = ray_trace(
        f__ghz=f__mhz / 1000.0,
        h_1__km=0.0,
        h_2__km=terminal.h_r__km,
        beta_1__rad=PI / 2 - theta_tx__rad,
        config=config,
    )

    terminal.theta__rad = PI / 2 - result.angle__rad
    terminal.A_a__db = result.A_gas__db
    terminal.a__km = result.a__km

    # Central angle: (Thayer Eq 2), rearranged
    central_angle = ((PI / 2 - result.angle__rad)
                     - theta_tx__rad + result.bending__rad)
    terminal.d_r__km = a_0__km * central_angle

    # [Eqn 4-1]
    terminal.phi__rad = terminal.d_r__km / a_e__km

    # [Eqn 4-2]
    terminal.h_e__km = (a_e__km / math.cos(terminal.phi__rad)) - a_e__km

    # [Eqn 4-3]
    terminal.delta_h__km = terminal.h_r__km - terminal.h_e__km


__all__ = ['terminal_geometry', '_build_p528_atmosphere_config']

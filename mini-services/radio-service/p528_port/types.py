# Copyright (c) 2026 Evgeny Gennadievich Prutkov <sviazist.pr@gmail.com>
# SPDX-License-Identifier: MIT
#
# Python implementation of ITU-R P.528-5.
# See README.md and NOTICE for attribution.

"""
core/itu/p528/types.py — Структуры данных ITU-R P.528-5.
Порт C++ структур: Path, Terminal, LineOfSightParams, TroposcatterParams, Result.
"""

from dataclasses import dataclass, field


@dataclass
class Path:
    """Путь распространения (C++ struct Path)."""
    d_ML__km: float = 0.0     # Maximum line-of-sight distance
    d_0__km: float = 0.0      # Internal param (see text)
    d_d__km: float = 0.0      # Distance where smooth earth diffraction is 0 dB


@dataclass
class Terminal:
    """Терминал (C++ struct Terminal)."""
    h_r__km: float = 0.0         # Real terminal height
    h_e__km: float = 0.0         # Effective terminal height
    delta_h__km: float = 0.0     # Internal terminal param

    d_r__km: float = 0.0         # Ray traced horizon distance
    a__km: float = 0.0           # Total ray path length to horizon

    phi__rad: float = 0.0        # Central angle between terminal and smooth earth horizon
    theta__rad: float = 0.0      # Incident angle of the grazing ray at the terminal

    A_a__db: float = 0.0         # Median atmospheric absorption loss


@dataclass
class LineOfSightParams:
    """Параметры LOS (C++ struct LineOfSightParams)."""
    z__km: list = field(default_factory=lambda: [0.0, 0.0])
    d__km: float = 0.0
    r_0__km: float = 0.0
    r_12__km: float = 0.0
    D__km: list = field(default_factory=lambda: [0.0, 0.0])

    theta_h1__rad: float = 0.0
    theta_h2__rad: float = 0.0
    theta: list = field(default_factory=lambda: [0.0, 0.0])

    a_a__km: float = 0.0
    delta_r__km: float = 0.0
    A_LOS__db: float = 0.0


@dataclass
class TroposcatterParams:
    """Параметры тропосферного рассеяния (C++ struct TroposcatterParams)."""
    d_s__km: float = 0.0
    d_z__km: float = 0.0
    h_v__km: float = 0.0
    theta_s: float = 0.0
    theta_A: float = 0.0
    A_s__db: float = 0.0
    A_s_prev__db: float = 0.0
    M_s: float = 0.0


@dataclass
class Result:
    """Результат P.528 (C++ struct Result)."""
    propagation_mode: int = 0     # 0=NOT_SET, 1=LOS, 2=DIFFRACTION, 3=SCATTERING
    d__km: float = 0.0
    A__db: float = 0.0            # Total loss
    A_fs__db: float = 0.0         # Free space path loss
    A_a__db: float = 0.0          # Atmospheric absorption loss
    theta_h1__rad: float = 0.0    # Elevation angle of the ray at low terminal


__all__ = [
    'Path', 'Terminal', 'LineOfSightParams',
    'TroposcatterParams', 'Result',
]

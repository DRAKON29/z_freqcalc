# Copyright (c) 2026 Evgeny Gennadievich Prutkov <sviazist.pr@gmail.com>
# SPDX-License-Identifier: MIT
#
# Python implementation of ITU-R P.676-13.
# See README.md and NOTICE for attribution.

"""
itu/p676/refractivity.py — Комплексная рефрактивность N = N' + i*N''.
Без numpy.
"""

import math

from . import oxygen_data as O2
from . import water_vapour_data as H2O
from .specific_attenuation import (
    _theta,
    _oxygen_line_strength,
    _oxygen_line_width,
    _oxygen_delta,
    _apply_zeeman_broadening,
    _water_vapour_line_strength,
    _water_vapour_line_width,
    _apply_doppler_broadening,
    oxygen_imaginary_refractivity,
    water_vapour_imaginary_refractivity,
)


def _line_shape_factor_real(f_ghz: float, f0, df, delta):
    out = []
    for i in range(len(f0)):
        fi = f0[i]
        dfi = df[i]
        di = delta[i]
        tm = ((fi - f_ghz) + di * f_ghz) / ((fi - f_ghz) ** 2 + dfi ** 2)
        tp = ((fi + f_ghz) + di * f_ghz) / ((fi + f_ghz) ** 2 + dfi ** 2)
        out.append((f_ghz / fi) * (tm - tp))
    return out


def _dry_continuum_real(f_ghz: float, p_hpa: float, theta: float) -> float:
    d = 5.6e-4 * p_hpa * theta ** 0.8
    return -6.14e-5 * p_hpa * theta ** 2 * f_ghz ** 2 / (f_ghz ** 2 + d ** 2)


def oxygen_real_refractivity(
    f_ghz: float, p_hpa: float, e_hpa: float, temperature_k: float
) -> float:
    theta = _theta(temperature_k)
    S = _oxygen_line_strength(p_hpa, theta)
    df = _apply_zeeman_broadening(_oxygen_line_width(p_hpa, e_hpa, theta))
    delta = _oxygen_delta(p_hpa, e_hpa, theta)
    F = _line_shape_factor_real(f_ghz, O2.F0, df, delta)
    N_lines = sum(S[i] * F[i] for i in range(len(S)))
    return N_lines + _dry_continuum_real(f_ghz, p_hpa, theta)


def water_vapour_real_refractivity(
    f_ghz: float, p_hpa: float, e_hpa: float, temperature_k: float
) -> float:
    theta = _theta(temperature_k)
    S = _water_vapour_line_strength(e_hpa, theta)
    df = _apply_doppler_broadening(
        _water_vapour_line_width(p_hpa, e_hpa, theta), H2O.F0, theta)
    delta = [0.0] * len(H2O.F0)
    F = _line_shape_factor_real(f_ghz, H2O.F0, df, delta)
    return sum(S[i] * F[i] for i in range(len(S)))


def complex_refractivity(
    f_ghz: float, p_hpa: float, e_hpa: float, temperature_k: float
) -> complex:
    N_real = (oxygen_real_refractivity(f_ghz, p_hpa, e_hpa, temperature_k)
              + water_vapour_real_refractivity(f_ghz, p_hpa, e_hpa, temperature_k))
    N_imag = (oxygen_imaginary_refractivity(f_ghz, p_hpa, e_hpa, temperature_k)
              + water_vapour_imaginary_refractivity(f_ghz, p_hpa, e_hpa, temperature_k))
    return complex(N_real, N_imag)


def phase_dispersion_deg_per_km(
    f_ghz: float, p_hpa: float, e_hpa: float, temperature_k: float
) -> float:
    N_real_total = (
        oxygen_real_refractivity(f_ghz, p_hpa, e_hpa, temperature_k)
        + water_vapour_real_refractivity(f_ghz, p_hpa, e_hpa, temperature_k))
    return -1.2008 * f_ghz * N_real_total


__all__ = [
    'complex_refractivity',
    'oxygen_real_refractivity',
    'water_vapour_real_refractivity',
    'phase_dispersion_deg_per_km',
]

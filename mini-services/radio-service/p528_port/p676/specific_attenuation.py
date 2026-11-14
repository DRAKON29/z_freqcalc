# Copyright (c) 2026 Evgeny Gennadievich Prutkov <sviazist.pr@gmail.com>
# SPDX-License-Identifier: MIT
#
# Python implementation of ITU-R P.676-13.
# See README.md and NOTICE for attribution.

"""
itu/p676/specific_attenuation.py — Удельное затухание в газах,
ITU-R P.676-13, Annex 1 §1. Без numpy.
"""

import math

from . import oxygen_data as O2
from . import water_vapour_data as H2O
from .common.result import ITUResult


MODEL_NAME = "ITU-R P.676-13"
FREQ_MIN_GHZ = 1.0
FREQ_MAX_GHZ = 1000.0


def _theta(temperature_k: float) -> float:
    return 300.0 / temperature_k


def _oxygen_line_strength(p_hpa: float, theta: float):
    t3 = theta ** 3
    e_base = 1.0 - theta
    return [
        O2.A1[i] * 1e-7 * p_hpa * t3 * math.exp(O2.A2[i] * e_base)
        for i in range(len(O2.F0))
    ]


def _oxygen_line_width(p_hpa: float, e_hpa: float, theta: float):
    return [
        O2.A3[i] * 1e-4 * (
            p_hpa * theta ** (0.8 - O2.A4[i]) + 1.1 * e_hpa * theta)
        for i in range(len(O2.F0))
    ]


def _oxygen_delta(p_hpa: float, e_hpa: float, theta: float):
    t08 = theta ** 0.8
    p_plus_e = (p_hpa + e_hpa) * 1e-4 * t08
    return [
        (O2.A5[i] + O2.A6[i] * theta) * p_plus_e
        for i in range(len(O2.F0))
    ]


def _apply_zeeman_broadening(df):
    return [math.sqrt(x * x + 2.25e-6) for x in df]


def _line_shape_factor(f_ghz: float, f0, df, delta):
    out = []
    for i in range(len(f0)):
        fi = f0[i]
        dfi = df[i]
        di = delta[i]
        tm = (dfi - di * (fi - f_ghz)) / ((fi - f_ghz) ** 2 + dfi ** 2)
        tp = (dfi - di * (fi + f_ghz)) / ((fi + f_ghz) ** 2 + dfi ** 2)
        out.append((f_ghz / fi) * (tm + tp))
    return out


def _dry_continuum(f_ghz: float, p_hpa: float, e_hpa: float,
                   theta: float) -> float:
    d = 5.6e-4 * (p_hpa + e_hpa) * theta ** 0.8
    t_debye = 6.14e-5 / (d * (1.0 + (f_ghz / d) ** 2))
    t_nit = (1.4e-12 * p_hpa * theta ** 1.5) / (1.0 + 1.9e-5 * f_ghz ** 1.5)
    return f_ghz * p_hpa * theta ** 2 * (t_debye + t_nit)


def oxygen_imaginary_refractivity(
    f_ghz: float, p_hpa: float, e_hpa: float, temperature_k: float
) -> float:
    theta = _theta(temperature_k)
    S = _oxygen_line_strength(p_hpa, theta)
    df = _apply_zeeman_broadening(_oxygen_line_width(p_hpa, e_hpa, theta))
    delta = _oxygen_delta(p_hpa, e_hpa, theta)
    F = _line_shape_factor(f_ghz, O2.F0, df, delta)
    N_lines = sum(S[i] * F[i] for i in range(len(S)))
    return N_lines + _dry_continuum(f_ghz, p_hpa, e_hpa, theta)


def _water_vapour_line_strength(e_hpa: float, theta: float):
    t35 = theta ** 3.5
    e_base = 1.0 - theta
    return [
        H2O.B1[i] * 1e-1 * e_hpa * t35 * math.exp(H2O.B2[i] * e_base)
        for i in range(len(H2O.F0))
    ]


def _water_vapour_line_width(p_hpa: float, e_hpa: float, theta: float):
    return [
        H2O.B3[i] * 1e-4 * (
            p_hpa * theta ** H2O.B4[i]
            + H2O.B5[i] * e_hpa * theta ** H2O.B6[i])
        for i in range(len(H2O.F0))
    ]


def _apply_doppler_broadening(df, f0, theta: float):
    return [
        0.535 * df[i] + math.sqrt(
            0.217 * df[i] ** 2 + 2.1316e-12 * f0[i] ** 2 / theta)
        for i in range(len(f0))
    ]


def water_vapour_imaginary_refractivity(
    f_ghz: float, p_hpa: float, e_hpa: float, temperature_k: float
) -> float:
    theta = _theta(temperature_k)
    S = _water_vapour_line_strength(e_hpa, theta)
    df = _apply_doppler_broadening(
        _water_vapour_line_width(p_hpa, e_hpa, theta), H2O.F0, theta)
    delta = [0.0] * len(H2O.F0)
    F = _line_shape_factor(f_ghz, H2O.F0, df, delta)
    return sum(S[i] * F[i] for i in range(len(S)))


def specific_attenuation(
    f_ghz: float,
    p_hpa: float = 1013.25,
    e_hpa: float = 7.5,
    temperature_k: float = 288.15,
) -> float:
    N_o = oxygen_imaginary_refractivity(f_ghz, p_hpa, e_hpa, temperature_k)
    N_w = water_vapour_imaginary_refractivity(f_ghz, p_hpa, e_hpa, temperature_k)
    return 0.1820 * f_ghz * (N_o + N_w)


def specific_attenuation_components(
    f_ghz: float,
    p_hpa: float = 1013.25,
    e_hpa: float = 7.5,
    temperature_k: float = 288.15,
) -> ITUResult:
    result = ITUResult()
    result.metadata['model'] = MODEL_NAME
    result.metadata['version'] = 'P.676-13'
    result.metadata['mode'] = 'specific'

    if f_ghz < FREQ_MIN_GHZ or f_ghz > FREQ_MAX_GHZ:
        result.add_warning(
            f"f={f_ghz} ГГц вне [{FREQ_MIN_GHZ}, {FREQ_MAX_GHZ}], clamp применён")
        f_ghz = max(FREQ_MIN_GHZ, min(FREQ_MAX_GHZ, f_ghz))

    N_o = oxygen_imaginary_refractivity(f_ghz, p_hpa, e_hpa, temperature_k)
    N_w = water_vapour_imaginary_refractivity(f_ghz, p_hpa, e_hpa, temperature_k)
    result.add_component('gamma_o', 0.1820 * f_ghz * N_o)
    result.add_component('gamma_w', 0.1820 * f_ghz * N_w)

    result.metadata['f_ghz'] = f_ghz
    result.metadata['p_hpa'] = p_hpa
    result.metadata['e_hpa'] = e_hpa
    result.metadata['temperature_k'] = temperature_k
    return result


__all__ = [
    'specific_attenuation',
    'specific_attenuation_components',
    'oxygen_imaginary_refractivity',
    'water_vapour_imaginary_refractivity',
    'MODEL_NAME',
    'FREQ_MIN_GHZ',
    'FREQ_MAX_GHZ',
]

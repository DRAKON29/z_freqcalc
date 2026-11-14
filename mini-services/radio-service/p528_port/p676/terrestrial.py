# Copyright (c) 2026 Evgeny Gennadievich Prutkov <sviazist.pr@gmail.com>
# SPDX-License-Identifier: MIT
#
# Python implementation of ITU-R P.676-13.
# See README.md and NOTICE for attribution.

"""
core/itu/p676/terrestrial.py — Наземные трассы
по ITU-R P.676-13, Annex 1 §2.1.

Простая формула:
    A = γ · r₀   (дБ)
где γ — удельное затухание (дБ/км) при p, T, e на поверхности,
r₀ — длина трассы (км).

Применяется для наземных связей на высоких частотах, когда
атмосферное поглощение становится значимым (f > 10 ГГц).
"""

from .common.result import ITUResult
from .specific_attenuation import specific_attenuation


MODEL_NAME = "ITU-R P.676-13"


def terrestrial_path_attenuation(
    f_ghz: float,
    distance_km: float,
    p_hpa: float = 1013.25,
    e_hpa: float = 7.5,
    temperature_k: float = 288.15,
) -> ITUResult:
    """
    Затухание в газах на наземной трассе, P.676-13, ур. (10).

    Args:
        f_ghz: частота, ГГц.
        distance_km: длина трассы, км.
        p_hpa: сухое давление на поверхности, гПа.
        e_hpa: парциальное давление H₂O на поверхности, гПа.
        temperature_k: температура на поверхности, K.

    Returns:
        ITUResult с loss_db = A_gas.
    """
    result = ITUResult()
    result.metadata['model'] = MODEL_NAME
    result.metadata['version'] = 'P.676-13'
    result.metadata['mode'] = 'terrestrial'
    result.metadata['f_ghz'] = f_ghz
    result.metadata['distance_km'] = distance_km

    if distance_km < 0.0:
        result.add_warning(
            f"distance_km={distance_km} < 0, clamp к 0"
        )
        distance_km = 0.0

    gamma = specific_attenuation(f_ghz, p_hpa, e_hpa, temperature_k)
    A = gamma * distance_km

    result.add_component('A_gas', A)
    result.metadata['gamma_db_per_km'] = gamma

    return result


__all__ = ['terrestrial_path_attenuation']

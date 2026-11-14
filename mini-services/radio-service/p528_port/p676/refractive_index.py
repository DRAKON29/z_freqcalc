# Copyright (c) 2026 Evgeny Gennadievich Prutkov <sviazist.pr@gmail.com>
# SPDX-License-Identifier: MIT
#
# Python implementation of ITU-R P.676-13.
# See README.md and NOTICE for attribution.

"""
core/itu/p676/refractive_index.py — Радио-рефрактивный индекс n = 1 + N·10⁻⁶.

Соответствует ITU-R P.453, ур. (1):
    n = 1 + N · 1e-6
где N — рефрактивность в N-единицах.

Применяется в P.676 RayTrace (Annex 1 §2.2) для каждого слоя.
"""


def refractive_index_from_n_units(N: float) -> float:
    """
    n = 1 + N·10⁻⁶.

    Args:
        N: рефрактивность в N-единицах (обычно 250–400).

    Returns:
        Радио-рефрактивный индекс n (близок к 1).
    """
    return 1.0 + N * 1e-6


def refractive_index_from_pt_e(
    P_hpa: float, T_kelvin: float, e_hpa: float
) -> float:
    """
    Рефрактивный индекс из давления, температуры и парциального
    давления H₂O. Формула P.453, ур. (6):

        N = 77.6·P/T − 5.6·e/T + 3.75e5·e/T²

    Упрощённая форма (для совместимости с P.676):
        N = 77.6·(P + 4810·e/T) / T

    Args:
        P_hpa: сухое давление, гПа.
        T_kelvin: температура, K.
        e_hpa: парциальное давление H₂O, гПа.

    Returns:
        n (безразмерное).
    """
    if T_kelvin <= 0.0:
        return 1.0
    N = 77.6 * (P_hpa + 4810.0 * e_hpa / T_kelvin) / T_kelvin
    return 1.0 + N * 1e-6


__all__ = [
    'refractive_index_from_n_units',
    'refractive_index_from_pt_e',
]

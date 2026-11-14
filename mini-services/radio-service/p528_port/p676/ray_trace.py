# Copyright (c) 2026 Evgeny Gennadievich Prutkov <sviazist.pr@gmail.com>
# SPDX-License-Identifier: MIT
#
# Python implementation of ITU-R P.676-13.
# See README.md and NOTICE for attribution.

"""
core/itu/p676/ray_trace.py — RayTrace по ITU-R P.676-13, Annex 1 §2.2.

Точный порт C++ NTIA (RayTrace.cpp), адаптированный под Python.

Ключевые формулы:
    (13): A_gas = Σ a_i · γ_i
    (14): δ_i = m · exp((i-1)/100)                    — толщина слоя, км
    (16a): i_lower = floor(100·ln(1e4·h_1·(e^(1/100)−1) + 1) + 1)
    (16b): i_upper = ceil(100·ln(1e4·h_2·(e^(1/100)−1) + 1) + 1)
    (16c): m = ((e^(2/100) − e^(1/100))/(e^(i_upper/100) − e^(i_lower/100)))·(h_2 − h_1)
    (16d): h_i = h_1 + m·(e^((i−1)/100) − e^((i_lower−1)/100))/(e^(1/100) − 1)
    (17): a_i = −r_i·cos β_i + sqrt(r_i²·cos²β_i + 2·r_i·δ_i + δ_i²)
    (18a): α_i = asin( (n₁·r₁)/(n_i·r_{i+1}) · sin β₁ )  — используется в C++
    (19b): β_i = asin( (n₁·r₁)/(n_i·r_i) · sin β₁ )
    (22a): bending = Σ(β_{i+1} − α_i)
    (23): ΔL = Σ a_i·(n_i − 1)
"""

import math
from typing import Optional, Callable
from dataclasses import dataclass, field

from .common.constants import EARTH_RADIUS_KM


# =====================================================================
# КОНФИГУРАЦИЯ ПРОФИЛЯ АТМОСФЕРЫ
# =====================================================================

@dataclass
class RayTraceConfig:
    """
    Профиль атмосферы для RayTrace.

    Все три функции зависят от геометрической высоты z (км):
        temperature(z)  -> K
        dry_pressure(z) -> hPa (сухое давление = P_total − e)
        wet_pressure(z) -> hPa (парциальное давление H₂O)
    """
    temperature: Callable[[float], float]
    dry_pressure: Callable[[float], float]
    wet_pressure: Callable[[float], float]


@dataclass
class SlantPathAttenuationResult:
    """Результат RayTrace."""
    A_gas__db: float = 0.0          # Median gaseous absorption, dB
    bending__rad: float = 0.0       # Bending angle, rad
    a__km: float = 0.0              # Ray length, km
    angle__rad: float = 0.0         # Incident angle at h_2, rad (from zenith)
    delta_L__km: float = 0.0        # Excess atmospheric path length, km


# =====================================================================
# КОНСТАНТЫ (из C++ p676.h)
# =====================================================================

a_0__km = 6371.0


# =====================================================================
# ТОЛЩИНА СЛОЯ (C++ LayerThickness)
# =====================================================================

def _layer_thickness(m: float, i: int) -> float:
    """
    Толщина i-го слоя, P.676-13 ур. (14):
        δ_i = m · exp((i − 1) / 100)
    """
    return m * math.exp((i - 1) / 100.0)


# =====================================================================
# RAYTRACE (главная функция, точный порт C++)
# =====================================================================

def ray_trace(
    f__ghz: float,
    h_1__km: float,
    h_2__km: float,
    beta_1__rad: float,
    config: RayTraceConfig,
) -> SlantPathAttenuationResult:
    """
    Порт C++ RayTrace. Трассировка луча от h_1 до h_2.

    Args:
        f__ghz: частота, ГГц.
        h_1__km: нижняя высота, км.
        h_2__km: верхняя высота, км (h_2 > h_1 ≥ 0).
        beta_1__rad: зенитный угол на h_1, рад.
        config: RayTraceConfig.

    Returns:
        SlantPathAttenuationResult.
    """
    # Equations 16(a)-(c)
    i_lower = int(math.floor(
        100.0 * math.log(1e4 * h_1__km * (math.exp(1.0 / 100.0) - 1.0) + 1.0)
        + 1.0
    ))
    i_upper = int(math.ceil(
        100.0 * math.log(1e4 * h_2__km * (math.exp(1.0 / 100.0) - 1.0) + 1.0)
        + 1.0
    ))
    m = (
        (math.exp(2.0 / 100.0) - math.exp(1.0 / 100.0))
        / (math.exp(i_upper / 100.0) - math.exp(i_lower / 100.0))
    ) * (h_2__km - h_1__km)

    # Инициализация результатов
    result = SlantPathAttenuationResult()

    # Инициализация первого слоя
    delta_i__km = _layer_thickness(m, i_lower)
    h_i__km = h_1__km + m * (
        (math.exp((i_lower - 1) / 100.0) - math.exp((i_lower - 1) / 100.0))
        / (math.exp(1.0 / 100.0) - 1.0)
    )
    n_i, gamma_i = _get_layer_properties(f__ghz, h_i__km + delta_i__km / 2.0, config)
    r_i__km = a_0__km + h_i__km

    # Запоминаем нижний слой для расчёта alpha и beta
    r_1__km = r_i__km
    n_1 = n_i

    alpha_i__rad = beta_1__rad
    beta_ii__rad = beta_1__rad

    # Суммирование по Ур. (13)
    for i in range(i_lower, i_upper):
        delta_ii__km = _layer_thickness(m, i + 1)
        h_ii__km = h_1__km + m * (
            (math.exp((i + 1 - 1) / 100.0) - math.exp((i_lower - 1) / 100.0))
            / (math.exp(1.0 / 100.0) - 1.0)
        )

        n_ii, gamma_ii = _get_layer_properties(
            f__ghz, h_ii__km + delta_ii__km / 2.0, config
        )
        r_ii__km = a_0__km + h_ii__km
        delta_i__km = _layer_thickness(m, i)

        # Equation 19b
        arg_beta = (n_1 * r_1__km) / (n_i * r_i__km) * math.sin(beta_1__rad)
        beta_i__rad = math.asin(min(1.0, arg_beta))

        # Equation 18a
        arg_alpha = (n_1 * r_1__km) / (n_i * r_ii__km) * math.sin(beta_1__rad)
        alpha_i__rad = math.asin(min(1.0, arg_alpha))

        # Equation 17
        a_i__km = (
            -r_i__km * math.cos(beta_i__rad)
            + math.sqrt(
                r_i__km ** 2 * math.cos(beta_i__rad) ** 2
                + 2.0 * r_i__km * delta_i__km
                + delta_i__km ** 2
            )
        )

        result.a__km += a_i__km
        result.A_gas__db += a_i__km * gamma_i
        result.delta_L__km += a_i__km * (n_i - 1.0)

        beta_ii__rad = math.asin(n_i / n_ii * math.sin(alpha_i__rad))

        # Bending summation (Equation 22a), только до i_max-1
        if i != i_upper - 1:
            result.bending__rad += beta_ii__rad - alpha_i__rad

        # Сдвиг для следующей итерации
        h_i__km = h_ii__km
        n_i = n_ii
        gamma_i = gamma_ii
        r_i__km = r_ii__km

    result.angle__rad = alpha_i__rad
    return result


# =====================================================================
# СВОЙСТВА СЛОЯ (C++ GetLayerProperties)
# =====================================================================

def _get_layer_properties(
    f__ghz: float, h_i__km: float, config: RayTraceConfig
):
    """
    Рефрактивный индекс и удельное затухание слоя.

    Args:
        f__ghz: частота, ГГц.
        h_i__km: высота середины слоя, км.
        config: RayTraceConfig.

    Returns:
        (n, gamma) — рефрактивный индекс и удельное затухание, дБ/км.
    """
    T__kelvin = config.temperature(h_i__km)
    p__hPa = config.dry_pressure(h_i__km)
    e__hPa = config.wet_pressure(h_i__km)

    n = _refractive_index(p__hPa, T__kelvin, e__hPa)
    gamma = _specific_attenuation(f__ghz, T__kelvin, e__hPa, p__hPa)


    return n, gamma


# =====================================================================
# ВСПОМОГАТЕЛЬНЫЕ (порт C++ RefractiveIndex.cpp, SpecificAttenuation.cpp)
# =====================================================================

def _refractive_index(p__hPa: float, T__kelvin: float, e__hPa: float) -> float:
    """
    RefractiveIndex (C++ RefractiveIndex.cpp).

    Формула (P.453):
        N_dry = 77.6 · p / T
        N_wet = 72 · e / T + 3.75e5 · e / T²
        n = 1 + (N_dry + N_wet)·1e-6
    """
    N_dry = 77.6 * p__hPa / T__kelvin
    N_wet = 72.0 * e__hPa / T__kelvin + 3.75e5 * e__hPa / (T__kelvin ** 2)
    N = N_dry + N_wet
    return 1.0 + N * 1e-6


def _specific_attenuation(
    f__ghz: float, T__kelvin: float, e__hPa: float, p__hPa: float
) -> float:
    """
    SpecificAttenuation — делегирует в наш specific_attenuation.
    """
    from .specific_attenuation import specific_attenuation as _sa
    return _sa(f__ghz, p__hPa, e__hPa, T__kelvin)


__all__ = [
    'RayTraceConfig',
    'SlantPathAttenuationResult',
    'ray_trace',
    'a_0__km',
]

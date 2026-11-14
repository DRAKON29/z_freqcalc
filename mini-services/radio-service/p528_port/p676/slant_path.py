# Copyright (c) 2026 Evgeny Gennadievich Prutkov <sviazist.pr@gmail.com>
# SPDX-License-Identifier: MIT
#
# Python implementation of ITU-R P.676-13.
# See README.md and NOTICE for attribution.

"""
core/itu/p676/slant_path.py — Наклонные трассы (Earth-space)
по ITU-R P.676-13, Annex 1 §2.2.

Версия 2 — согласована с портом C++ NTIA (ray_trace.py).

Обёртка над ray_trace() с учётом:
    * Zenith-angle ↔ elevation-angle;
    * Профиля атмосферы через RayTraceConfig (функции T(z), p(z), e(z)).

Публичный API возвращает ITUResult с разбивкой по компонентам:
    loss_db                 — полное A_gas, дБ
    components['A_o']       — вклад O₂, дБ
    components['A_w']       — вклад H₂O, дБ
    metadata['bending_deg']     — bending, градусы
    metadata['bending_rad']     — bending, радианы
    metadata['excess_path_km']  — ΔL, км
    metadata['ray_length_km']   — длина луча, км
    metadata['angle_rad']       — угол падения на h_2, рад

Низкоуровневый ray_trace() остаётся доступен как есть и используется
напрямую в P.528-5 (TerminalGeometry, LineOfSight, transhorizon), где
нужны «сырые» поля SlantPathAttenuationResult.
"""

import math
from typing import Optional

from .common.result import ITUResult
from .ray_trace import (
    RayTraceConfig,
    SlantPathAttenuationResult,
    ray_trace,
)


MODEL_NAME = "ITU-R P.676-13"


def _default_config() -> RayTraceConfig:
    """
    Профиль атмосферы по умолчанию — ITU-R P.835 Annex 1.

    Возвращает RayTraceConfig с тремя функциями от геометрической
    высоты z (км):

        temperature(z)   — K
        dry_pressure(z)  — hPa (p_total − e)
        wet_pressure(z)  — hPa (парциальное давление H₂O)

    ВАЖНО: ray_trace() при численном интегрировании заходит в слои
    вплоть до z ≈ 100.5 км (на несколько сотен метров выше верхней
    границы P.835). Поэтому функции профиля клампят высоту к [0, 100] км,
    чтобы не бросать ITUValidationError из публичных global_*.
    На верхней границе P.835 (100 км) T, P, e становятся «почти нулевыми»
    и дальнейшая экстраполяция на 0.5 км не влияет на результат.
    """
    from p835 import (
        global_temperature,
        global_pressure,
        global_water_vapour_density,
    )
    from .p835.conversions import water_vapour_density_to_pressure

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
        """
        GlobalWetPressure из C++ (P.676 GlobalWetPressure.cpp).

        Формула:
            rho = max(rho_835, 2e-6 * 216.7 * P / T)
            e = rho * T / 216.7
        """
        z = _clamp_z(h__km)
        T__k = global_temperature(z)
        P__hpa = global_pressure(z)
        rho = max(
            global_water_vapour_density(z, 7.5),
            2.0e-6 * 216.7 * P__hpa / T__k
        )
        return water_vapour_density_to_pressure(rho, T__k)

    return RayTraceConfig(
        temperature=_temperature,
        dry_pressure=_pressure,
        wet_pressure=_wet_pressure,
    )


def slant_path_attenuation(
    f__ghz: float,
    h1__km: float,
    h2__km: float,
    elevation_deg: float,
    config: Optional[RayTraceConfig] = None,
) -> ITUResult:
    """
    Затухание в газах на наклонной трассе (Earth-space).

    Публичная обёртка над ray_trace(), возвращает ITUResult с
    разбивкой по компонентам A_o (кислород) и A_w (водяной пар).

    Разбивка делается вторым вызовом ray_trace() с занулённым
    wet_pressure — это удваивает стоимость, но даёт единый интерфейс
    ITUResult (ТЗ п. 6.0.1).

    Args:
        f__ghz: частота, ГГц.
        h1__km: нижняя высота, км (обычно 0).
        h2__km: верхняя высота, км (h1 < h2, обычно 100).
        elevation_deg: угол места (apparent elevation angle), градусы.
        config: RayTraceConfig (по умолчанию — ITU-R P.835 Annex 1).

    Returns:
        ITUResult с полями:
            loss_db            — полное A_gas, дБ
            components['A_o']  — вклад O₂, дБ
            components['A_w']  — вклад H₂O, дБ
            metadata['bending_deg']     — bending, градусы
            metadata['bending_rad']     — bending, радианы
            metadata['excess_path_km']  — ΔL, км
            metadata['ray_length_km']   — длина луча, км
            metadata['angle_rad']       — угол падения на h_2, рад
            metadata['elevation_deg']   — входной угол места
            metadata['f_ghz'], ['h1_km'], ['h2_km']
    """
    if config is None:
        config = _default_config()

    beta_1__rad = math.radians(90.0 - elevation_deg)

    # --- Полный расчёт ---
    full = ray_trace(
        f__ghz=f__ghz,
        h_1__km=h1__km,
        h_2__km=h2__km,
        beta_1__rad=beta_1__rad,
        config=config,
    )

    # --- Расчёт с занулённым водяным паром: остаётся только O₂ ---
    zero_wet_config = RayTraceConfig(
        temperature=config.temperature,
        dry_pressure=config.dry_pressure,
        wet_pressure=lambda h: 0.0,
    )
    oxygen_only = ray_trace(
        f__ghz=f__ghz,
        h_1__km=h1__km,
        h_2__km=h2__km,
        beta_1__rad=beta_1__rad,
        config=zero_wet_config,
    )

    A_o__db = oxygen_only.A_gas__db
    A_w__db = full.A_gas__db - A_o__db

    result = ITUResult()
    result.metadata['model'] = MODEL_NAME
    result.metadata['version'] = 'P.676-13'
    result.metadata['mode'] = 'slant'
    result.metadata['f_ghz'] = f__ghz
    result.metadata['h1_km'] = h1__km
    result.metadata['h2_km'] = h2__km
    result.metadata['elevation_deg'] = elevation_deg

    result.metadata['bending_rad'] = full.bending__rad
    result.metadata['bending_deg'] = math.degrees(full.bending__rad)
    result.metadata['excess_path_km'] = full.delta_L__km
    result.metadata['ray_length_km'] = full.a__km
    result.metadata['angle_rad'] = full.angle__rad

    result.add_component('A_o', A_o__db)
    result.add_component('A_w', A_w__db)

    return result


def zenith_attenuation(
    f__ghz: float,
    h1__km: float = 0.0,
    h2__km: float = 100.0,
    config: Optional[RayTraceConfig] = None,
) -> ITUResult:
    """
    Зенитное затухание — наклонная трасса с θ = 90°.

    Args:
        f__ghz: частота, ГГц.
        h1__km: нижняя высота, км.
        h2__km: верхняя высота, км.
        config: RayTraceConfig.

    Returns:
        ITUResult (см. slant_path_attenuation).
    """
    return slant_path_attenuation(
        f__ghz=f__ghz,
        h1__km=h1__km,
        h2__km=h2__km,
        elevation_deg=90.0,
        config=config,
    )


__all__ = [
    'slant_path_attenuation',
    'zenith_attenuation',
    '_default_config',
    'MODEL_NAME',
]

# Copyright (c) 2026 Evgeny Gennadievich Prutkov <sviazist.pr@gmail.com>
# SPDX-License-Identifier: MIT
#
# Python implementation of ITU-R P.835-7.
# See README.md and NOTICE for attribution.

"""
p835 — ITU-R P.835-7 (Reference standard atmospheres).

Использование:
    from .p835 import global_temperature, global_pressure

    T = global_temperature(10.0)   # K
    P = global_pressure(10.0)      # гПа
"""

from .reference_atmosphere import (
    global_temperature,
    global_pressure,
    global_water_vapour_density,
    global_wet_pressure,
    MODEL_NAME,
)
from .seasonal_atmosphere import (
    AtmosphereRegion,
    Season,
    interpolated_temperature,
    interpolated_pressure,
    interpolated_water_vapour,
    get_region_for_latitude,
    regional_temperature,
    regional_pressure,
    regional_water_vapour,
    low_latitude_annual_temperature,
    low_latitude_annual_pressure,
    low_latitude_annual_water_vapour,
    mid_latitude_summer_temperature,
    mid_latitude_summer_pressure,
    mid_latitude_summer_water_vapour,
    mid_latitude_winter_temperature,
    mid_latitude_winter_pressure,
    mid_latitude_winter_water_vapour,
    high_latitude_summer_temperature,
    high_latitude_summer_pressure,
    high_latitude_summer_water_vapour,
    high_latitude_winter_temperature,
    high_latitude_winter_pressure,
    high_latitude_winter_water_vapour,
)
from .conversions import (
    convert_to_geopotential_height,
    convert_to_geometric_height,
    water_vapour_density_to_pressure,
    water_vapour_pressure_to_density,
)

__version__ = "0.1.0"

__all__ = [
    "global_temperature", "global_pressure",
    "global_water_vapour_density", "global_wet_pressure",
    "MODEL_NAME",
    "AtmosphereRegion", "Season",
    "interpolated_temperature", "interpolated_pressure",
    "interpolated_water_vapour", "get_region_for_latitude",
    "regional_temperature", "regional_pressure",
    "regional_water_vapour",
    "low_latitude_annual_temperature",
    "low_latitude_annual_pressure",
    "low_latitude_annual_water_vapour",
    "mid_latitude_summer_temperature",
    "mid_latitude_summer_pressure",
    "mid_latitude_summer_water_vapour",
    "mid_latitude_winter_temperature",
    "mid_latitude_winter_pressure",
    "mid_latitude_winter_water_vapour",
    "high_latitude_summer_temperature",
    "high_latitude_summer_pressure",
    "high_latitude_summer_water_vapour",
    "high_latitude_winter_temperature",
    "high_latitude_winter_pressure",
    "high_latitude_winter_water_vapour",
    "convert_to_geopotential_height",
    "convert_to_geometric_height",
    "water_vapour_density_to_pressure",
    "water_vapour_pressure_to_density",
]

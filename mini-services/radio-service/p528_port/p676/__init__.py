# Copyright (c) 2026 Evgeny Gennadievich Prutkov <sviazist.pr@gmail.com>
# SPDX-License-Identifier: MIT
#
# Python implementation of ITU-R P.676-13.
# See README.md and NOTICE for attribution.

"""
p676 — ITU-R P.676-13 (Attenuation by atmospheric gases).

Использование:
    from p676 import specific_attenuation, ray_trace, RayTraceConfig

    gamma = specific_attenuation(60.0)   # дБ/км
"""

from .specific_attenuation import (
    specific_attenuation,
    specific_attenuation_components,
    oxygen_imaginary_refractivity,
    water_vapour_imaginary_refractivity,
    MODEL_NAME,
    FREQ_MIN_GHZ,
    FREQ_MAX_GHZ,
)
from .refractivity import (
    complex_refractivity,
    oxygen_real_refractivity,
    water_vapour_real_refractivity,
    phase_dispersion_deg_per_km,
)
from .refractive_index import (
    refractive_index_from_n_units,
    refractive_index_from_pt_e,
)
from .ray_trace import (
    RayTraceConfig,
    SlantPathAttenuationResult,
    ray_trace,
)
from .slant_path import (
    slant_path_attenuation,
    zenith_attenuation,
)
from .terrestrial import (
    terrestrial_path_attenuation,
)
from . import oxygen_data as _o2
from . import water_vapour_data as _h2o

O2_F0 = _o2.F0
O2_A1, O2_A2, O2_A3, O2_A4, O2_A5, O2_A6 = (
    _o2.A1, _o2.A2, _o2.A3, _o2.A4, _o2.A5, _o2.A6,
)
H2O_F0 = _h2o.F0
H2O_B1, H2O_B2, H2O_B3, H2O_B4, H2O_B5, H2O_B6 = (
    _h2o.B1, _h2o.B2, _h2o.B3, _h2o.B4, _h2o.B5, _h2o.B6,
)

__version__ = "0.1.0"

__all__ = [
    "specific_attenuation", "specific_attenuation_components",
    "oxygen_imaginary_refractivity", "water_vapour_imaginary_refractivity",
    "MODEL_NAME", "FREQ_MIN_GHZ", "FREQ_MAX_GHZ",
    "complex_refractivity", "oxygen_real_refractivity",
    "water_vapour_real_refractivity", "phase_dispersion_deg_per_km",
    "refractive_index_from_n_units", "refractive_index_from_pt_e",
    "RayTraceConfig", "SlantPathAttenuationResult", "ray_trace",
    "slant_path_attenuation", "zenith_attenuation",
    "terrestrial_path_attenuation",
    "O2_F0", "O2_A1", "O2_A2", "O2_A3", "O2_A4", "O2_A5", "O2_A6",
    "H2O_F0", "H2O_B1", "H2O_B2", "H2O_B3", "H2O_B4", "H2O_B5",
    "H2O_B6",
]

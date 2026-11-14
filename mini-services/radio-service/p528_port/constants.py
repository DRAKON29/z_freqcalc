# Copyright (c) 2026 Evgeny Gennadievich Prutkov <sviazist.pr@gmail.com>
# SPDX-License-Identifier: MIT
#
# Python implementation of ITU-R P.528-5.
# See README.md and NOTICE for attribution.

"""
core/itu/p528/constants.py — Константы ITU-R P.528-5.

Источник: C++ p528.h + текст Рекомендации (Annex 2, §2).
"""

import math


# =====================================================================
# ГЕОМЕТРИЧЕСКИЕ И ФИЗИЧЕСКИЕ КОНСТАНТЫ (P.528-5, §2)
# =====================================================================

# Average radius of the Earth (km)
a_0__km = 6371.0

# Effective radius of the Earth (km) — учитывает стандартную рефракцию
a_e__km = 9257.0

# Refractivity at surface (N-units) — average continental temperate
N_s = 341.0

# Relative dielectric constant (average ground)
epsilon_r = 15.0

# Conductivity (S/m, average ground)
sigma = 0.005

# Tolerance для LOS-детектора
LOS_EPSILON = 1e-5

# 1/3
THIRD = 1.0 / 3.0

# PI
PI = math.pi

# =====================================================================
# КОДЫ РЕЖИМОВ (C++ CONST_MODE_*)
# =====================================================================

CONST_MODE__SEARCH = 0
CONST_MODE__DIFFRACTION = 1
CONST_MODE__SCATTERING = 2

CASE_1 = 1
CASE_2 = 2

PROP_MODE__NOT_SET = 0
PROP_MODE__LOS = 1
PROP_MODE__DIFFRACTION = 2
PROP_MODE__SCATTERING = 3

# =====================================================================
# ПОЛЯРИЗАЦИЯ
# =====================================================================

POLARIZATION__HORIZONTAL = 0
POLARIZATION__VERTICAL = 1

# =====================================================================
# КОДЫ ВОЗВРАТА (C++ p528.h)
# =====================================================================

SUCCESS = 0
ERROR_VALIDATION__D_KM = 1
ERROR_VALIDATION__H_1 = 2
ERROR_VALIDATION__H_2 = 3
ERROR_VALIDATION__TERM_GEO = 4
ERROR_VALIDATION__F_MHZ_LOW = 5
ERROR_VALIDATION__F_MHZ_HIGH = 6
ERROR_VALIDATION__PERCENT_LOW = 7
ERROR_VALIDATION__PERCENT_HIGH = 8
ERROR_VALIDATION__POLARIZATION = 9
ERROR_HEIGHT_AND_DISTANCE = 10
WARNING__DFRAC_TROPO_REGION = 20

# Индекс Y_pi(99) в массиве P (см. data.py)
Y_pi_99_INDEX = 16

# =====================================================================
# ДИАПАЗОНЫ ПРИМЕНИМОСТИ
# =====================================================================

FREQ_MIN_MHZ = 100.0
FREQ_MAX_MHZ = 30000.0
H_MIN_METER = 1.5
H_MAX_METER = 20000.0
P_MIN_PERCENT = 1.0
P_MAX_PERCENT = 99.0


__all__ = [
    'a_0__km', 'a_e__km', 'N_s', 'epsilon_r', 'sigma',
    'LOS_EPSILON', 'THIRD', 'PI',
    'CONST_MODE__SEARCH', 'CONST_MODE__DIFFRACTION', 'CONST_MODE__SCATTERING',
    'CASE_1', 'CASE_2',
    'PROP_MODE__NOT_SET', 'PROP_MODE__LOS',
    'PROP_MODE__DIFFRACTION', 'PROP_MODE__SCATTERING',
    'POLARIZATION__HORIZONTAL', 'POLARIZATION__VERTICAL',
    'SUCCESS',
    'ERROR_VALIDATION__D_KM', 'ERROR_VALIDATION__H_1',
    'ERROR_VALIDATION__H_2', 'ERROR_VALIDATION__TERM_GEO',
    'ERROR_VALIDATION__F_MHZ_LOW', 'ERROR_VALIDATION__F_MHZ_HIGH',
    'ERROR_VALIDATION__PERCENT_LOW', 'ERROR_VALIDATION__PERCENT_HIGH',
    'ERROR_VALIDATION__POLARIZATION', 'ERROR_HEIGHT_AND_DISTANCE',
    'WARNING__DFRAC_TROPO_REGION',
    'Y_pi_99_INDEX',
    'FREQ_MIN_MHZ', 'FREQ_MAX_MHZ',
    'H_MIN_METER', 'H_MAX_METER',
    'P_MIN_PERCENT', 'P_MAX_PERCENT',
]

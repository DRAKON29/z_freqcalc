# -*- coding: utf-8 -*-
# ============================================================================
# ВЕНДОРЕННЫЙ КОД (z_freqcalc): ITU-R P.528-5 — реализация PyP528
# ----------------------------------------------------------------------------
# Источник: пакет p528 0.1.0 с PyPI — Python-порт эталонной C++ реализации
# NTIA/p528 (см. NOTICE: автор порта Evgeny Gennadievich Prutkov, 2026; ядро —
# NTIA, public domain, 15 USC 105; лицензия порта MIT — LICENSE рядом).
# Порты-спутники того же автора p676 (P.676 ray trace) и p835 (P.835 reference
# atmosphere) вендорятся субпакетами ./p676 и ./p835.
#
# Расчётная логика не менялась. Изменения относительно оригинала
# (2026-11-14, z_freqcalc):
# 1. Абсолютные импорты p676/p835 переведены на относительные (.p676 / .p835)
#    — пакеты вендорятся внутрь p528_port, PyPI-версии не требуются
#    (p528.py, los.py, terminal.py, p676/slant_path.py).
# 2. Пакет переименован p528 -> p528_port (внедрение в сервис z_freqcalc).
#
# Без этого пакета модель P.528 в main.py._p528_available() недоступна —
# клиент уходит в TS-фоллбек P.2001-lite с предупреждением.
# ============================================================================
# Copyright (c) 2026 Evgeny Gennadievich Prutkov <sviazist.pr@gmail.com>
# SPDX-License-Identifier: MIT

from .p528 import p528  # noqa: F401
from .constants import (  # noqa: F401
    POLARIZATION__VERTICAL,
    POLARIZATION__HORIZONTAL,
    PROP_MODE__LOS,
    PROP_MODE__DIFFRACTION,
    PROP_MODE__SCATTERING,
    SUCCESS,
)
from .validation import validate_inputs  # noqa: F401

__all__ = [
    "p528",
    "validate_inputs",
    "POLARIZATION__VERTICAL",
    "POLARIZATION__HORIZONTAL",
    "PROP_MODE__LOS",
    "PROP_MODE__DIFFRACTION",
    "PROP_MODE__SCATTERING",
    "SUCCESS",
]

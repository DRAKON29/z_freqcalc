# Copyright (c) 2026 Evgeny Gennadievich Prutkov <sviazist.pr@gmail.com>
# SPDX-License-Identifier: MIT
#
# Python implementation of ITU-R P.835-7.
# See README.md and NOTICE for attribution.

"""
core/itu/common/exceptions.py — Исключения для моделей ITU-R.
"""


class ITUError(Exception):
    """Базовый класс для всех ошибок моделей ITU-R."""
    pass


class ITUValidationError(ITUError):
    """
    Ошибка валидации входных параметров.

    Поднимается, когда параметр критически вне диапазона применимости
    модели, и клиент запросил строгий режим (strict=True).
    """

    def __init__(self, model: str, param: str, value, expected: str):
        self.model = model
        self.param = param
        self.value = value
        self.expected = expected
        super().__init__(
            f"[{model}] Параметр '{param}' = {value} вне диапазона: {expected}"
        )


class ITUComputationError(ITUError):
    """Ошибка в процессе вычисления (NaN, деление на ноль и т.п.)."""
    pass


__all__ = ['ITUError', 'ITUValidationError', 'ITUComputationError']

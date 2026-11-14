# Copyright (c) 2026 Evgeny Gennadievich Prutkov <sviazist.pr@gmail.com>
# SPDX-License-Identifier: MIT
#
# Python implementation of ITU-R P.528-5.
# See README.md and NOTICE for attribution.

"""
core/itu/common/result.py — Единый интерфейс результата и базовый класс
для всех моделей ITU-R.

Все модели (P.528, P.676, P.835, P.452, P.1812, P.2108, P.530, ...)
возвращают ITUResult. Это обеспечивает единообразие обёрток в
core/propagation/ и упрощает логирование, сравнение и тестирование.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple, Any


@dataclass
class ITUResult:
    """
    Результат расчёта модели ITU-R.

    Attributes:
        loss_db: общие потери, дБ (положительное значение = затухание).
        components: разложение потерь по компонентам. Ключи зависят от
            модели (например, 'fspl', 'diffraction', 'troposcatter').
            Сумма components должна давать loss_db, если это применимо.
        metadata: метаданные расчёта. Обязательные ключи:
            * 'model' — название модели (например, 'ITU-R P.835-7');
            * 'mode' — режим (LOS/DIFFRACTION/...);
            * 'version' — версия рекомендации.
            Дополнительные ключи зависят от модели.
        warnings: список предупреждений (например, clamp параметра).
    """
    loss_db: float = 0.0
    components: Dict[str, float] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)

    def add_component(self, name: str, value_db: float) -> None:
        """Добавляет компонент потерь и увеличивает loss_db."""
        self.components[name] = float(value_db)
        self.loss_db += float(value_db)

    def add_warning(self, message: str) -> None:
        """Добавляет предупреждение (с защитой от дубликатов)."""
        if message not in self.warnings:
            self.warnings.append(message)

    def to_dict(self) -> dict:
        """Сериализация в dict для отчётов/логов."""
        return {
            'loss_db': float(self.loss_db),
            'components': {k: float(v) for k, v in self.components.items()},
            'metadata': dict(self.metadata),
            'warnings': list(self.warnings),
        }


class ITUModel:
    """
    Базовый класс для всех моделей ITU-R.

    Наследники должны переопределить:
        * RECOMMENDATION — название рекомендации (например, 'ITU-R P.835-7').
        * FREQ_RANGE_MHZ — диапазон частот (min, max) в МГц.
        * DIST_RANGE_KM — диапазон расстояний (min, max) в км.
        * calculate(params) -> ITUResult
    """

    RECOMMENDATION: str = ""
    FREQ_RANGE_MHZ: Tuple[float, float] = (0.0, 0.0)
    DIST_RANGE_KM: Tuple[float, float] = (0.0, 0.0)
    DESCRIPTION: str = ""

    def calculate(self, params: dict) -> ITUResult:
        """
        Основной метод расчёта.

        Args:
            params: словарь параметров (зависит от модели).

        Returns:
            ITUResult.

        Raises:
            NotImplementedError: если наследник не переопределил.
        """
        raise NotImplementedError(
            f"{type(self).__name__}.calculate() не реализован"
        )

    # -------- вспомогательные методы для наследников --------

    @staticmethod
    def _validate_range(
        value: float,
        vmin: float,
        vmax: float,
        param_name: str,
        model_name: str,
        strict: bool = False,
    ) -> Tuple[float, Optional[str]]:
        """
        Проверяет, что value ∈ [vmin, vmax].

        Args:
            value: значение параметра.
            vmin, vmax: границы.
            param_name: имя параметра (для сообщения).
            model_name: название модели (для сообщения).
            strict: если True — вне диапазона кидает ITUValidationError,
                    иначе — clamp + warning.

        Returns:
            (clamped_value, warning_or_None).
        """
        from .exceptions import ITUValidationError

        if vmin <= value <= vmax:
            return value, None

        if strict:
            raise ITUValidationError(
                model_name, param_name, value, f"[{vmin}, {vmax}]"
            )

        clamped = max(vmin, min(vmax, value))
        warning = (
            f"[{model_name}] {param_name}={value} вне "
            f"[{vmin}, {vmax}], clamp к {clamped}"
        )
        return clamped, warning


__all__ = ['ITUResult', 'ITUModel']

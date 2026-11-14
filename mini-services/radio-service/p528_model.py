# -*- coding: utf-8 -*-
"""
Адаптер P.528-5 (роадмап 3.5): CalculationInput (dict) → PropagationResult (dict).

Реализация — вендоренный порт PyP528 (p528_port/, Python-порт эталонной
C++ реализации NTIA/p528, public domain + MIT, см. шапку p528_port/__init__.py).

P.528-5 — авиационная модель «воздух–земля» на ГЛАДКОЙ сферической земле:
рельеф, clutter и координаты НЕ используются (трасса = d + две высоты);
газы по P.676 и эталонная атмосфера по P.835 внутри порта.

Конвенции (зафиксированы в README):
  • d = path.distanceM (большой круг); трассы с d = 0 не поддерживаются
    портом (внутренний log10 от нуля) — ValueError, main.py уходит в lite;
  • h1 = txHeightM (наземный Tx, высота над гладкой землёй), h2 = rxHeightM
    (подвижный Rx — высота полёта); диапазон порта 1.5–20000 м — клиентские
    значения зажимаются с предупреждением; при h1 > h2 терминалы меняются
    местами (модель симметрична по геометрии);
  • квантили: timePercents клиента — «потери ПРЕВЫШАЮТСЯ p % времени»,
    p порта — «НЕ превышаются p %» → p_528 = 100 − p_клиента (медиана
    p = 50 ↔ 50); диапазон порта 1–99 % — зажим с предупреждением;
  • усиления антенн не входят в модель (базовые потери передачи Lb);
  • разбивка: freeSpaceDb — A_fs, diffractionDb — max(0, A − A_fs)
    (газы A_a уже внутри итога A); доминирующий механизм по
    propagation_mode (1 LOS / 2 дифракция / 3 тропосферное рассеяние)
    добавляется в warnings;
  • поляризация: vertical → 1, horizontal → 0, circular → 1 с предупреждением.
"""
import numpy as np

from p528_port import (  # noqa: F401
    p528,
    validate_inputs,
    POLARIZATION__VERTICAL,
    POLARIZATION__HORIZONTAL,
    SUCCESS,
)

# Границы порта (validate_inputs)
_MIN_H_M, _MAX_H_M = 1.5, 20000.0
_MIN_P, _MAX_P = 1.0, 99.0

# Имена режимов распространения P.528-5
_MODE_NAMES = {
    1: "LOS",
    2: "дифракция на гладкой сфере",
    3: "тропосферное рассеяние",
}

_POL_MAP = {"vertical": 1, "horizontal": 0}  # T_pol: 1 вертикальная, 0 горизонтальная


def _port_percent(client_p: float) -> float:
    """Клиентское «превышаются p %» → процент порта «не превышаются».

    Пограничные значения (Tpc = 100 − p вне 1–99) зажимаются; предупреждение
    добавляется вызывающим кодом один раз на весь список timePercents.
    """
    tpc = 100.0 - min(99.999, max(0.001, float(client_p)))
    return min(_MAX_P, max(_MIN_P, tpc))


def _has_percent_out_of_range(inp: dict) -> bool:
    pcts = inp.get("timePercents") or [50]
    return any(not (1.0 <= 100.0 - float(p) <= 99.0) for p in pcts)


def calculate_full(inp: dict, engine_note: str = "P.528-5 (NTIA reference port)") -> dict:
    """P.528-5 по длине трассы и высотам терминалов (гладкая сфера).

    Бросает ValueError при d = 0 (порт не поддерживает нулевую дальность).
    """
    path = inp["path"]
    d_km = float(path["distanceM"]) / 1000.0
    if d_km <= 0:
        raise ValueError("path.distanceM: P.528-5 требует положительную длину трассы")
    warnings: list[str] = []

    warnings.append(
        "P.528-5 — авиационная модель по гладкой сферической земле: профиль рельефа "
        "и clutter не учитываются, трасса задана дальностью и высотами терминалов"
    )

    h1 = float(inp.get("txHeightM", 10))
    h2 = float(inp.get("rxHeightM", 10))
    for name, value in (("txHeightM", h1), ("rxHeightM", h2)):
        if not (_MIN_H_M <= value <= _MAX_H_M):
            clamped = min(_MAX_H_M, max(_MIN_H_M, value))
            warnings.append(
                f"Высота {name} = {value:g} м вне диапазона P.528-5 (1.5–20000 м) — зажата до {clamped:g} м"
            )
    h1 = min(_MAX_H_M, max(_MIN_H_M, h1))
    h2 = min(_MAX_H_M, max(_MIN_H_M, h2))
    if h1 > h2:
        h1, h2 = h2, h1
        warnings.append("Терминалы переставлены: модель требует h1 ≤ h2 (результат симметричен)")
    if h1 == h2:
        # VENDORED WORKAROUND (2026-11-14): вырожденный случай h1 == h2
        # (горизонтальный луч в одном слое) даёт a__km = 0 → log10(0) внутри
        # порта (los.py Eqn 13-5). Модель непрерывна по высотам — терминалы
        # разводятся на 0.1 м: совпадение с таблицами ITU подтверждено
        # (h=1000/1000, 300 км, 100 МГц: 142.63 vs таблица 142.6). Границы
        # диапазона соблюдаются: уменьшаем h1, если позволяет нижняя граница.
        h1 = h1 - 0.1 if h1 - 0.1 >= _MIN_H_M else h1
        if h1 == h2:
            h2 = h2 + 0.1  # случай h1 == h2 == 1.5: сверху запас всегда есть

    # Поляризация (T_pol: 1 вертикальная, 0 горизонтальная)
    pol = inp.get("polarization", "vertical")
    if pol == "circular":
        t_pol = POLARIZATION__VERTICAL
        warnings.append("Круговая поляризация аппроксимирована вертикальной (P.528-5 различает V/H)")
    else:
        t_pol = _POL_MAP.get(pol, POLARIZATION__VERTICAL)

    if _has_percent_out_of_range(inp):
        warnings.append(
            "Проценты времени вне диапазона P.528-5 (1–99 % «не превышаются») — зажаты"
        )

    # Явная валидация входов порта: при отказе p528() молча возвращает
    # A = 0 / mode = NOT_SET — превращаем это в ошибку, а не в нулевые потери
    code = validate_inputs(d__km=d_km, h_1__meter=h1, h_2__meter=h2,
                           f__mhz=float(inp["frequencyMhz"]), T_pol=t_pol, p=50.0)
    if code != SUCCESS:
        raise ValueError(f"p528_port: входы вне диапазона модели (код {code})")

    def _loss(client_p: float) -> tuple[float, int]:
        """Потери для клиентского «превышаются p %» → порт «не превышаются 100−p %»."""
        p_528 = _port_percent(client_p)
        r = p528(
            d__km=d_km,
            h_1__meter=h1,
            h_2__meter=h2,
            f__mhz=float(inp["frequencyMhz"]),
            T_pol=t_pol,
            p=p_528,
        )
        return float(r.A__db), int(r.propagation_mode)

    median, mode = _loss(50.0)

    by_time = []
    for tp in inp.get("timePercents") or [50]:
        loss, tp_mode = _loss(tp)
        by_time.append({"percent": float(tp), "lossDb": loss})

    # Разбивка: FSPL (A_fs) + избыточные сверх FSPL (газы P.676 и механизмы уже внутри A)
    fs_result = p528(
        d__km=d_km, h_1__meter=h1, h_2__meter=h2,
        f__mhz=float(inp["frequencyMhz"]), T_pol=t_pol, p=50.0,
    )
    a_fs = float(fs_result.A_fs__db)
    diffraction = max(0.0, median - a_fs)

    mode_name = _MODE_NAMES.get(mode, f"режим {mode}")
    if mode != 1:
        warnings.append(f"Доминирующий механизм: {mode_name}")

    return {
        "model": "p528",
        "medianLossDb": median,
        "byTimePercent": by_time,
        "breakdown": {
            "freeSpaceDb": a_fs,
            "diffractionDb": diffraction,
        },
        "engineUsed": engine_note,
        "warnings": warnings,
    }

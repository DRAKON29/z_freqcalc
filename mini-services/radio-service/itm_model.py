"""
Адаптер Longley-Rice ITM (роадмап 2.1): CalculationInput (dict) → PropagationResult (dict).

Модель 'itm' — независимая от P.2001 NLOS-модель по неровному рельефу.
Реализация — вендоренный порт ITM v1.2.2 (itm_port.py, см. шапку файла).

Конвенции (зафиксированы в README):
  • climate = 5 (континентальный умеренный) — категории ITM 1–7 не маппятся 1:1
    на климатические зоны дождя ITU;
  • N0 = 301 N-единиц (поверхностная рефракция, уровень моря) — константа:
    DN_Median из карт P.2001 — это градиент ΔN, не поверхностная рефракция;
  • epsilon/sigma — из input (P.527, дефолт 15 / 0.005);
  • FSPL в breakdown — по длине профиля (ground distance), как внутри ITM;
    итоговые потери = FSPL + избыточное затухание ITM (Eq 5.1/5.2 TN101);
  • квантили времени: zT = Φ⁻¹(p/100) — кривая потерь убывает с ростом p,
    как принято в ITU («потери превышаются p % времени»).
"""
import math
import threading
from statistics import NormalDist

import numpy as np

import itm_port as itm

# Порт держит состояние в глобальных словарях (prop/propa/propv) — не потокобезопасно:
# uvicorn исполняет sync-эндпоинты в тредпуле, расчёт сериализуем локом.
_ITM_LOCK = threading.Lock()

# Поверхностная рефракция уровня моря, N-единиц (типовое значение континентального умеренного климата)
N0_DEFAULT = 301
# Категория климата ITM: 5 = continental temperate
CLIMATE_CONTINENTAL_TEMPERATE = 5
# Верхняя граница процентов времени для квантилей (края хвостов ITM)
_MIN_P, _MAX_P = 0.001, 99.999

_MODE_WARNING = "Конвенции ITM: climate = 5 (континентальный умеренный), N0 = 301 N-ед., epsR/sigma — из ввода (P.527)"


def _z_for_percent(p_percent: float) -> float:
    """Стандартное отклонение zT для «потери превышаются p % времени» (qT = p/100, zT = Φ⁻¹(p/100))."""
    p = min(_MAX_P, max(_MIN_P, p_percent)) / 100.0
    return NormalDist().inv_cdf(p)


def _mode_warning(dist_m: float) -> str:
    """Доминирующий механизм по геометрии ITM: LOS / дифракция / тропосферное рассеяние."""
    try:
        dlsa = float(itm.propa["dlsa"])  # сумма расстояний до гладких горизонтов
        dx = float(itm.propa["dx"])      # дистанция перехода к рассеянию
        if dist_m < dlsa:
            mech = "прямая видимость (LOS)"
        elif dist_m < dx:
            mech = "дифракция на препятствиях"
        else:
            mech = "тропосферное рассеяние"
        return f"ITM: доминирующий механизм на трассе — {mech}"
    except Exception:
        return "ITM: механизм оценки недоступен"


def itm_calculate(inp: dict, engine_note: str = "py: Longley-Rice ITM v1.2.2 (медиана 50 % времени)") -> dict:
    """Расчёт потерь по ITM. Возвращает PropagationResult-подобный dict."""
    freq = float(inp["frequencyMhz"])
    path = inp.get("path") or {}
    profile = path.get("profile") or []
    if len(profile) < 3:
        raise ValueError("ITM: профиль трассы должен содержать минимум 3 точки")
    d_m = [float(p["d"]) for p in profile]
    e_m = [float(p["elev"]) for p in profile]
    dist = d_m[-1]
    if dist <= 0:
        raise ValueError("ITM: нулевая длина трассы")

    pol = "h" if inp.get("polarization") == "horizontal" else "v"
    eps_r = float(inp.get("epsilon", 15) or 15)
    sigma = float(inp.get("sigma", 0.005) or 0.005)
    tx_h = e_m[0] + float(inp.get("txHeightM", 0) or 0)
    rx_h = e_m[-1] + float(inp.get("rxHeightM", 0) or 0)
    percents = inp.get("timePercents") or [50, 90, 99, 99.9]

    rng = np.array(d_m)
    pfl = np.array(e_m)
    by_time: list[dict] = []

    with _ITM_LOCK:
        itm.dictionaries()
        itm.lrPrep(freq, e_m[0], N0_DEFAULT, pol, eps_r, sigma)
        itm.prop["hg"] = np.array([tx_h, rx_h])
        itm.lrProfile(rng, pfl, climate=CLIMATE_CONTINENTAL_TEMPERATE, mdVar=4)
        fspl = float(itm.freespace_dB(freq * 1e6, dist))
        mode_warning = _mode_warning(dist)
        for p in percents:
            a, _sgc = itm.aVar(_z_for_percent(float(p)), 0, 0)
            # Eq 5.2 допускает небольшое отрицательное избыточное затухание на LOS
            # (двулучевая интерференция может усиливать поле) — сохраняем как есть
            a = float(a)
            by_time.append({"percent": float(p), "lossDb": fspl + a, "excessDb": a})

    p50 = next((t for t in by_time if abs(t["percent"] - 50) < 1e-9), by_time[0])
    median_loss = p50["lossDb"]

    warnings = [
        _MODE_WARNING,
        mode_warning,
        "ITM: реализации в TS/wasm-движке нет — при недоступности python-сервиса выполнится локальный расчёт P.2001-lite с предупреждением",
    ]

    return {
        "model": "itm",
        "medianLossDb": median_loss,
        "byTimePercent": [{"percent": t["percent"], "lossDb": t["lossDb"]} for t in by_time],
        "breakdown": {
            "freeSpaceDb": fspl,
            "diffractionDb": max(0.0, median_loss - fspl),
        },
        "engineUsed": engine_note,
        "warnings": warnings,
    }

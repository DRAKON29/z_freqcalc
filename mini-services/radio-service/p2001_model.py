# -*- coding: utf-8 -*-
"""
Адаптер полной P.2001-6 (роадмап 2.6): CalculationInput (dict) → PropagationResult (dict).

Реализация — вендоренный порт Py2001 (p2001_port/, перевод эталонной
MATLAB/Octave реализации ITU-R WP 3M, см. шапку P2001.py). Требует
P2001.npz из 14 таблиц ITU-R P.2001-6 (env RADIO_P2001_NPZ, задаётся
main.py; собирается scripts/build_p2001_npz.py). Без npz импорт p2001_port
падает и main.py уходит в P.2001-lite — это ожидаемое поведение.

Конвенции (зафиксированы в README):
  • координаты Tx/Rx — path.points[0]/[1] (точки A/B карты); без координат
    расчёт невозможен (карты ITU сэмплируются по lat/lon) — исключение
    ValueError, main.py уходит в lite с предупреждением;
  • z-зоны по точкам профиля (1 = море, 3 = прибрежная суша, 4 = внутренняя
    суша): клиент классификацию суша/море не передаёт → по умолчанию 4
    (внутренняя суша) на всю трассу; переопределение — input["zones"]
    (массив длиной профиля);
  • усиления антенн Grx/Gtx = 0 дБи: bt_loss возвращает базовые потери
    передачи Lb, усиления применяются на клиенте в бюджете (как в
    /api/interference);
  • clutter (здания/растительность) P.2001-6 не моделирует — профиль
    передаётся по рельефу; при clutter в input — предупреждение;
  • ручная атмосфера (rainRateMmH, gases, vegetation) игнорируется: P.2001-6
    берёт дождь (P.837), газы (P.676) и водяной пар из цифровых карт по
    координатам трассы; в budget эти слагаемые не добавляются (None) —
    они уже внутри Lb;
  • разбивка механизмов: freeSpaceDb — FSPL по P.2001 §3.11 (tl_free_space),
    diffractionDb — суммарные избыточные потери сверх FSPL при p = 50 %
    (механизмы P.2001-6 раздельно через публичный API bt_loss недоступны);
  • поляризация: vertical → FlagVP = 1, horizontal → 0, circular → 1
    с предупреждением (P.2001-6 различает V/H);
  • квантили времени: timePercents клиента — «потери ПРЕВЫШАЮТСЯ p % времени»
    (как в UI и P.452/P.530), Tpc bt_loss — «потери НЕ превышаются Tpc %»
    → Tpc = 100 − p (медиана p = 50 % ↔ Tpc = 50 %);
  • профиль: d[0] = 0 и > 10 точек — требования bt_loss; при их нарушении
    (трассы короче ~350 м) main.py уходит в P.2001-lite с предупреждением.
"""
import numpy as np

from p2001_port.P2001 import bt_loss, tl_free_space

# Диапазон процентов времени bt_loss (края хвостов P.2001-6)
_MIN_P, _MAX_P = 0.001, 99.999

# Модель наиболее точна на трассах 3–1000 км (docstring P2001.bt_loss)
_BEST_MIN_KM, _BEST_MAX_KM = 3.0, 1000.0

# FlagVP: 1 = вертикальная, 0 = горизонтальная (P.2001-6 §2.2.1)
_POL_MAP = {"vertical": 1, "horizontal": 0}


def calculate_full(inp: dict, engine_note: str = "py: P.2001-6 (Py2001)") -> dict:
    """Полная P.2001-6 по профилю трассы и координатам концов.

    Бросает ValueError, если в input нет координат концов трассы
    (path.points) или профиль не содержит двух различных точек.
    """
    ghz = float(inp["frequencyMhz"]) / 1000.0
    path = inp["path"]
    profile = path["profile"]
    warnings: list[str] = []

    # Координаты концов трассы: Tx = точка A, Rx = точка B
    points = path.get("points") or []
    if len(points) < 2:
        raise ValueError(
            "path.points: требуются координаты точек A/B — карты ITU P.2001-6 "
            "сэмплируются по lat/lon трассы"
        )
    phite, phitn = float(points[0]["lon"]), float(points[0]["lat"])
    phire, phirn = float(points[1]["lon"]), float(points[1]["lat"])

    # Профиль по рельефу (клиентская трасса не переводится)
    d = np.asarray([float(p["d"]) for p in profile], dtype=float) / 1000.0
    h = np.asarray([float(p["elev"]) for p in profile], dtype=float)
    keep = np.concatenate(([True], np.diff(d) > 0))
    d, h = d[keep], h[keep]
    if len(d) < 2:
        raise ValueError("Профиль трассы должен содержать минимум 2 различные точки")
    d_km_total = float(d[-1])

    if any(float(p.get("clutter", 0) or 0) > 0 for p in profile):
        warnings.append(
            "Clutter (здания/растительность) не входит в модель P.2001-6 — профиль по рельефу"
        )

    # Зоны 1/3/4 по точкам профиля (до фильтрации — той же длины, что профиль)
    zones_in = inp.get("zones")
    if isinstance(zones_in, list) and len(zones_in) == len(profile):
        z = np.asarray([int(float(v)) for v in zones_in], dtype=int)[keep]
    else:
        z = np.full(len(d), 4, dtype=int)
        if zones_in is not None:
            warnings.append(
                "zones не соответствует длине профиля — использована зона 4 (внутренняя суша)"
            )

    # Поляризация (FlagVP)
    pol = inp.get("polarization", "vertical")
    if pol == "circular":
        flag_vp = 1
        warnings.append("Круговая поляризация аппроксимирована вертикальной (P.2001-6 различает V/H)")
    else:
        flag_vp = _POL_MAP.get(pol, 1)

    htg = float(inp.get("txHeightM", 10))
    hrg = float(inp.get("rxHeightM", 10))

    def _lb_from_client_p(p_percent: float) -> float:
        """Клиент: «потери превышаются p % времени» → Tpc bt_loss = 100 − p
        («не превышаются Tpc %»). Медиана p = 50 % ↔ Tpc = 50 %."""
        p = min(_MAX_P, max(_MIN_P, float(p_percent)))
        return float(
            bt_loss(d, h, z, ghz, 100.0 - p, phire, phirn, phite, phitn, hrg, htg, 0.0, 0.0, flag_vp)
        )

    median = _lb_from_client_p(50.0)

    by_time = []
    for tp in inp.get("timePercents") or [50]:
        by_time.append({"percent": float(tp), "lossDb": _lb_from_client_p(tp)})

    # Разбивка: FSPL (P.2001 §3.11) + суммарные избыточные потери сверх FSPL
    lbfs = float(tl_free_space(ghz, d_km_total))
    diffraction = max(0.0, median - lbfs)

    if not (_BEST_MIN_KM <= d_km_total <= _BEST_MAX_KM):
        warnings.append(
            f"Длина трассы {d_km_total:g} км вне диапазона наибольшей точности "
            f"P.2001-6 ({_BEST_MIN_KM:g}–{_BEST_MAX_KM:g} км)"
        )

    return {
        "model": "p2001",
        "medianLossDb": median,
        "byTimePercent": by_time,
        "breakdown": {
            "freeSpaceDb": lbfs,
            "diffractionDb": diffraction,
        },
        "engineUsed": engine_note,
        "warnings": warnings,
    }

"""
Зеркало TS-модуля src/lib/radio/availability.ts — availability-отчёт по ITU-R P.530-19.

Отчёт считается на клиенте поверх бюджета линии (для любого движка — http/wasm/local);
этот модуль содержит те же формулы для проверки (pytest) и переиспользования на
python-стороне:
  • многолучёвость (§2.3.2): p = p0·10^(−FM/10);
  • дождь (§2.4.1): A(0.01 %) по P.838 с path reduction factor
    (d0 = 35·e^(−0.015·R0.01)), интерполяция A(p) = A0.01·0.12·p^(−(0.546+0.043·lg p));
  • требуемые запасы для целевых доступностей (численное решение).
"""
import math

from p2001_lite import CLIMATE_FACTOR, rain_specific_attenuation

HOURS_PER_YEAR = 8760

# Зоны дождя ITU-R P.837-3 (Table 1): R(0.01 %), мм/ч — оценка по умолчанию
RAIN_ZONE_R001_MMH = {"A": 8, "B": 12, "C": 15, "D": 19, "E": 22, "F": 28, "G": 30,
                      "H": 32, "J": 35, "K": 42, "L": 45, "M": 48, "N": 53, "P": 75, "Q": 96}

# Поправка зоны TropoClim (аппроксимация Annex E P.2001-6), как в itu-env.ts:
# полярные 0.7, умеренные 1.0, тропические 1.3
TROPO_ZONE_MULT = {z: (0.7 if z <= 4 else 1.0 if z <= 9 else 1.3) for z in range(1, 15)}


def tropo_zone_multiplier(zone):
    if zone is None:
        return 1.0
    return TROPO_ZONE_MULT.get(zone, 1.0)


def multipath_occurrence_factor(climate_zone: str, distance_km: float, tropo_zone=None) -> float:
    """Фактор возникновения многолучёвости p0, % времени: cf·z·(d/50)³·0.05."""
    cf = CLIMATE_FACTOR.get(climate_zone, 0.8)
    z_mult = tropo_zone_multiplier(tropo_zone)
    return cf * z_mult * (distance_km / 50.0) ** 3 * 0.05


def multipath_outage_percent(p0_percent: float, fade_margin_db: float) -> float:
    """Доля времени превышения замирания FM из-за многолучёвости, %: p0·10^(−FM/10)."""
    if not p0_percent > 0:
        return 0.0
    return min(100.0, max(0.0, p0_percent * 10.0 ** (-fade_margin_db / 10.0)))


def rain_path_reduction_d0_km(rain_rate_001_mm_h: float) -> float:
    """Параметр эффективной длины d0, км: 35·e^(−0.015·R0.01), clamp [4, 35]."""
    if not rain_rate_001_mm_h > 0:
        return 35.0
    return min(35.0, max(4.0, 35.0 * math.exp(-0.015 * rain_rate_001_mm_h)))


def rain_attenuation_001_db(d_m: float, r001_mm_h: float, f_mhz: float, pol: str) -> float:
    """Затухание в дожде за 0.01 % времени: γR(R0.01)·d/(1 + d/d0) (P.838 + P.530)."""
    if not r001_mm_h > 0:
        return 0.0
    gamma = rain_specific_attenuation(r001_mm_h, f_mhz, pol)
    d_km = d_m / 1000.0
    d0 = rain_path_reduction_d0_km(r001_mm_h)
    return gamma * (d_km / (1.0 + d_km / max(1.0, d0)))


def rain_attenuation_at_percent_db(a001_db: float, p_percent: float) -> float:
    """Затухание, превышаемое p % времени: A0.01·0.12·p^(−(0.546+0.043·lg p)), p ∈ [0.001, 1]."""
    p = min(1.0, max(0.001, p_percent))
    exponent = 0.546 + 0.043 * math.log10(p)
    return a001_db * 0.12 * p ** (-exponent)


def solve_rain_outage_percent(a001_db: float, fade_margin_db: float):
    """Процент времени, в который затухание в дожде превышает FM (None — не превышает)."""
    if not a001_db > 0:
        return None
    if fade_margin_db > rain_attenuation_at_percent_db(a001_db, 0.001):
        return None
    if fade_margin_db <= rain_attenuation_at_percent_db(a001_db, 1.0):
        return 1.0
    lo, hi = 0.001, 1.0
    for _ in range(60):
        mid = math.sqrt(lo * hi)
        if rain_attenuation_at_percent_db(a001_db, mid) >= fade_margin_db:
            lo = mid
        else:
            hi = mid
    return lo


def _rain_rate_001_of(inp: dict):
    """R(0.01 %): карты ITU → ввод пользователя → зона дождя (P.837-3)."""
    atmosphere = inp.get("atmosphere", {})
    env = inp.get("environment") or {}
    if atmosphere.get("rainSource") == "itu" and env.get("rainRate001") is not None:
        return float(env["rainRate001"]), "itu"
    user = atmosphere.get("rainRateMmH")
    if user is not None and user > 0:
        return float(user), "user"
    zone = RAIN_ZONE_R001_MMH.get(inp.get("climateZone", "K"))
    if zone is not None:
        return float(zone), "zone"
    return None, None


def required_margin_for_availability(p0_percent: float, a001_db, availability_percent: float) -> float:
    """Минимальный запас FM: p0·10^(−FM/10) + p_дождь(FM) ≤ 100 − target (бисекция)."""
    p_out = 100.0 - availability_percent

    def outage(fm: float) -> float:
        mp = multipath_outage_percent(p0_percent, fm)
        rain = (solve_rain_outage_percent(a001_db, fm) or 0.0) if a001_db is not None else 0.0
        return mp + rain

    if outage(0.0) <= p_out:
        return 0.0
    lo, hi = 0.0, 60.0
    for _ in range(60):
        mid = (lo + hi) / 2.0
        if outage(mid) > p_out:
            lo = mid
        else:
            hi = mid
    return hi


def availability_report(inp: dict, margin_db: float) -> dict:
    """Полный отчёт: недоступность (многолучёвость/дождь/итого) + цели доступности."""
    d_m = float(inp.get("path", {}).get("distanceM", 0.0))
    d_km = d_m / 1000.0
    env = inp.get("environment") or {}
    p0 = multipath_occurrence_factor(inp.get("climateZone", "K"), d_km, env.get("tropoZone"))
    r001, rain_source = _rain_rate_001_of(inp)
    a001 = None
    if r001 is not None and r001 > 0:
        a001 = rain_attenuation_001_db(d_m, r001, float(inp.get("frequencyMhz", 0)), inp.get("polarization", "vertical"))

    targets = []
    for target in (99.5, 99.9, 99.99):
        req = required_margin_for_availability(p0, a001, target)
        targets.append({"availabilityPercent": target, "requiredMarginDb": req, "met": margin_db >= req})

    if margin_db <= 0:
        outage = {"multipathPercent": 100.0, "rainPercent": 0.0, "totalPercent": 100.0,
                  "totalHoursPerYear": float(HOURS_PER_YEAR), "availabilityPercent": 0.0}
    else:
        mp = multipath_outage_percent(p0, margin_db)
        rain = (solve_rain_outage_percent(a001, margin_db) or 0.0) if a001 is not None else 0.0
        total = min(100.0, mp + rain)
        outage = {"multipathPercent": mp, "rainPercent": rain, "totalPercent": total,
                  "totalHoursPerYear": total / 100.0 * HOURS_PER_YEAR, "availabilityPercent": 100.0 - total}

    return {
        "marginDb": margin_db,
        "multipathP0Percent": p0,
        "rainRate001": r001,
        "rainSource": rain_source,
        "rainAttenuation001Db": a001,
        "outage": outage,
        "targets": targets,
    }

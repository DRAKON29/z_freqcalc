/**
 * Availability-отчёт по ITU-R P.530-19.
 *
 *  • Многолучёвость (clear-air), §2.3.2 (Vigants–Barnett в форме P.530):
 *    доля времени превышения глубины замирания A: p = p0·10^(−A/10), где p0 —
 *    фактор возникновения многолучёвости (климатическая зона, длина трассы,
 *    поправка TropoClim — та же модель, что в кривой замираний P.2001-lite).
 *  • Дождь, §2.4.1: затухание при 0.01 % через P.838 + path reduction factor
 *    (d0 = 35·e^(−0.015·R0.01)); для других процентов времени — интерполяция
 *    A(p) = A0.01·0.12·p^(−(0.546+0.043·lg p)), p ∈ [0.001, 1] %.
 *
 * Отчёт — чистая функция поверх CalculationInput + LinkBudget, поэтому работает
 * с любым движком (http/wasm/local): движок отдаёт потери и бюджет, отчёт
 * считается поверх них на клиенте.
 */
import { rainLossDb, rainPathReductionD0Km } from './atmosphere'
import { RAIN_ZONE_R001_MMH } from './constants'
import { multipathOccurrenceFactor } from './p2001lite'
import type { AvailabilityReport, AvailabilityTarget, BudgetRow, CalculationInput, LinkBudget } from './types'

/** Часов в году (среднее). */
export const HOURS_PER_YEAR = 8760

/**
 * Доля времени превышения замирания глубиной fadeMarginDb из-за многолучёвости, %.
 * p = p0·10^(−FM/10), ограничено [0, 100].
 */
export function multipathOutagePercent(p0Percent: number, fadeMarginDb: number): number {
  if (!(p0Percent > 0)) return 0
  const p = p0Percent * Math.pow(10, -fadeMarginDb / 10)
  return Math.min(100, Math.max(0, p))
}

/**
 * Затухание в дожде, превышаемое p % времени, дБ (P.530-19 §2.4.1):
 * A(p) = A0.01·0.12·p^(−(0.546+0.043·lg p)); p ограничивается [0.001, 1] %.
 */
export function rainAttenuationAtPercentDb(a001Db: number, pPercent: number): number {
  const p = Math.min(1, Math.max(0.001, pPercent))
  const exponent = 0.546 + 0.043 * Math.log10(p)
  return a001Db * 0.12 * Math.pow(p, -exponent)
}

/**
 * Обращение интерполяции: процент времени, в который затухание в дожде
 * превышает fadeMarginDb. Возвращает null, если дождь вообще не достигает
 * этого запаса (FM > A(0.001) — outage пренебрежимо мала).
 */
export function solveRainOutagePercent(a001Db: number, fadeMarginDb: number): number | null {
  if (!(a001Db > 0)) return null
  // A(p) монотонно убывает по p: A(0.001) — максимум, A(1) — минимум
  if (fadeMarginDb > rainAttenuationAtPercentDb(a001Db, 0.001)) return null
  if (fadeMarginDb <= rainAttenuationAtPercentDb(a001Db, 1)) return 1
  let lo = 0.001
  let hi = 1
  for (let i = 0; i < 60; i++) {
    const mid = Math.sqrt(lo * hi) // геометрическое среднее — сетка логарифмическая
    if (rainAttenuationAtPercentDb(a001Db, mid) >= fadeMarginDb) lo = mid
    else hi = mid
  }
  return lo
}

/** Источник и величина R(0.01 %): карты ITU → ввод пользователя → зона дождя (P.837-3). */
function rainRate001Of(input: CalculationInput): { rate: number | null; source: 'itu' | 'user' | 'zone' | null } {
  if (input.atmosphere.rainSource === 'itu' && input.environment?.rainRate001 !== undefined) {
    return { rate: input.environment.rainRate001, source: 'itu' }
  }
  const user = input.atmosphere.rainRateMmH
  if (user !== undefined && user > 0) return { rate: user, source: 'user' }
  const zone = RAIN_ZONE_R001_MMH[input.climateZone]
  if (zone !== undefined) return { rate: zone, source: 'zone' }
  return { rate: null, source: null }
}

/** Требуемый запас для целевой доступности: решение p0·10^(−FM/10) + p_дождь(FM) = 100 − target. */
export function requiredMarginForAvailability(
  p0Percent: number,
  a001Db: number | null,
  availabilityPercent: number,
): number {
  const pOut = 100 - availabilityPercent // 0.5 / 0.1 / 0.01
  const outage = (fm: number): number => {
    const mp = multipathOutagePercent(p0Percent, fm)
    const rain = a001Db !== null ? (solveRainOutagePercent(a001Db, fm) ?? 0) : 0
    return mp + rain
  }
  // При FM = 0 outage максимальна; ищем минимальный FM, при котором outage ≤ pOut
  if (outage(0) <= pOut) return 0
  let lo = 0
  let hi = 60 // 60 дБ запаса хватает для любых реалистичных трасс приложения
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (outage(mid) > pOut) lo = mid
    else hi = mid
  }
  return hi
}

/**
 * Availability-отчёт для линии. Возвращает null, если посчитать нечего
 * (нет бюджета). Дождь учитывается при наличии R(0.01 %) — из цифровых
 * продуктов ITU (P.837-6) или из ввода пользователя.
 */
export function computeAvailabilityReport(input: CalculationInput, budget: LinkBudget): AvailabilityReport | null {
  const marginDb = budget.linkMarginDb
  if (!Number.isFinite(marginDb)) return null

  const dKm = input.path.distanceM / 1000
  const p0 = multipathOccurrenceFactor(input.climateZone, dKm, input.environment?.tropoZone)

  const { rate: r001, source: rainSource } = rainRate001Of(input)
  let a001: number | null = null
  if (r001 !== null && r001 > 0) {
    const d0 = rainPathReductionD0Km(r001)
    a001 = rainLossDb(input.path.distanceM, r001, input.frequencyMhz, input.polarization, { d0Km: d0 })
  }

  // Недоступность при фактическом запасе: замирание глубиной FM не превышается
  // (100 − p) % времени. При FM ≤ 0 линия не обеспечивается даже в медиане.
  if (marginDb <= 0) {
    return {
      marginDb,
      multipathP0Percent: p0,
      rainRate001: r001,
      rainSource,
      rainAttenuation001Db: a001,
      outage: { multipathPercent: 100, rainPercent: 0, totalPercent: 100, totalHoursPerYear: HOURS_PER_YEAR, availabilityPercent: 0 },
      targets: buildTargets(p0, a001, marginDb),
    }
  }

  const multipathPercent = multipathOutagePercent(p0, marginDb)
  const rainPercent = a001 !== null ? (solveRainOutagePercent(a001, marginDb) ?? 0) : 0
  const totalPercent = Math.min(100, multipathPercent + rainPercent)
  return {
    marginDb,
    multipathP0Percent: p0,
    rainRate001: r001,
    rainSource,
    rainAttenuation001Db: a001,
    outage: {
      multipathPercent,
      rainPercent,
      totalPercent,
      totalHoursPerYear: (totalPercent / 100) * HOURS_PER_YEAR,
      availabilityPercent: 100 - totalPercent,
    },
    targets: buildTargets(p0, a001, marginDb),
  }
}

function buildTargets(p0: number, a001: number | null, actualMarginDb: number): AvailabilityTarget[] {
  return [99.5, 99.9, 99.99].map((availabilityPercent) => {
    const requiredMarginDb = requiredMarginForAvailability(p0, a001, availabilityPercent)
    return { availabilityPercent, requiredMarginDb, met: actualMarginDb >= requiredMarginDb }
  })
}

/** Строка бюджета с прогнозом недоступности (попадает в историю и PDF через budget.expense). */
export function availabilityExpenseRow(report: AvailabilityReport): BudgetRow {
  return {
    label: 'Прогноз недоступности (P.530)',
    value: +report.outage.totalHoursPerYear.toFixed(2),
    unit: 'ч/год',
    sign: '=',
  }
}

/** Короткая текстовая сводка для компактного вывода (обратная линия и т.п.). */
export function availabilitySummary(report: AvailabilityReport): string {
  const hours = report.outage.totalHoursPerYear
  const hoursText = hours >= 1 ? `${hours.toFixed(1)} ч/год` : `${(hours * 60).toFixed(0)} мин/год`
  return `доступность ${report.outage.availabilityPercent.toFixed(3)} % (недоступность ~${hoursText})`
}

/**
 * Тесты availability-отчёта (ITU-R P.530-19): многолучёвость (§2.3.2),
 * дождь с path reduction factor (§2.4.1), требуемые запасы для целей доступности.
 * Контрольные числа выведены вручную из формул (см. комментарии).
 */
import { describe, it, expect } from 'bun:test'
import {
  multipathOutagePercent,
  rainAttenuationAtPercentDb,
  solveRainOutagePercent,
  requiredMarginForAvailability,
  computeAvailabilityReport,
  availabilityExpenseRow,
  HOURS_PER_YEAR,
} from '../src/lib/radio/availability'
import { rainPathReductionD0Km, rainSpecificAttenuationDbKm, rainLossDb } from '../src/lib/radio/atmosphere'
import { multipathOccurrenceFactor } from '../src/lib/radio/p2001lite'
import type { AvailabilityReport, CalculationInput, LinkBudget } from '../src/lib/radio/types'

// Эталонная трасса: 50 км, зона K (cf = 1.1), 6000 МГц, R0.01 = 30 мм/ч (ввод пользователя)
const input: CalculationInput = {
  frequencyMhz: 6000,
  polarization: 'vertical',
  path: {
    points: [{ lat: 55.75, lon: 37.62 }, { lat: 55.38, lon: 37.62 }],
    distanceM: 50000,
    azimuthDeg: 180,
    profile: [
      { d: 0, elev: 150, clutter: 0, total: 150 },
      { d: 25000, elev: 160, clutter: 0, total: 160 },
      { d: 50000, elev: 145, clutter: 0, total: 145 },
    ],
    demStepM: 30,
    demSource: 'test',
  },
  txHeightM: 30,
  rxHeightM: 10,
  timePercents: [50, 90, 99, 99.9],
  kFactor: 4 / 3,
  atmosphere: { gases: false, vegetation: false, rainRateMmH: 30, rainSource: 'user' },
  epsilon: 15,
  sigma: 0.005,
  climateZone: 'K',
}

function budgetWith(marginDb: number): LinkBudget {
  return {
    eirpDbm: 40,
    pathLossDb: 150,
    prxDbm: -110,
    noisePowerDbm: -111,
    ktbDbm: -113.98,
    nfDb: 3,
    snrDb: 1,
    ebN0ActualDb: 4,
    ebN0RequiredDb: 9.6,
    linkMarginDb: marginDb,
    income: [],
    expense: [],
  }
}

describe('Availability: фактор многолучёвости p0', () => {
  it('p0 = cf·(d/50)³·0.05 — совпадает с прежней inline-формулой кривой замираний', () => {
    // зона K: cf = 1.1, d = 50 км → p0 = 0.055 %
    expect(multipathOccurrenceFactor('K', 50)).toBeCloseTo(0.055, 10)
    // d = 25 км → куб расстояния: 0.055/8
    expect(multipathOccurrenceFactor('K', 25)).toBeCloseTo(0.055 / 8, 10)
  })

  it('многолучевая недоступность p = p0·10^(−FM/10)', () => {
    // FM = 20 дБ → 0.055·10⁻² = 5.5e-4 %
    expect(multipathOutagePercent(0.055, 20)).toBeCloseTo(5.5e-4, 12)
    expect(multipathOutagePercent(0, 20)).toBe(0)
  })
})

describe('Availability: дождь (P.530-19 §2.4.1)', () => {
  it('path reduction factor: d0 = 35·e^(−0.015·R0.01)', () => {
    // R0.01 = 30 → 35·e^(−0.45) = 22.2714 км
    expect(rainPathReductionD0Km(30)).toBeCloseTo(35 * Math.exp(-0.45), 6)
    expect(rainPathReductionD0Km(0)).toBe(35)
    expect(rainPathReductionD0Km(200)).toBe(4) // clamp снизу
  })

  it('интерполяция A(p): A(1) = 0.12·A001, A(0.01) ≈ A001', () => {
    const a001 = 10
    expect(rainAttenuationAtPercentDb(a001, 1)).toBeCloseTo(1.2, 9)
    // 0.12·0.01^−0.46 = 0.9981 — интерполяция проходит через контрольную точку 0.01 %
    expect(rainAttenuationAtPercentDb(a001, 0.01)).toBeCloseTo(9.981, 2)
    // A(0.1) = 0.12·10^0.503 = 0.3821·A001
    expect(rainAttenuationAtPercentDb(a001, 0.1)).toBeCloseTo(3.821, 2)
  })

  it('обращение A(p): p = 0.0247 % при A001(γR=0.0046·15.41 км) и FM = 0.05 дБ', () => {
    // γR(30 мм/ч, 6000 МГц, V) = 0.0046 дБ/км; d0(30) = 22.271 км → deff = 15.408 км
    const a001 = rainLossDb(50000, 30, 6000, 'vertical', { d0Km: rainPathReductionD0Km(30) })
    expect(a001).toBeCloseTo(0.0046 * (50 / (1 + 50 / (35 * Math.exp(-0.45)))), 2)
    // Решение 0.043x² + 0.546x + lg(FM/(0.12·A001)) = 0, x = lg p → p ≈ 0.0241 %
    const p = solveRainOutagePercent(a001, 0.05)
    expect(p).not.toBeNull()
    expect(p!).toBeCloseTo(0.0241, 3)
    // FM глубже достижимого → дождь не ограничивает (null)
    expect(solveRainOutagePercent(a001, 20)).toBeNull()
  })
})

describe('Availability: требуемые запасы для целевых доступностей', () => {
  it('без дождя: FM = 10·lg(p0/p_out)', () => {
    // 99.99 % → p_out = 0.01 %: 10lg(0.055/0.01) = 10lg(5.5) = 7.40 дБ
    expect(requiredMarginForAvailability(0.055, null, 99.99)).toBeCloseTo(10 * Math.log10(5.5), 3)
    // 99.9 % → p_out = 0.1 % > p0 = 0.055: запас не требуется
    expect(requiredMarginForAvailability(0.055, null, 99.9)).toBe(0)
  })

  it('с дождём: цель 99.99 % требует не меньше, чем без дождя', () => {
    const a001 = rainLossDb(50000, 30, 6000, 'vertical', { d0Km: rainPathReductionD0Km(30) })
    expect(requiredMarginForAvailability(0.055, a001, 99.99)).toBeGreaterThanOrEqual(
      requiredMarginForAvailability(0.055, null, 99.99),
    )
  })
})

describe('Availability: полный отчёт', () => {
  it('эталонный случай: 50 км, зона K, FM = 20 дБ, дождь 30 мм/ч (6 ГГц — вклад дождя пренебрежим)', () => {
    const report = computeAvailabilityReport(input, budgetWith(20))
    expect(report).not.toBeNull()
    const r = report!
    expect(r.marginDb).toBe(20)
    expect(r.multipathP0Percent).toBeCloseTo(0.055, 10)
    expect(r.rainSource).toBe('user')
    expect(r.rainRate001).toBe(30)
    // многолучёвость: 5.5e-4 % → 0.0482 ч/год
    expect(r.outage.multipathPercent).toBeCloseTo(5.5e-4, 12)
    expect(r.outage.rainPercent).toBe(0)
    expect(r.outage.totalHoursPerYear).toBeCloseTo((5.5e-4 / 100) * HOURS_PER_YEAR, 4)
    expect(r.outage.availabilityPercent).toBeCloseTo(100 - 5.5e-4, 10)
    // цели: 99.5 и 99.9 — выполняются без запаса; 99.99 требует 7.4 дБ при фактических 20
    const t9999 = r.targets.find((t) => t.availabilityPercent === 99.99)!
    expect(t9999.requiredMarginDb).toBeCloseTo(7.4, 1)
    expect(t9999.met).toBe(true)
    expect(r.targets.find((t) => t.availabilityPercent === 99.9)!.met).toBe(true)
  })

  it('без ввода дождя — оценка R0.01 по зоне дождя K (P.837-3): 42 мм/ч', () => {
    const noRain: CalculationInput = { ...input, atmosphere: { gases: false, vegetation: false } }
    const report = computeAvailabilityReport(noRain, budgetWith(20))!
    expect(report.rainSource).toBe('zone')
    expect(report.rainRate001).toBe(42)
    // A001 = γR(42, 6000, V)·dэфф, d0(42) = 35·e^(−0.63) = 18.71 км → dэфф = 13.61 км
    const d0 = rainPathReductionD0Km(42)
    expect(report.rainAttenuation001Db).toBeCloseTo(
      rainSpecificAttenuationDbKm(42, 6000, 'vertical') * (50 / (1 + 50 / d0)),
      5,
    )
  })

  it('запас ≤ 0: линия не обеспечивается — недоступность 100 %', () => {
    const report = computeAvailabilityReport(input, budgetWith(-5))!
    expect(report.outage.totalPercent).toBe(100)
    expect(report.outage.totalHoursPerYear).toBe(HOURS_PER_YEAR)
    expect(report.outage.availabilityPercent).toBe(0)
  })

  it('строка расхода бюджета формируется из отчёта', () => {
    const report = computeAvailabilityReport(input, budgetWith(20))!
    const row = availabilityExpenseRow(report)
    expect(row.unit).toBe('ч/год')
    expect(row.sign).toBe('=')
    expect(row.value).toBeCloseTo(report.outage.totalHoursPerYear, 2)
  })

  it('тип отчёта соответствует AvailabilityReport (поля целей)', () => {
    const report: AvailabilityReport | null = computeAvailabilityReport(input, budgetWith(20))
    expect(report?.targets).toHaveLength(3)
  })
})

/**
 * Тесты clearance-аудита трассы: критерий 0.6·F1 при K = 4/3, 2/3, ∞,
 * вердикт light/heavy, доп. дифракционные потери подрефракции.
 * Геометрия эталонных случаев рассчитана вручную (30 км, 2400 МГц):
 * F1(середина) = 30.6 м; выпуклость Земли в середине: K=4/3 → 13.2 м,
 * K=2/3 → 26.5 м, K=∞ → 0.
 */
import { describe, it, expect } from 'bun:test'
import { auditClearance, CLEARANCE_CRITERION } from '../src/lib/radio/clearance'
import { fresnelRadiusM } from '../src/lib/radio/fresnel'
import { earthBulgeM } from '../src/lib/radio/fspl'
import type { CalculationInput } from '../src/lib/radio/types'

const D = 30000
const F = 2400

function makeInput(midElev: number): CalculationInput {
  return {
    frequencyMhz: F,
    polarization: 'vertical',
    path: {
      points: [{ lat: 55.75, lon: 37.62 }, { lat: 55.48, lon: 37.62 }],
      distanceM: D,
      azimuthDeg: 180,
      profile: [
        { d: 0, elev: 100, clutter: 0, total: 100 },
        { d: 7500, elev: 100, clutter: 0, total: 100 },
        { d: 15000, elev: midElev, clutter: 0, total: midElev },
        { d: 22500, elev: 100, clutter: 0, total: 100 },
        { d: 30000, elev: 100, clutter: 0, total: 100 },
      ],
      demStepM: 30,
      demSource: 'test',
    },
    txHeightM: 30,
    rxHeightM: 30,
    timePercents: [50],
    kFactor: 4 / 3,
    atmosphere: { gases: false, vegetation: false },
    epsilon: 15,
    sigma: 0.005,
    climateZone: 'K',
  }
}

describe('Clearance-аудит: геометрия', () => {
  it('контрольные величины F1 и выпуклости Земли в середине трассы', () => {
    // λ = 0.1249 м; F1(mid) = sqrt(λ·d1·d2/d) = 30.6 м
    expect(fresnelRadiusM(15000, D, F)).toBeCloseTo(30.6, 0)
    // выпуклость: K=4/3 → 13.2 м, K=2/3 → 26.5 м, K=∞ → 0
    expect(earthBulgeM(15000, D, 4 / 3)).toBeCloseTo(13.24, 1)
    expect(earthBulgeM(15000, D, 2 / 3)).toBeCloseTo(26.49, 1)
    expect(earthBulgeM(15000, D, Infinity)).toBe(0)
  })

  it('просвет монотонен по K: ∞ ≥ 4/3 ≥ 2/3', () => {
    const audit = auditClearance(makeInput(95))
    expect(audit.ks[2].minRatio).toBeGreaterThanOrEqual(audit.ks[0].minRatio)
    expect(audit.ks[0].minRatio).toBeGreaterThanOrEqual(audit.ks[1].minRatio)
  })

  it('случай «между 0.6·F1 (4/3) и 0.6·F1 (2/3)»: clear при 4/3, marginal при 2/3 → heavy', () => {
    // препятствие 95 м: просвет(4/3) = 130 − 13.24 − 95 = 21.76 м = 0.71·F1 → clear;
    // просвет(2/3) = 130 − 26.49 − 95 = 8.51 м = 0.28·F1 → marginal
    const audit = auditClearance(makeInput(95))
    const k43 = audit.ks[0]
    const k23 = audit.ks[1]
    const kInf = audit.ks[2]
    expect(k43.verdict).toBe('clear')
    expect(k43.minRatio).toBeCloseTo(21.76 / 30.6, 1)
    expect(k43.worstDm).toBe(15000)
    expect(k23.verdict).toBe('marginal')
    expect(k23.minRatio).toBeCloseTo(8.51 / 30.6, 1)
    expect(kInf.verdict).toBe('clear')
    // 0.6·F1 не выполнен при подрефракции → heavy
    expect(audit.routeClass).toBe('heavy')
    expect(CLEARANCE_CRITERION).toBe(0.6)
    // препятствие ниже LOS — доп. дифракционных потерь нет
    expect(audit.extraDiffractionDb).toBeCloseTo(0, 6)
  })

  it('случай «перекрыта»: blocked на всех K, доп. потери при K=2/3 больше, чем при 4/3', () => {
    // препятствие 135 м выше LOS (130 м): просвет(4/3) = −18.2 м, (2/3) = −31.5 м
    const audit = auditClearance(makeInput(135))
    expect(audit.ks[0].verdict).toBe('blocked')
    expect(audit.ks[0].minRatio).toBeCloseTo(-18.24 / 30.6, 1)
    expect(audit.ks[1].verdict).toBe('blocked')
    expect(audit.ks[2].verdict).toBe('blocked')
    expect(audit.routeClass).toBe('heavy')
    // дифракционные потери растут при подрефракции
    expect(audit.extraDiffractionDb).toBeGreaterThan(0)
  })

  it('профиль без промежуточных точек — аудит не применим (clear, ratio ∞)', () => {
    const input = makeInput(95)
    input.path.profile = [input.path.profile[0], input.path.profile[4]]
    const audit = auditClearance(input)
    expect(audit.ks.every((k) => k.minRatio === Infinity && k.verdict === 'clear')).toBe(true)
    expect(audit.routeClass).toBe('light')
  })
})

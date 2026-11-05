/**
 * Тесты локального движка: FSPL+P.526 (детерминированный) и P.2001-lite
 * (статистическая модель). Проверки физики: потери ≥ FSPL, рост с частотой
 * и расстоянием, вклад дифракции, изменчивость по процентам времени.
 */
import { describe, it, expect } from 'vitest'
import {
  radioHorizonKm,
  medianLossFsplP526,
  clutterLosses,
  computeFsplP526,
  computeP2001Lite,
} from '../p2001lite'
import { diffractionLossDb } from '../diffraction'
import { fsplDb } from '../fspl'
import { makeInput, flatProfile, ridgeProfile } from './fixtures'

describe('Радиогоризонт (4.12·(√h1+√h2)·√(k/(4/3)))', () => {
  it('30 м + 10 м при k = 4/3 ≈ 35.59 км', () => {
    expect(radioHorizonKm(30, 10, 4 / 3)).toBeCloseTo(35.59, 1)
  })
  it('растёт с высотой антенн', () => {
    expect(radioHorizonKm(100, 50, 4 / 3)).toBeGreaterThan(radioHorizonKm(30, 10, 4 / 3))
  })
  it('при k > 4/3 горизонт дальше', () => {
    expect(radioHorizonKm(30, 10, 2)).toBeGreaterThan(radioHorizonKm(30, 10, 4 / 3))
  })
  it('отрицательные высоты не дают NaN', () => {
    expect(Number.isFinite(radioHorizonKm(-10, -5, 4 / 3))).toBe(true)
  })
})

describe('Медианные потери FSPL + P.526', () => {
  it('на ровной трассе потери ≥ FSPL', () => {
    const input = makeInput()
    const r = medianLossFsplP526(input)
    expect(r.lossDb).toBeGreaterThanOrEqual(r.fspl - 1e-9)
    expect(r.fspl).toBeCloseTo(fsplDb(input.path.distanceM, 2000), 6)
  })
  it('потери растут с расстоянием', () => {
    const short = medianLossFsplP526(makeInput({ path: { distanceM: 20_000 } as never })).lossDb
    const long = medianLossFsplP526(makeInput({ path: { distanceM: 60_000 } as never })).lossDb
    expect(long).toBeGreaterThan(short)
  })
  it('горная трасса даёт дифракционную добавку', () => {
    const flat = medianLossFsplP526(makeInput())
    const dist = 30_000
    const input = makeInput({
      path: {
        distanceM: dist,
        profile: ridgeProfile(dist, 150),
      } as never,
    })
    const ridge = medianLossFsplP526(input)
    expect(ridge.diffraction).toBeGreaterThan(flat.diffraction)
    expect(ridge.lossDb).toBeGreaterThan(flat.lossDb)
  })
  it('тропосферное рассеяние включается за радиогоризонтом', () => {
    // 200 км при высотах 30/10 м — далеко за горизонтом (~35 км)
    const dist = 200_000
    const r = medianLossFsplP526(makeInput({ path: { distanceM: dist, profile: flatProfile(dist, 101) } as never }))
    expect(r.scatter).toBeGreaterThan(0)
  })
})

describe('Дифракция (P.526): Дейгаут и Буллингтон', () => {
  it('на ровном профиле дифракции нет', () => {
    const input = makeInput()
    expect(diffractionLossDb(input.path.profile, 30, 10, 2000, 4 / 3)).toBe(0)
  })
  it('высокое препятствие посередине даёт заметные потери (> 6 дБ)', () => {
    const dist = 30_000
    const profile = ridgeProfile(dist, 200)
    const loss = diffractionLossDb(profile, 30, 10, 2000, 4 / 3)
    expect(loss).toBeGreaterThan(6)
  })
  it('k-фактор влияет на результат (субрефракция хуже)', () => {
    const dist = 30_000
    const profile = ridgeProfile(dist, 120)
    const kGood = diffractionLossDb(profile, 30, 10, 2000, 4 / 3)
    const kBad = diffractionLossDb(profile, 30, 10, 2000, 0.7)
    expect(kBad).toBeGreaterThanOrEqual(kGood)
  })
  it('слишком короткий профиль (< 3 точек) → 0', () => {
    expect(diffractionLossDb([{ d: 0, elev: 0 }], 30, 10, 2000, 4 / 3)).toBe(0)
  })
  it('потери не могут быть отрицательными', () => {
    const dist = 30_000
    const loss = diffractionLossDb(ridgeProfile(dist, 50), 300, 300, 2000, 4 / 3)
    expect(loss).toBeGreaterThanOrEqual(0)
  })
})

describe('Clutter: здания и растительность в профиле', () => {
  it('здание на трассе увеличивает дифракционную составляющую', () => {
    const dist = 30_000
    const profile = flatProfile(dist).map((p, i) =>
      i === 10 ? { ...p, clutter: 25, total: p.elev + 25 } : p,
    )
    const r = clutterLosses(makeInput({ path: { distanceM: dist, profile } as never }))
    expect(r.hasBuilding).toBe(true)
    expect(r.diffractionDb).toBeGreaterThan(0)
  })
  it('растительность учитывается только при vegetation = true', () => {
    const dist = 30_000
    const profile = flatProfile(dist).map((p, i) =>
      i > 2 && i < 12 ? { ...p, clutter: 8, total: p.elev + 8 } : p,
    )
    const off = clutterLosses(makeInput({ path: { distanceM: dist, profile } as never }))
    const on = clutterLosses(
      makeInput({ path: { distanceM: dist, profile } as never, atmosphere: { rainRateMmH: 0, gases: false, vegetation: true } }),
    )
    expect(off.vegetationDb).toBe(0)
    expect(on.vegetationDb).toBeGreaterThan(0)
  })
})

describe('computeFsplP526 — полный расчёт', () => {
  it('возвращает согласованную структуру результата', () => {
    const r = computeFsplP526(makeInput())
    expect(r.model).toBe('fspl-p526')
    expect(r.engineUsed).toContain('FSPL')
    expect(r.medianLossDb).toBeGreaterThan(0)
    expect(r.byTimePercent).toHaveLength(1)
    expect(r.byTimePercent[0].percent).toBe(50)
    expect(r.breakdown.freeSpaceDb).toBeCloseTo(fsplDb(30_000, 2000), 6)
  })
  it('дождь учитывается только выше 3 ГГц', () => {
    const rain = { rainRateMmH: 40, gases: false, vegetation: false }
    const low = computeFsplP526(makeInput({ atmosphere: rain }))
    expect(low.breakdown.rainDb).toBeUndefined()
    const high = computeFsplP526(makeInput({ frequencyMhz: 6000, atmosphere: rain }))
    expect(high.breakdown.rainDb).toBeGreaterThan(0)
    expect(high.medianLossDb).toBeGreaterThan(low.medianLossDb)
  })
  it('газы добавляют потери при включении', () => {
    const off = computeFsplP526(makeInput())
    const on = computeFsplP526(makeInput({ atmosphere: { rainRateMmH: 0, gases: true, vegetation: false } }))
    expect(on.breakdown.gasesDb).toBeGreaterThan(0)
    expect(on.medianLossDb).toBeGreaterThan(off.medianLossDb)
  })
})

describe('computeP2001Lite — статистическая модель', () => {
  it('возвращает модель p2001 с предупреждением о lite-режиме', () => {
    const r = computeP2001Lite(makeInput({ timePercents: [50, 90, 99] }))
    expect(r.model).toBe('p2001')
    expect(r.engineUsed).toContain('P.2001-lite')
    expect(r.warnings.some((w) => w.includes('P.2001-lite'))).toBe(true)
  })
  it('кривая по времени: p<50 % хуже медианы, p>50 % лучше', () => {
    const r = computeP2001Lite(makeInput({ timePercents: [1, 50, 99] }))
    const at = (p: number) => r.byTimePercent.find((t) => t.percent === p)!.lossDb
    expect(at(1)).toBeGreaterThan(at(50))
    expect(at(99)).toBeLessThan(at(50))
  })
  it('медиана при 50 % совпадает с базовой детерминированной', () => {
    const base = computeFsplP526(makeInput())
    const r = computeP2001Lite(makeInput())
    expect(r.medianLossDb).toBeCloseTo(base.medianLossDb, 6)
  })
  it('длинная трасса активирует многолучёвость (multipath в breakdown)', () => {
    const dist = 200_000
    const r = computeP2001Lite(
      makeInput({
        path: { distanceM: dist, profile: flatProfile(dist, 101) } as never,
        climateZone: 'F',
      }),
    )
    expect(r.breakdown.multipathDb).toBeDefined()
  })
})

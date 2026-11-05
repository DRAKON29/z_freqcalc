/**
 * Тесты зоны Френеля (ITU-R P.526 §2.3) и рефракции (P.453).
 */
import { describe, it, expect } from 'vitest'
import { fresnelRadiusM, clearanceM, fresnelClearanceRatio } from '../fresnel'
import { effectiveEarthRadiusM, earthBulgeM } from '../fspl'

describe('Радиус первой зоны Френеля F1', () => {
  it('середина трассы 50 км @ 2000 МГц ≈ 43.3 м', () => {
    expect(fresnelRadiusM(25_000, 50_000, 2000)).toBeCloseTo(43.3, 1)
  })
  it('на концах трассы F1 = 0', () => {
    expect(fresnelRadiusM(0, 50_000, 2000)).toBe(0)
    expect(fresnelRadiusM(50_000, 50_000, 2000)).toBe(0)
  })
  it('F1 максимальна в середине трассы (симметрия)', () => {
    const mid = fresnelRadiusM(25_000, 50_000, 2400)
    const quarter = fresnelRadiusM(12_500, 50_000, 2400)
    expect(mid).toBeGreaterThan(quarter)
    expect(quarter).toBeCloseTo(mid * Math.sqrt(0.75), 2)
  })
  it('вырожденные входы → 0 (нет деления на ноль)', () => {
    expect(fresnelRadiusM(10, 0, 2000)).toBe(0)
    expect(fresnelRadiusM(-5, 1000, 2000)).toBe(0)
  })
  it('вторая зона F2 = √2 · F1', () => {
    expect(fresnelRadiusM(25_000, 50_000, 2000, 2)).toBeCloseTo(
      fresnelRadiusM(25_000, 50_000, 2000) * Math.SQRT2,
      6,
    )
  })
})

describe('Клиренс (clearance) с учётом кривизны Земли', () => {
  it('ровный визир над нулевым препятствием → клиренс = −выпуклость', () => {
    const c = clearanceM(0, 0, 50_000, 25_000, 0, 4 / 3)
    expect(c).toBe(-earthBulgeM(25_000, 50_000, 4 / 3))
  })
  it('антенны выше препятствия — клиренс положителен', () => {
    const c = clearanceM(100, 100, 50_000, 25_000, 0, 4 / 3)
    expect(c).toBe(100 - earthBulgeM(25_000, 50_000, 4 / 3))
  })
})

describe('Отношение клиренса к F1 (критерий 0.6·F1)', () => {
  it('при антеннах 100 м на 50 км ratio > 0.6', () => {
    const ratio = fresnelClearanceRatio(100, 100, 50_000, 25_000, 0, 4 / 3, 2000)
    expect(ratio).toBeGreaterThan(0.6)
  })
  it('F1 = 0 (d1 на краю) → Infinity (нет деления на ноль)', () => {
    expect(fresnelClearanceRatio(10, 10, 50_000, 0, 0, 4 / 3, 2000)).toBe(Infinity)
  })
})

describe('Эффективный радиус Земли (P.453)', () => {
  it('k = 4/3 → a_e ≈ 8494.7 км', () => {
    expect(effectiveEarthRadiusM(4 / 3)).toBeCloseTo(8_494_666.7, 0)
  })
  it('k = 1 → средний радиус Земли', () => {
    expect(effectiveEarthRadiusM(1)).toBe(6_371_000)
  })
  it('удвоение k уменьшает выпуклость вдвое', () => {
    expect(earthBulgeM(25_000, 50_000, 4 / 3) / earthBulgeM(25_000, 50_000, 8 / 3)).toBeCloseTo(2, 6)
  })
})

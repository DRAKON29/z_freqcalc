/** Тесты FSPL (P.525) и кривизны Земли. */
import { describe, it, expect } from 'bun:test'
import { fsplDb, earthBulgeM } from '../src/lib/radio/fspl'

describe('FSPL (ITU-R P.525)', () => {
  it('1 км @ 1000 МГц ≈ 92.44 дБ', () => {
    expect(Math.abs(fsplDb(1000, 1000) - 92.44)).toBeLessThan(0.01)
  })
  it('50 км @ 2000 МГц ≈ 132.44 дБ', () => {
    expect(Math.abs(fsplDb(50_000, 2000) - 132.44)).toBeLessThan(0.01)
  })
  it('удвоение расстояния: +6 дБ', () => {
    const l1 = fsplDb(10_000, 2400)
    const l2 = fsplDb(20_000, 2400)
    expect(l2 - l1).toBeCloseTo(6.02, 1)
  })
  it('нулевая дистанция → 0', () => {
    expect(fsplDb(0, 1000)).toBe(0)
  })
})

describe('Кривизна Земли (P.453, k=4/3)', () => {
  it('выпуклость на середине трассы 50 км ≈ 36.6 м', () => {
    const bulge = earthBulgeM(25_000, 50_000, 4 / 3)
    expect(bulge).toBeGreaterThan(30)
    expect(bulge).toBeLessThan(40)
  })
  it('на концах трассы выпуклость 0', () => {
    expect(earthBulgeM(0, 50_000, 4 / 3)).toBe(0)
    expect(earthBulgeM(50_000, 50_000, 4 / 3)).toBe(0)
  })
})

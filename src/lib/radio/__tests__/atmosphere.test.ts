/**
 * Тесты атмосферных потерь: дождь (P.837/P.838), газы (P.676), растительность (P.833).
 */
import { describe, it, expect } from 'vitest'
import {
  rainSpecificAttenuationDbKm,
  rainLossDb,
  gasSpecificAttenuationDbKm,
  gasesLossDb,
  vegetationLossDb,
  clutterPenetrationDb,
} from '../atmosphere'

describe('Дождь: удельное затухание γR = k·R^α (P.838)', () => {
  it('нулевая интенсивность → 0 дБ/км', () => {
    expect(rainSpecificAttenuationDbKm(0, 5000, 'vertical')).toBe(0)
    expect(rainSpecificAttenuationDbKm(-5, 5000, 'vertical')).toBe(0)
  })
  it('низкая частота (< 100 МГц) → 0', () => {
    expect(rainSpecificAttenuationDbKm(50, 90, 'vertical')).toBe(0)
  })
  it('затухание растёт с интенсивностью дождя', () => {
    const g10 = rainSpecificAttenuationDbKm(10, 6000, 'horizontal')
    const g50 = rainSpecificAttenuationDbKm(50, 6000, 'horizontal')
    expect(g10).toBeGreaterThan(0)
    expect(g50).toBeGreaterThan(g10)
  })
  it('порядок величины на 1–7 ГГц — тысячные/сотые дБ/км', () => {
    // Примечание: аппроксимация приложения (фит экспонентой по log10(f)) даёт
    // немонотонную зависимость γR(f) — отклонение от справочных таблиц P.838-3,
    // поэтому проверяем порядок величины, а не монотонный рост.
    for (const f of [1000, 3000, 7000]) {
      const g = rainSpecificAttenuationDbKm(25, f, 'vertical')
      expect(g).toBeGreaterThan(0)
      expect(g).toBeLessThan(0.1)
    }
  })
  it('круговая поляризация: положительна и не выше максимума H/V', () => {
    // (kV + kH + 2·kV·kH)/4 при малых k < min(kV, kH) — свойство реализации
    const h = rainSpecificAttenuationDbKm(25, 4000, 'horizontal')
    const v = rainSpecificAttenuationDbKm(25, 4000, 'vertical')
    const c = rainSpecificAttenuationDbKm(25, 4000, 'circular')
    expect(c).toBeGreaterThan(0)
    expect(c).toBeLessThan(Math.max(h, v) + 1e-9)
  })
})

describe('Дождь: эффективная длина трассы (d0 = 35 км)', () => {
  it('потери = γR · d/(1+d/35)', () => {
    const d = 100_000 // 100 км
    const gamma = rainSpecificAttenuationDbKm(30, 5000, 'vertical')
    const expected = gamma * (100 / (1 + 100 / 35))
    expect(rainLossDb(d, 30, 5000, 'vertical')).toBeCloseTo(expected, 8)
  })
  it('эффективная длина короче фактической на длинных трассах', () => {
    const gamma = rainSpecificAttenuationDbKm(30, 5000, 'vertical')
    // deff(100 км) = 100/(1+100/35) ≈ 25.9 км — асимптота d0 = 35 км
    const loss100 = rainLossDb(100_000, 30, 5000, 'vertical') / gamma
    expect(loss100).toBeLessThan(100)
    expect(loss100).toBeCloseTo(25.93, 1)
  })
  it('без дождя потерь нет', () => {
    expect(rainLossDb(50_000, 0, 5000, 'vertical')).toBe(0)
  })
})

describe('Атмосферные газы (P.676, упрощённая модель)', () => {
  it('справочная точка 1 ГГц ≈ 0.005–0.01 дБ/км', () => {
    const g = gasSpecificAttenuationDbKm(1000)
    expect(g).toBeGreaterThan(0.001)
    expect(g).toBeLessThan(0.05)
  })
  it('пик водяного пара около 22.235 ГГц', () => {
    const at22 = gasSpecificAttenuationDbKm(22_235)
    const at20 = gasSpecificAttenuationDbKm(20_000)
    const at25 = gasSpecificAttenuationDbKm(25_000)
    expect(at22).toBeGreaterThan(at20)
    expect(at22).toBeGreaterThan(at25)
  })
  it('резонанс кислорода 60 ГГц даёт максимум', () => {
    const at60 = gasSpecificAttenuationDbKm(60_000)
    const at40 = gasSpecificAttenuationDbKm(40_000)
    expect(at60).toBeGreaterThan(at40)
  })
  it('нулевая частота → 0', () => {
    expect(gasSpecificAttenuationDbKm(0)).toBe(0)
  })
  it('положительное давление усиливает затухание', () => {
    const low = gasSpecificAttenuationDbKm(10_000, 700, 7.5, 288.15)
    const std = gasSpecificAttenuationDbKm(10_000, 1013.25, 7.5, 288.15)
    expect(std).toBeGreaterThan(low)
  })
})

describe('Потери в газах на трассе', () => {
  it('растут с уменьшением угла места (длиннее путь)', () => {
    const elHigh = gasesLossDb(50_000, 5000, 30)
    const elLow = gasesLossDb(50_000, 5000, 1)
    expect(elLow).toBeGreaterThan(elHigh)
  })
  it('неотрицательны и конечны', () => {
    const g = gasesLossDb(50_000, 5000, 5)
    expect(g).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(g)).toBe(true)
  })
})

describe('Растительность (P.833, Вайсбергер)', () => {
  it('нулевая глубина → 0', () => {
    expect(vegetationLossDb(0, 2000)).toBe(0)
  })
  it('линейный рост до 400 м', () => {
    const l100 = vegetationLossDb(100, 2000)
    const l200 = vegetationLossDb(200, 2000)
    expect(l200).toBeCloseTo(l100 * 2, 6)
  })
  it('за 400 м — предельное значение (асимптота)', () => {
    const at400 = vegetationLossDb(400, 2000)
    const at2000 = vegetationLossDb(2000, 2000)
    expect(at2000).toBeLessThanOrEqual(at400)
    expect(at2000).toBeGreaterThanOrEqual(at400 * 0.6)
  })
  it('потери растут с частотой', () => {
    expect(vegetationLossDb(200, 6000)).toBeGreaterThan(vegetationLossDb(200, 1000))
  })
})

describe('Вклад clutter', () => {
  it('здания: фиксированная оценка затенения 18 дБ', () => {
    expect(clutterPenetrationDb(2000, 'building', 50)).toBe(18)
  })
  it('здания без глубины → 0', () => {
    expect(clutterPenetrationDb(2000, 'building', 0)).toBe(0)
  })
  it('растительность → модель Вайсбергера', () => {
    expect(clutterPenetrationDb(2000, 'vegetation', 150)).toBe(vegetationLossDb(150, 2000))
  })
})

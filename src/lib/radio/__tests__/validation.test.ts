/**
 * Тесты Zod-валидации входных данных и хелпера validate().
 */
import { describe, it, expect } from 'vitest'
import {
  latLonSchema,
  pathSchema,
  calculationInputSchema,
  dynamicParamsSchema,
  validate,
} from '../validation'
import { makeInput, flatProfile } from './fixtures'
import { LIMITS } from '../constants'

describe('latLonSchema', () => {
  it('допустимые координаты проходят', () => {
    expect(latLonSchema.safeParse({ lat: 55.75, lon: 37.61 }).success).toBe(true)
    expect(latLonSchema.safeParse({ lat: -90, lon: -180 }).success).toBe(true)
    expect(latLonSchema.safeParse({ lat: 90, lon: 180 }).success).toBe(true)
  })
  it('выход за диапазон отклоняется', () => {
    expect(latLonSchema.safeParse({ lat: 90.1, lon: 0 }).success).toBe(false)
    expect(latLonSchema.safeParse({ lat: 0, lon: 180.5 }).success).toBe(false)
  })
})

describe('pathSchema', () => {
  const valid = {
    points: [
      { lat: 55.75, lon: 37.61 },
      { lat: 55.83, lon: 37.85 },
    ],
    distanceM: 12_000,
    azimuthDeg: 65,
    profile: flatProfile(12_000, 5),
    demStepM: 30,
    demSource: 'test',
  }
  it('валидная трасса проходит', () => {
    expect(pathSchema.safeParse(valid).success).toBe(true)
  })
  it('ровно две точки A и Б', () => {
    expect(pathSchema.safeParse({ ...valid, points: [valid.points[0]] }).success).toBe(false)
    expect(pathSchema.safeParse({ ...valid, points: [...valid.points, valid.points[0]] }).success).toBe(false)
  })
  it('минимальная трасса 10 м, максимальная 300 км', () => {
    expect(pathSchema.safeParse({ ...valid, distanceM: 9 }).success).toBe(false)
    expect(pathSchema.safeParse({ ...valid, distanceM: 300_001 }).success).toBe(false)
  })
})

describe('calculationInputSchema', () => {
  it('дефолтный тестовый input валиден', () => {
    const r = calculationInputSchema.safeParse(makeInput())
    expect(r.success).toBe(true)
  })
  it(`частота вне ${LIMITS.frequencyMinMhz}–${LIMITS.frequencyMaxMhz} МГц отклоняется`, () => {
    expect(calculationInputSchema.safeParse(makeInput({ frequencyMhz: LIMITS.frequencyMinMhz - 1 })).success).toBe(false)
    expect(calculationInputSchema.safeParse(makeInput({ frequencyMhz: LIMITS.frequencyMaxMhz + 1 })).success).toBe(false)
    expect(calculationInputSchema.safeParse(makeInput({ frequencyMhz: 2400 })).success).toBe(true)
  })
  it('высоты антенн 0.5–600 м', () => {
    expect(calculationInputSchema.safeParse(makeInput({ txHeightM: 0.2 })).success).toBe(false)
    expect(calculationInputSchema.safeParse(makeInput({ rxHeightM: 601 })).success).toBe(false)
  })
  it('недопустимая поляризация отклоняется', () => {
    expect(calculationInputSchema.safeParse(makeInput({ polarization: 'diagonal' as never })).success).toBe(false)
  })
  it('k-фактор ограничен 0.5–10', () => {
    expect(calculationInputSchema.safeParse(makeInput({ kFactor: 0.1 })).success).toBe(false)
    expect(calculationInputSchema.safeParse(makeInput({ kFactor: 20 })).success).toBe(false)
  })
  it('короткий профиль (< 3 точек) отклоняется', () => {
    const bad = makeInput()
    bad.path.profile = bad.path.profile.slice(0, 2)
    expect(calculationInputSchema.safeParse(bad).success).toBe(false)
  })
})

describe('dynamicParamsSchema', () => {
  const valid = {
    altitudeM: 500,
    speedKmh: 150,
    initialElevationDeg: 5,
    initialAzimuthDeg: 90,
    trajectoryAzimuthDeg: 90,
    durationS: 300,
  }
  it(`скорость ${LIMITS.speedMinKmh}–${LIMITS.speedMaxKmh} км/ч`, () => {
    expect(dynamicParamsSchema.safeParse({ ...valid, speedKmh: LIMITS.speedMinKmh - 10 }).success).toBe(false)
    expect(dynamicParamsSchema.safeParse({ ...valid, speedKmh: LIMITS.speedMaxKmh + 10 }).success).toBe(false)
    expect(dynamicParamsSchema.safeParse(valid).success).toBe(true)
  })
  it('высота полёта 5–20000 м', () => {
    expect(dynamicParamsSchema.safeParse({ ...valid, altitudeM: 4 }).success).toBe(false)
    expect(dynamicParamsSchema.safeParse({ ...valid, altitudeM: 20_001 }).success).toBe(false)
  })
  it('длительность 10–3600 с', () => {
    expect(dynamicParamsSchema.safeParse({ ...valid, durationS: 9 }).success).toBe(false)
    expect(dynamicParamsSchema.safeParse({ ...valid, durationS: 3601 }).success).toBe(false)
  })
})

describe('validate(): формат ошибок', () => {
  it('ok=true возвращает типизированные данные', () => {
    const r = validate(latLonSchema, { lat: 55, lon: 37 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toEqual({ lat: 55, lon: 37 })
  })
  it('ok=false собирает ошибки с путями', () => {
    const r = validate(latLonSchema, { lat: 100, lon: 1000 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors).toHaveLength(2)
      expect(r.errors[0]).toContain('lat')
      expect(r.errors[1]).toContain('lon')
    }
  })
})

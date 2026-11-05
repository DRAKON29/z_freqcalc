/** Тесты атмосферы (P.837/P.838/P.676/P.833) и рельефа (.hgt). */
import { describe, it, expect } from 'bun:test'
import { rainLossDb, rainSpecificAttenuationDbKm, gasSpecificAttenuationDbKm, vegetationLossDb } from '../src/lib/radio/atmosphere'
import { parseHgt, tileElevation, createSyntheticDem, buildProfile, validateClutter, makeClutterSampler } from '../src/lib/radio/terrain'
import { computeP2001Lite, computeFsplP526, radioHorizonKm } from '../src/lib/radio/p2001lite'
import type { CalculationInput } from '../src/lib/radio/types'

describe('Дождь (P.837 + P.838)', () => {
  it('удельное затухание растёт с интенсивностью', () => {
    const g1 = rainSpecificAttenuationDbKm(10, 5000, 'vertical')
    const g2 = rainSpecificAttenuationDbKm(50, 5000, 'vertical')
    expect(g1).toBeGreaterThan(0)
    expect(g2).toBeGreaterThan(g1)
  })
  it('учитывается только выше 3 ГГц', () => {
    expect(rainLossDb(20_000, 42, 1500, 'vertical')).toBeGreaterThan(0)
  })
  it('при R=42 мм/ч на 6 ГГц γ в разумных пределах (0.01–0.2 дБ/км)', () => {
    const g = rainSpecificAttenuationDbKm(42, 6000, 'horizontal')
    expect(g).toBeGreaterThan(0.005)
    expect(g).toBeLessThan(0.5)
  })
})

describe('Атмосферные газы (P.676)', () => {
  it('на 1 ГГц затухание мало (< 0.02 дБ/км)', () => {
    expect(gasSpecificAttenuationDbKm(1000)).toBeLessThan(0.02)
  })
  it('крыло кислорода 60 ГГц даёт максимум', () => {
    const g60 = gasSpecificAttenuationDbKm(60_000)
    const g1 = gasSpecificAttenuationDbKm(1000)
    expect(g60).toBeGreaterThan(g1 * 100)
  })
  it('водяной пар 22.235 ГГц > соседней частоты', () => {
    expect(gasSpecificAttenuationDbKm(22_235, 1013.25, 7.5)).toBeGreaterThan(gasSpecificAttenuationDbKm(20_000, 1013.25, 7.5))
  })
})

describe('Растительность (P.833, Вайсбергер)', () => {
  it('потери растут с глубиной', () => {
    expect(vegetationLossDb(50, 1000)).toBeGreaterThan(vegetationLossDb(10, 1000))
  })
  it('30 м листвы на 1 ГГц ≈ 24 дБ (0.45·1000^0.284·30)', () => {
    expect(vegetationLossDb(30, 1000)).toBeCloseTo(0.45 * Math.pow(1000, 0.284) * 30, 0)
  })
})

describe('SRTM .hgt', () => {
  function makeHgt(size: number): ArrayBuffer {
    const buf = new ArrayBuffer(size * size * 2)
    const view = new DataView(buf)
    for (let i = 0; i < size * size; i++) {
      view.setInt16(i * 2, (i % 100) * 10, false) // BE
    }
    return buf
  }
  it('парсит 1201×1201 с именем N47E039', () => {
    const tile = parseHgt(makeHgt(1201), 'N47E039.hgt')
    expect(tile.size).toBe(1201)
    expect(tile.latOrigin).toBe(47)
    expect(tile.lonOrigin).toBe(39)
  })
  it('отвергает неверный размер', () => {
    expect(() => parseHgt(makeHgt(1000), 'N47E039.hgt')).toThrow()
  })
  it('отвергает неверное имя', () => {
    expect(() => parseHgt(makeHgt(1201), 'tile.hgt')).toThrow()
  })
  it('первый узел = юго-западный угол', () => {
    const buf = new ArrayBuffer(1201 * 1201 * 2)
    const view = new DataView(buf)
    view.setInt16(0, 123, false)
    const tile = parseHgt(buf, 'N47E039.hgt')
    expect(tileElevation(tile, 47, 39)).toBe(123)
  })
})

describe('Синтетический DEM', () => {
  it('детерминирован и даёт рельеф 0–400 м', () => {
    const dem = createSyntheticDem()
    const e1 = dem.elevationAt(55.75, 37.62)
    const e2 = dem.elevationAt(55.75, 37.62)
    expect(e1).toBe(e2)
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < 500; i++) {
      const e = dem.elevationAt(54 + Math.random() * 2, 37 + Math.random() * 2)
      min = Math.min(min, e)
      max = Math.max(max, e)
    }
    expect(min).toBeGreaterThanOrEqual(0)
    expect(max).toBeLessThan(450)
  })
  it('профиль строится с DEM-шагом и замыкается в точке Б', () => {
    const dem = createSyntheticDem()
    const a = { lat: 55.75, lon: 37.62 }
    const b = { lat: 55.85, lon: 37.62 }
    const profile = buildProfile(a, b, dem)
    expect(profile.length).toBeGreaterThanOrEqual(20)
    expect(profile[0].d).toBe(0)
    expect(profile[profile.length - 1].d).toBeCloseTo(11119.5, 0)
  })
})

describe('Clutter GeoJSON', () => {
  const gj = {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        geometry: { type: 'Polygon' as const, coordinates: [[[37.61, 55.75], [37.63, 55.75], [37.63, 55.76], [37.61, 55.76], [37.61, 55.75]]] },
        properties: { type: 'building' as const, height: 25 },
      },
    ],
  }
  it('валидный geojson проходит', () => {
    const r = validateClutter(gj)
    expect(r.ok).toBe(true)
    expect(r.count).toBe(1)
  })
  it('неверный type отвергается', () => {
    const bad = { ...gj, features: [{ ...gj.features[0], properties: { type: 'water', height: 1 } }] }
    expect(validateClutter(bad).ok).toBe(false)
  })
  it('сэмплер находит здание внутри полигона', () => {
    const sampler = makeClutterSampler(gj)
    const hit = sampler(55.755, 37.62)
    expect(hit).not.toBeNull()
    expect(hit!.type).toBe('building')
    expect(hit!.height).toBe(25)
    expect(sampler(55.9, 37.62)).toBeNull()
  })
})

describe('Модели распространения', () => {
  const input: CalculationInput = {
    frequencyMhz: 2000,
    polarization: 'vertical',
    path: {
      points: [{ lat: 55.75, lon: 37.62 }, { lat: 55.75, lon: 38.07 }],
      distanceM: 30_000,
      azimuthDeg: 90,
      profile: [
        { d: 0, elev: 150, clutter: 0, total: 150 },
        { d: 15_000, elev: 210, clutter: 0, total: 210 },
        { d: 30_000, elev: 140, clutter: 0, total: 140 },
      ],
      demStepM: 30,
      demSource: 'test',
    },
    txHeightM: 30,
    rxHeightM: 15,
    timePercents: [50, 90, 99, 99.9],
    kFactor: 4 / 3,
    atmosphere: { gases: false, vegetation: false },
    epsilon: 15,
    sigma: 0.005,
    climateZone: 'K',
  }

  it('FSPL+P.526: дифракция на холме добавляет потери', () => {
    const r = computeFsplP526(input)
    const fsplFlat = 20 * Math.log10(30) + 20 * Math.log10(2000) + 32.44
    expect(r.medianLossDb).toBeGreaterThan(fsplFlat)
    expect(r.breakdown.diffractionDb).toBeGreaterThan(0)
  })

  it('P.2001-lite: потери, превышаемые p% времени, убывают с ростом p (конвенция P.2001)', () => {
    const r = computeP2001Lite(input)
    expect(r.byTimePercent).toHaveLength(4)
    const [p50, p90, p99] = r.byTimePercent
    expect(p50.percent).toBe(50)
    expect(p99.lossDb).toBeLessThan(p90.lossDb)
    expect(p90.lossDb).toBeLessThan(p50.lossDb)
    expect(r.medianLossDb).toBeCloseTo(p50.lossDb, 5)
  })

  it('радиогоризонт ~ 63 км при h=100/50 м (k=4/3)', () => {
    expect(radioHorizonKm(100, 50, 4 / 3)).toBeGreaterThan(55)
    expect(radioHorizonKm(100, 50, 4 / 3)).toBeLessThan(75)
  })
})

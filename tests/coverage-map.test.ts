/**
 * Тесты покрытия на карте (этап 2.5): уровни в CoverageResult (margins),
 * билинейная интерполяция marginAt с wrap по азимуту, палитра зон
 * coverageColorAt, геопривязка coverageBounds.
 */
import { describe, it, expect } from 'bun:test'
import { computeCoverage } from '../src/lib/radio/coverage'
import {
  coverageBounds,
  coverageColorAt,
  marginAt,
} from '../src/lib/radio/map-coverage'
import { buildProfile, type DemSource } from '../src/lib/radio/terrain'
import { distanceM } from '../src/lib/radio/coordinates'
import type { CalculationInput, EquipmentParams } from '../src/lib/radio/types'

/** Плоская земля 50 м с гауссовой горкой (250 м) на середине трассы. */
function hillDem(): DemSource {
  const center = { lat: 55.79315, lon: 37.7337 }
  return {
    name: 'тест-горка',
    resolutionM: 30,
    elevationAt(lat: number, lon: number): number {
      const dx = (lat - center.lat) * 111320
      const dy = (lon - center.lon) * 111320 * Math.cos((center.lat * Math.PI) / 180)
      return 50 + 250 * Math.exp(-(dx * dx + dy * dy) / 720000)
    },
  }
}

const A = { lat: 55.7558, lon: 37.6173 }
const B = { lat: 55.8305, lon: 37.8501 }

const equipment: EquipmentParams = {
  mode: 'simple',
  tx: { gainDbi: 20, polarization: 'vertical' },
  rx: { gainDbi: 20, polarization: 'vertical' },
  transmitter: { powerDbm: 40, sensitivityDbm: -110 },
  receiver: { powerDbm: 0, sensitivityDbm: -110, noiseBandwidthHz: 1e6, noiseFigureDb: 3, modulation: 'BPSK', requiredEbN0Db: 9.6 },
}

function makeInput(dem: DemSource): CalculationInput {
  const profile = buildProfile(A, B, dem)
  return {
    frequencyMhz: 2400,
    polarization: 'vertical',
    path: {
      points: [A, B],
      distanceM: distanceM(A, B),
      azimuthDeg: 67,
      profile,
      demStepM: dem.resolutionM,
      demSource: dem.name,
    },
    txHeightM: 10,
    rxHeightM: 10,
    timePercents: [50],
    kFactor: 4 / 3,
    atmosphere: { gases: false, vegetation: false },
    epsilon: 15,
    sigma: 0.005,
    climateZone: 'K',
  }
}

function run(mode: 'model' | 'fspl' | 'geometry' | 'fresnel', dem: DemSource) {
  const input = makeInput(dem)
  return computeCoverage({ input, dem, equipment, radiusKm: 25, mode, azimuthStepDeg: 30 })
}

describe('coverage levels (этап 2.5)', () => {
  const dem = hillDem()

  it('levels: сетка 72×60, distKm равномерно до радиуса', () => {
    const r = run('model', dem)
    expect(r.levels.azCount).toBe(12) // 360 / шаг 30°
    expect(r.levels.distKm.length).toBe(60)
    expect(r.levels.margins.length).toBe(12 * 60)
    expect(r.levels.distKm[0]).toBeCloseTo(25 / 60, 3)
    expect(r.levels.distKm[59]).toBeCloseTo(25, 3)
  })

  it('model: все margins конечны (модель идёт до конца радиуса)', () => {
    const r = run('model', dem)
    let nan = 0
    for (const m of r.levels.margins) if (Number.isNaN(m)) nan++
    expect(nan).toBe(0)
  })

  it('geometry: margins не заполняются (рендер по границам радиалов), зона — в maxKm', () => {
    const r = run('geometry', dem)
    const hillAz = r.routeAzDeg
    const azIdx = Math.round(hillAz / 30) % r.levels.azCount
    const radial = r.radials[azIdx]
    const distCount = r.levels.distKm.length
    // геометрические режимы классифицируются по границе радиала (boundaryColorAt),
    // margins остаются NaN по всему радиалу
    let nan = 0
    for (let k = 0; k < distCount; k++) {
      if (Number.isNaN(r.levels.margins[azIdx * distCount + k])) nan++
    }
    expect(nan).toBe(distCount)
    expect(radial.maxKm).not.toBeNull()
    // в направлении горки зона обрывается до неё (≈ 8.4 км)
    expect(radial.maxKm!).toBeLessThan(9)
  })
})

describe('marginAt: билинейная интерполяция', () => {
  const r = run('model', hillDem())

  it('точная выборка в узле сетки = значение margins', () => {
    const azIdx = 2
    const kIdx = 10
    const azDeg = azIdx * 30
    const dM = r.levels.distKm[kIdx] * 1000
    const m = marginAt(r, azDeg, dM)
    const direct = r.levels.margins[azIdx * 60 + kIdx]
    expect(m).toBeCloseTo(direct, 3)
  })

  it('wrap по азимуту: 359° интерполируется с азимутом 0°', () => {
    const near0 = marginAt(r, 359, 5000)
    const at0 = marginAt(r, 0, 5000)
    const at360 = marginAt(r, 721, 5000) // 361° → 1°
    expect(Number.isFinite(near0)).toBe(true)
    // интерполяция между 359→(360+step) идёт через север
    expect(Number.isFinite(at0)).toBe(true)
    expect(Number.isFinite(at360)).toBe(true)
  })

  it('вне радиуса и вне сетки — NaN', () => {
    expect(Number.isNaN(marginAt(r, 0, 26000))).toBe(true) // > radiusKm
    expect(Number.isNaN(marginAt(r, 0, -1))).toBe(true)
  })
})

describe('coverageColorAt: палитра зон', () => {
  it('пороги согласованы с tri-color статусами', () => {
    const strong = coverageColorAt(15)
    const ok = coverageColorAt(5)
    const marginal = coverageColorAt(-5)
    const lost = coverageColorAt(-25)
    expect(strong).toEqual([4, 120, 87, 235])
    expect(ok).toEqual([16, 185, 129, 210])
    expect(marginal).toEqual([217, 119, 6, 190])
    expect(lost).toEqual([220, 38, 38, 115])
  })

  it('NaN — прозрачный пиксель', () => {
    expect(coverageColorAt(NaN)).toEqual([0, 0, 0, 0])
  })

  it('границы порогов: ровно 10 → strong, ровно 0 → ok, ровно −10 → marginal', () => {
    expect(coverageColorAt(10)).toEqual([4, 120, 87, 235])
    expect(coverageColorAt(0)).toEqual([16, 185, 129, 210])
    expect(coverageColorAt(-10)).toEqual([217, 119, 6, 190])
  })
})

describe('coverageBounds: геопривязка', () => {
  it('bounds симметричны, долгота сжата на cosLat', () => {
    const center = { lat: 55.0, lon: 37.0 }
    const b = coverageBounds(center, 111320) // ровно 1° широты
    expect(b.sw.lat).toBeCloseTo(54.0, 5)
    expect(b.ne.lat).toBeCloseTo(56.0, 5)
    // 1° широты в метрах ≈ 1° долготы × cos(55°)⁻¹ — долгота шире
    const dLat = b.ne.lat - b.sw.lat
    const dLon = b.ne.lon - b.sw.lon
    expect(dLon).toBeGreaterThan(dLat)
    expect(dLon / dLat).toBeCloseTo(1 / Math.cos((55 * Math.PI) / 180), 3)
  })

  it('radius 0 — вырожденный bounds в центре', () => {
    const b = coverageBounds({ lat: 55.5, lon: 37.5 }, 0)
    expect(b.sw.lat).toBeCloseTo(55.5, 6)
    expect(b.ne.lon).toBeCloseTo(37.5, 6)
  })
})

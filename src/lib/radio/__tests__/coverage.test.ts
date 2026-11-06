/**
 * Тесты круговой диаграммы радиосигнала (coverage):
 *  • список радиусов (авто = длина трассы + 10 км, фиксированные 15…200 км с шагом 15);
 *  • расчёт по азимутам на плоском рельефе (граница близка к окружности);
 *  • влияние горы на сектор азимута;
 *  • сетка высот и шаг колец.
 */
import { describe, it, expect } from 'vitest'
import {
  computeCoverage,
  radiusOptions,
  autoRadiusKm,
  ringStepKm,
  sampleElevationGrid,
  sliceProfile,
  RADIUS_STEP_KM,
  RADIUS_MAX_KM,
  STRONG_MARGIN_DB,
} from '../coverage'
import type { DemSource } from '../terrain'
import { makeInput, makeEquipment } from './fixtures'
import { destination } from '../coordinates'

const flatDem: DemSource = { name: 'плоский', resolutionM: 100, elevationAt: () => 10 }

describe('радиус расчёта', () => {
  it('автоматический радиус = длина трассы + 10 км', () => {
    expect(autoRadiusKm(25)).toBe(35)
    expect(autoRadiusKm(2.5)).toBe(12.5)
    expect(autoRadiusKm(42.3)).toBe(52.3)
  })

  it('автоматический радиус ограничен 200 км', () => {
    expect(autoRadiusKm(500)).toBe(RADIUS_MAX_KM)
  })

  it('список: авто-опция первой, фиксированные 15…200 км с шагом 15 км', () => {
    const opts = radiusOptions(80) // авто = 90
    expect(opts[0].auto).toBe(true)
    expect(opts[0].valueKm).toBe(90)
    const fixed = opts.filter((o) => !o.auto).map((o) => o.valueKm)
    expect(fixed[0]).toBe(RADIUS_STEP_KM)
    expect(fixed[fixed.length - 1]).toBe(RADIUS_MAX_KM)
    // промежуточные значения на сетке 15 км (последний — 200 км, верхняя граница) и по возрастанию
    for (const v of fixed.slice(0, -1)) expect(Math.round(v) % RADIUS_STEP_KM).toBe(0)
    for (let i = 1; i < fixed.length; i++) expect(fixed[i]).toBeGreaterThan(fixed[i - 1])
    // значение, совпадающее с авто (90), из фиксированного списка убрано
    expect(fixed).not.toContain(90)
    expect(opts[0].label).toContain('Длина трассы + 10 км')
  })

  it('совпадение авто-значения с фиксированным шагом не создаёт дубликатов', () => {
    const opts = radiusOptions(35) // авто 45 = фиксированный 45
    const values = opts.map((o) => o.valueKm)
    expect(new Set(values).size).toBe(values.length)
    expect(values.filter((v) => Math.abs(v - 45) < 0.05).length).toBe(1)
  })

  it('шаг колец — «красивые» значения', () => {
    expect(ringStepKm(200)).toBe(50)
    expect(ringStepKm(15)).toBe(5)
    expect(ringStepKm(62.3)).toBe(15)
    expect(ringStepKm(4)).toBe(1)
  })
})

describe('срез профиля', () => {
  it('обрезает профиль до дальности с точным конечным узлом', () => {
    const profile = Array.from({ length: 11 }, (_, i) => ({
      d: i * 1000,
      elev: 100 + i * 10,
      clutter: 0,
      total: 100 + i * 10,
    }))
    const sliced = sliceProfile(profile, 5500, 100)
    expect(sliced[sliced.length - 1].d).toBeCloseTo(5500, 0)
    expect(sliced[sliced.length - 1].elev).toBeCloseTo(155, 0)
    expect(sliced[0].d).toBe(0)
  })

  it('прореживание сохраняет первый и последний узлы', () => {
    const profile = Array.from({ length: 400 }, (_, i) => ({
      d: i * 100,
      elev: i,
      clutter: 0,
      total: i,
    }))
    const sliced = sliceProfile(profile, 39_900, 50)
    expect(sliced.length).toBeLessThanOrEqual(51)
    expect(sliced[0].d).toBe(0)
    expect(sliced[sliced.length - 1].d).toBe(39_900)
  })
})

describe('computeCoverage: плоский рельеф', () => {
  const input = makeInput({ frequencyMhz: 2400 })
  const equipment = makeEquipment()

  it('72 азимута при шаге 5°, граница внутри радиуса', () => {
    const res = computeCoverage({ input, dem: flatDem, equipment, radiusKm: 200 })
    expect(res.radials.length).toBe(72)
    expect(res.radiusKm).toBe(200)
    expect(res.routeAzDeg).toBeCloseTo(65, 0)
    expect(res.engineUsed).toContain('P.526')
    expect(res.computedAtMs).toBeGreaterThanOrEqual(0)
    for (const r of res.radials) {
      expect(r.maxKm).not.toBeNull()
      expect(r.maxKm!).toBeLessThanOrEqual(200)
      expect(r.marginAtMaxDb).not.toBeNull()
      expect(r.marginAtMaxDb!).toBeGreaterThanOrEqual(0)
      if (r.strongKm !== null) {
        expect(r.strongKm).toBeLessThanOrEqual(r.maxKm! + 1e-9)
      }
    }
  })

  it('без рельефа граница близка к окружности (разброс < 15 %)', () => {
    const res = computeCoverage({ input, dem: flatDem, equipment, radiusKm: 200, azimuthStepDeg: 30 })
    expect(res.radials.length).toBe(12)
    const kms = res.radials.map((r) => r.maxKm!)
    const mean = kms.reduce((a, b) => a + b, 0) / kms.length
    for (const km of kms) {
      expect(Math.abs(km - mean) / mean).toBeLessThan(0.15)
    }
    expect(mean).toBeGreaterThan(10)
    expect(mean).toBeLessThan(200)
  })

  it('статистика: покрытие всех азимутов на плоском рельефе', () => {
    const res = computeCoverage({ input, dem: flatDem, equipment, radiusKm: 100, azimuthStepDeg: 30 })
    expect(res.stats.coveredAzimuthPercent).toBeCloseTo(100, 0)
    expect(res.stats.minKm).not.toBeNull()
    expect(res.stats.maxKm).not.toBeNull()
    expect(res.stats.medianKm).not.toBeNull()
    expect(res.stats.areaPercent).toBeGreaterThan(10)
    expect(res.stats.outsideTilesPercent).toBeUndefined()
  })

  it('при слабом передатчике связи нет на всех азимутах', () => {
    const weak = makeEquipment({ transmitter: { powerDbm: -40, sensitivityDbm: -60 } })
    const res = computeCoverage({ input, dem: flatDem, equipment: weak, radiusKm: 50, azimuthStepDeg: 30 })
    expect(res.radials.every((r) => r.maxKm === null)).toBe(true)
    expect(res.stats.coveredAzimuthPercent).toBeCloseTo(0, 0)
    expect(res.stats.minKm).toBeNull()
  })
})

describe('computeCoverage: влияние рельефа', () => {
  const input = makeInput({ frequencyMhz: 2400 })
  const equipment = makeEquipment()

  it('гора перекрывает свой сектор азимута', () => {
    const center = input.path.points[0]
    const mountain = destination(center, 20_000, 60)
    const ridgeDem: DemSource = {
      name: 'хребет',
      resolutionM: 100,
      elevationAt: (lat, lon) => {
        const dLat = (lat - mountain.lat) * 111320
        const dLon = (lon - mountain.lon) * 111320 * Math.cos((mountain.lat * Math.PI) / 180)
        return Math.hypot(dLat, dLon) < 3000 ? 800 : 10
      },
    }
    const res = computeCoverage({ input, dem: ridgeDem, equipment, radiusKm: 200, azimuthStepDeg: 5 })
    const atMountain = res.radials.find((r) => r.azDeg === 60)!
    const opposite = res.radials.find((r) => r.azDeg === 240)!
    expect(atMountain.maxKm).not.toBeNull()
    expect(opposite.maxKm).not.toBeNull()
    // за горой дальность связи заметно меньше, чем в противоположном секторе
    expect(atMountain.maxKm!).toBeLessThan(opposite.maxKm! - 5)
  })

  it('оценка выхода за тайлы рельефа при переданных тайлах', () => {
    // «тайл» далеко от трассы: все контрольные точки вне покрытия
    const farTiles = [
      {
        name: 'S10E000',
        latOrigin: -10,
        lonOrigin: 0,
        size: 1201,
        stepDeg: 3 / 3600,
        data: new Int16Array(1201 * 1201),
      },
    ]
    const res = computeCoverage({
      input,
      dem: flatDem,
      equipment,
      radiusKm: 30,
      azimuthStepDeg: 30,
      hgtTiles: farTiles,
    })
    expect(res.stats.outsideTilesPercent).toBe(100)
  })
})

describe('сетка высот', () => {
  it('размер n×n, границы высот, nodataZero', () => {
    const center = { lat: 55.7558, lon: 37.6173 }
    const grid = sampleElevationGrid(flatDem, center, 10_000, 20, false)
    expect(grid.n).toBe(20)
    expect(grid.data.length).toBe(400)
    expect(grid.halfM).toBe(10_000)
    expect(grid.minElev).toBe(10)
    expect(grid.maxElev).toBe(10)
    expect(grid.nodataZero).toBe(false)
  })

  it('выборка сетки покрывает и северный, и южный край круга', () => {
    const lats: number[] = []
    const dem: DemSource = {
      name: 'probe',
      resolutionM: 30,
      elevationAt: (lat) => {
        lats.push(lat)
        return 0
      },
    }
    sampleElevationGrid(dem, { lat: 55.0, lon: 37.0 }, 10_000, 8, false)
    expect(lats.length).toBe(64)
    const maxLat = Math.max(...lats)
    const minLat = Math.min(...lats)
    // половина стороны ≈ 10 км ≈ 0.09° широты (с полусотовым отступом)
    expect(maxLat).toBeGreaterThan(55.07)
    expect(maxLat).toBeLessThan(55.1)
    expect(minLat).toBeLessThan(54.93)
    expect(minLat).toBeGreaterThan(54.9)
  })

  it('согласованный порог зоны уверенного приёма', () => {
    expect(STRONG_MARGIN_DB).toBe(10)
  })
})

/**
 * Тесты поиска оптимальной позиции точки A: полярная сетка кандидатов,
 * ограничение радиуса, формат СК-42 (7 цифр), перебор с полной оценкой линии
 * на синтетическом DEM (детерминированный).
 */
import { describe, it, expect } from 'bun:test'
import {
  buildSearchPoints,
  searchOptimalPointA,
  fmtSk42SevenDigits,
  SEARCH_RINGS,
  SEARCH_MAX_RADIUS_M,
} from '../src/lib/radio/optimal-point'
import { distanceM } from '../src/lib/radio/coordinates'
import { createSyntheticDem } from '../src/lib/radio/terrain'
import type { CalculationInput, EquipmentParams } from '../src/lib/radio/types'

const CENTER = { lat: 55.7558, lon: 37.6173 }

describe('Поиск позиции A: сетка кандидатов', () => {
  it('61 позиция: центр + кольца 8/12/16/24', () => {
    const pts = buildSearchPoints(CENTER, 1000)
    expect(pts).toHaveLength(1 + SEARCH_RINGS.reduce((s, r) => s + r.azimuths, 0))
    expect(pts).toHaveLength(61)
    expect(pts[0]).toEqual(CENTER)
  })

  it('все кандидаты в заданном радиусе', () => {
    const radius = 2000
    for (const p of buildSearchPoints(CENTER, radius)) {
      expect(distanceM(CENTER, p)).toBeLessThanOrEqual(radius + 2)
    }
  })

  it('формат СК-42 — ровно 7 цифр', () => {
    expect(fmtSk42SevenDigits(6182350.4)).toBe('6182350')
    expect(fmtSk42SevenDigits(7413070)).toBe('7413070')
    expect(fmtSk42SevenDigits(413070)).toBe('0413070')
  })
})

describe('Поиск позиции A: перебор с оценкой линии', () => {
  const baseInput: CalculationInput = {
    frequencyMhz: 2400,
    polarization: 'vertical',
    path: {
      points: [CENTER, { lat: 55.8, lon: 37.62 }],
      distanceM: 5560,
      azimuthDeg: 0,
      profile: [
        { d: 0, elev: 150, clutter: 0, total: 150 },
        { d: 2780, elev: 160, clutter: 0, total: 160 },
        { d: 5560, elev: 145, clutter: 0, total: 145 },
      ],
      demStepM: 30,
      demSource: 'test',
    },
    txHeightM: 30,
    rxHeightM: 10,
    timePercents: [50],
    kFactor: 4 / 3,
    atmosphere: { gases: false, vegetation: false },
    epsilon: 15,
    sigma: 0.005,
    climateZone: 'K',
  }

  const equipment: EquipmentParams = {
    mode: 'simple',
    noiseEnvironment: 'none',
    tx: { gainDbi: 10, polarization: 'vertical', beamwidthDeg: 360 },
    rx: { gainDbi: 3, polarization: 'vertical', beamwidthDeg: 360 },
    transmitter: { powerDbm: 30, sensitivityDbm: -100 },
    receiver: { powerDbm: 0, sensitivityDbm: -100, noiseBandwidthHz: 1e6, noiseFigureDb: 3, modulation: 'QPSK', requiredEbN0Db: 9.6 },
  }

  it('перебор: baseline первый, кандидаты отсортированы, все в радиусе, СК-42 целые', async () => {
    const progress: Array<{ done: number; total: number }> = []
    const report = await searchOptimalPointA(
      baseInput,
      equipment,
      createSyntheticDem(),
      undefined,
      1000,
      'fspl-p526',
      (done, total) => progress.push({ done, total }),
    )

    expect(report.candidatesTotal).toBe(61)
    expect(report.radiusM).toBe(1000)
    expect(report.baseline.isBaseline).toBe(true)
    expect(report.baseline.distFromOriginalM).toBe(0)
    // кандидаты не включают baseline
    expect(report.points.every((p) => !p.isBaseline)).toBe(true)

    // сортировка по запасу по убыванию
    for (let i = 1; i < report.points.length; i++) {
      expect(report.points[i - 1].linkMarginDb).toBeGreaterThanOrEqual(report.points[i].linkMarginDb)
    }
    // все кандидаты в радиусе (с допуском на сферическую геометрию)
    for (const p of [report.baseline, ...report.points]) {
      expect(p.distFromOriginalM).toBeLessThanOrEqual(1000 + 2)
      expect(Number.isInteger(p.x42)).toBe(true)
      expect(Number.isInteger(p.y42)).toBe(true)
      expect(p.zone).toBeGreaterThanOrEqual(1)
      expect(p.zone).toBeLessThanOrEqual(60)
      expect(p.x42).toBeGreaterThanOrEqual(1e6) // X от экватора — 7 цифр
      expect(p.y42).toBeGreaterThanOrEqual(1e6) // Y с номером зоны — 7 цифр
    }
    // оптимальные = строго лучше baseline (с порогом шума 0.05 дБ)
    const expectedOptimal = report.points.filter((p) => p.linkMarginDb > report.baseline.linkMarginDb + 0.05).length
    expect(report.optimalCount).toBe(expectedOptimal)
    // прогресс доходил до полного перебора
    expect(progress[progress.length - 1]).toEqual({ done: 61, total: 61 })
  })

  it('радиус ограничен 5000 м', async () => {
    const report = await searchOptimalPointA(baseInput, equipment, createSyntheticDem(), undefined, 99999, 'fspl-p526')
    expect(report.radiusM).toBe(SEARCH_MAX_RADIUS_M)
  }, 30000)
})

/**
 * Тесты динамики: допуск и деградация доплера, симуляция траектории,
 * радиус зоны связи, точки траектории на карте.
 */
import { describe, it, expect } from 'vitest'
import {
  dopplerToleranceHz,
  dopplerLossDb,
  simulateDynamics,
  trajectoryPoints,
  zoneRadiusM,
} from '../doppler'
import { fsplDb } from '../fspl'
import { distanceM } from '../coordinates'
import { makeInput } from './fixtures'

const OPTS = {
  powerDbm: 30,
  txGainDbi: 10,
  rxGainDbi: 3,
  sensitivityDbm: -100,
  noiseBandwidthHz: 1e6,
  noiseFigureDb: 3,
  modulation: 'QPSK' as const,
}

describe('Доплер: допуск и деградация', () => {
  it('допуск = полоса × 0.05 для BPSK/QPSK', () => {
    expect(dopplerToleranceHz(1e6, 'QPSK')).toBe(50_000)
    expect(dopplerToleranceHz(1e6, 'BPSK')).toBe(50_000)
  })
  it('допуск жёстче для 16QAM/64QAM', () => {
    expect(dopplerToleranceHz(1e6, '16QAM')).toBeLessThan(dopplerToleranceHz(1e6, 'QPSK'))
    expect(dopplerToleranceHz(1e6, '64QAM')).toBeLessThan(dopplerToleranceHz(1e6, '16QAM'))
  })
  it('в пределах допуска деградации нет', () => {
    expect(dopplerLossDb(0, 1e6, 'QPSK')).toBe(0)
    expect(dopplerLossDb(50_000, 1e6, 'QPSK')).toBe(0)
  })
  it('свыше 4× допуска — срыв демодуляции (99 дБ)', () => {
    expect(dopplerLossDb(4 * 50_000 + 1, 1e6, 'QPSK')).toBe(99)
  })
  it('промежуточные значения — ступенчатый рост без превышения 30 дБ', () => {
    const loss = dopplerLossDb(3 * 50_000, 1e6, 'QPSK')
    expect(loss).toBeGreaterThan(0)
    expect(loss).toBeLessThanOrEqual(30)
  })
  it('симметрична по знаку сдвига', () => {
    expect(dopplerLossDb(-60_000, 1e6, 'QPSK')).toBe(dopplerLossDb(60_000, 1e6, 'QPSK'))
  })
})

describe('simulateDynamics: симуляция полёта', () => {
  const input = makeInput({ path: { distanceM: 30_000, profile: [{ d: 0, elev: 0, clutter: 0, total: 0 }] } as never })

  it('шаги: 60–600, t монотонно от 0 до длительности', () => {
    const r = simulateDynamics(input, { altitudeM: 500, speedKmh: 150, initialElevationDeg: 5, initialAzimuthDeg: 90, trajectoryAzimuthDeg: 90, durationS: 300 }, OPTS)
    expect(r.samples.length).toBeGreaterThanOrEqual(60)
    expect(r.samples.length).toBeLessThanOrEqual(600)
    expect(r.samples[0].t).toBe(0)
    expect(r.samples[r.samples.length - 1].t).toBeCloseTo(300, 1)
    for (let i = 1; i < r.samples.length; i++) expect(r.samples[i].t).toBeGreaterThan(r.samples[i - 1].t)
  })
  it('в момент t=0 объект над Tx: наклонная дальность = Δh, доплер = 0', () => {
    const r = simulateDynamics(input, { altitudeM: 500, speedKmh: 150, initialElevationDeg: 5, initialAzimuthDeg: 90, trajectoryAzimuthDeg: 90, durationS: 120 }, OPTS)
    expect(r.samples[0].slantM).toBeCloseTo(470, 3) // 500 м высота − 30 м антенны Tx
    expect(r.samples[0].dopplerHz).toBeCloseTo(0, 6)
    expect(r.samples[0].elevationDeg).toBeCloseTo(90, 1)
  })
  it('наклонная дальность растёт, угол места падает', () => {
    const r = simulateDynamics(input, { altitudeM: 500, speedKmh: 150, initialElevationDeg: 5, initialAzimuthDeg: 90, trajectoryAzimuthDeg: 90, durationS: 120 }, OPTS)
    for (let i = 1; i < r.samples.length; i++) {
      expect(r.samples[i].slantM).toBeGreaterThanOrEqual(r.samples[i - 1].slantM)
      expect(r.samples[i].elevationDeg).toBeLessThan(r.samples[i - 1].elevationDeg)
    }
  })
  it('доплер физически согласован: |Δf| ≤ (v/c)·f', () => {
    const r = simulateDynamics(input, { altitudeM: 500, speedKmh: 150, initialElevationDeg: 5, initialAzimuthDeg: 90, trajectoryAzimuthDeg: 90, durationS: 120 }, OPTS)
    const vMax = (150 / 3.6) * 1 // радиальная ≤ путевая
    for (const s of r.samples) {
      expect(Math.abs(s.dopplerHz)).toBeLessThanOrEqual((vMax / 299_792_458) * 2000e6 + 1e-6)
    }
  })
  it('потери пути = FSPL наклонной дальности (+ газы при включении)', () => {
    const r = simulateDynamics(input, { altitudeM: 500, speedKmh: 150, initialElevationDeg: 5, initialAzimuthDeg: 90, trajectoryAzimuthDeg: 90, durationS: 120 }, OPTS)
    // Δh = 500 − 30 (высота антенны Tx)
    expect(r.samples[0].pathLossDb).toBeCloseTo(fsplDb(470, 2000), 6)
    const withGases = simulateDynamics(
      { ...input, atmosphere: { rainRateMmH: 0, gases: true, vegetation: false } },
      { altitudeM: 500, speedKmh: 150, initialElevationDeg: 5, initialAzimuthDeg: 90, trajectoryAzimuthDeg: 90, durationS: 120 },
      OPTS,
    )
    expect(withGases.samples[0].pathLossDb).toBeCloseTo(fsplDb(470, 2000) + 1.5, 6)
  })
  it('скорость вне 100–200 км/ч даёт предупреждение', () => {
    const r = simulateDynamics(input, { altitudeM: 500, speedKmh: 90, initialElevationDeg: 5, initialAzimuthDeg: 90, trajectoryAzimuthDeg: 90, durationS: 120 }, OPTS)
    expect(r.warnings.some((w) => w.includes('вне диапазона'))).toBe(true)
  })
  it('выход из зоны связи фиксируется временем и предупреждением', () => {
    const farOpts = { ...OPTS, sensitivityDbm: -60 } // жёсткая чувствительность → быстрый выход
    const r = simulateDynamics(input, { altitudeM: 200, speedKmh: 150, initialElevationDeg: 5, initialAzimuthDeg: 90, trajectoryAzimuthDeg: 90, durationS: 600 }, farOpts)
    expect(r.exitTimeS).not.toBeNull()
    expect(r.warnings.some((w) => w.includes('выходит из зоны'))).toBe(true)
  })
  it('минимальный запас меньше максимального SNR', () => {
    const r = simulateDynamics(input, { altitudeM: 1000, speedKmh: 150, initialElevationDeg: 5, initialAzimuthDeg: 90, trajectoryAzimuthDeg: 90, durationS: 300 }, OPTS)
    const snr0 = r.samples[0].snrDb
    expect(r.minMarginDb).toBeLessThanOrEqual(snr0)
  })
})

describe('trajectoryPoints: траектория на карте', () => {
  it('41 точка, монотонное удаление от Tx', () => {
    const params = { altitudeM: 500, speedKmh: 150, initialElevationDeg: 5, initialAzimuthDeg: 90, trajectoryAzimuthDeg: 45, durationS: 300 }
    const pts = trajectoryPoints({ lat: 55.75, lon: 37.61 }, params)
    expect(pts).toHaveLength(41)
    for (let i = 1; i < pts.length; i++) {
      expect(distanceM({ lat: 55.75, lon: 37.61 }, pts[i])).toBeGreaterThanOrEqual(
        distanceM({ lat: 55.75, lon: 37.61 }, pts[i - 1]),
      )
    }
  })
  it('азимут движения выдерживается', () => {
    const params = { altitudeM: 500, speedKmh: 150, initialElevationDeg: 5, initialAzimuthDeg: 90, trajectoryAzimuthDeg: 90, durationS: 300 }
    const pts = trajectoryPoints({ lat: 55.75, lon: 37.61 }, params)
    expect(pts[pts.length - 1].lon).toBeGreaterThan(37.61)
    expect(Math.abs(pts[pts.length - 1].lat - 55.75)).toBeLessThan(0.01)
  })
})

describe('zoneRadiusM: радиус зоны связи', () => {
  it('согласован с формулой FSPL (обратный расчёт)', () => {
    const opts = { powerDbm: 30, txGainDbi: 10, rxGainDbi: 3, sensitivityDbm: -100, frequencyMhz: 2000, marginDb: 0 }
    const r = zoneRadiusM(opts)
    const fsplMax = 40 + 3 - (-100) // EIRP + G_rx − чувствительность
    const expectedKm = 10 ** ((fsplMax - 20 * Math.log10(2000) - 32.44) / 20)
    expect(r).toBeCloseTo(expectedKm * 1000, 0)
  })
  it('выше частота — меньше радиус', () => {
    const r2 = zoneRadiusM({ powerDbm: 30, txGainDbi: 10, rxGainDbi: 3, sensitivityDbm: -100, frequencyMhz: 2000, marginDb: 0 })
    const r6 = zoneRadiusM({ powerDbm: 30, txGainDbi: 10, rxGainDbi: 3, sensitivityDbm: -100, frequencyMhz: 6000, marginDb: 0 })
    expect(r6).toBeLessThan(r2)
  })
})

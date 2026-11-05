/** Тесты бюджета линии (ТЗ 4.4.4) и доплера (ТЗ 4.5.2). */
import { describe, it, expect } from 'bun:test'
import { computeLinkBudget } from '../src/lib/radio/budget'
import { dopplerLossDb, dopplerToleranceHz, zoneRadiusM } from '../src/lib/radio/doppler'
import type { CalculationInput, EquipmentParams, PropagationResult } from '../src/lib/radio/types'
import { K_BOLTZMANN } from '../src/lib/radio/constants'

const input: CalculationInput = {
  frequencyMhz: 2400,
  polarization: 'vertical',
  path: {
    points: [{ lat: 55.75, lon: 37.62 }, { lat: 55.8, lon: 37.62 }],
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

const prop: PropagationResult = {
  model: 'fspl-p526',
  medianLossDb: 113.3,
  byTimePercent: [{ percent: 50, lossDb: 113.3 }],
  breakdown: { freeSpaceDb: 113.3, diffractionDb: 0 },
  engineUsed: 'test',
  warnings: [],
}

const equipmentSimple: EquipmentParams = {
  mode: 'simple',
  tx: { gainDbi: 10, polarization: 'vertical' },
  rx: { gainDbi: 3, polarization: 'vertical' },
  transmitter: { powerDbm: 30, sensitivityDbm: -100 },
  receiver: { powerDbm: 0, sensitivityDbm: -100, noiseBandwidthHz: 1e6, noiseFigureDb: 5, modulation: 'QPSK', requiredEbN0Db: 9.6 },
}

describe('Бюджет линии (ТЗ 4.4.4)', () => {
  it('EIRP = P_tx + G_tx', () => {
    const b = computeLinkBudget(input, equipmentSimple, prop)
    expect(b.eirpDbm).toBe(40)
  })

  it('P_rx = EIRP − L_path + G_rx', () => {
    const b = computeLinkBudget(input, equipmentSimple, prop)
    expect(b.prxDbm).toBeCloseTo(40 - 113.3 + 3, 5)
  })

  it('N = kTB + NF (подробный режим, B=1 МГц, NF=5)', () => {
    const detailed: EquipmentParams = {
      ...equipmentSimple,
      mode: 'detailed',
      receiver: { ...equipmentSimple.receiver, noiseFigureDb: 5, noiseBandwidthHz: 1e6 },
    }
    const b = computeLinkBudget(input, detailed, prop)
    const ktb = 10 * Math.log10(K_BOLTZMANN * 290 * 1e3) + 60
    expect(b.ktbDbm).toBeCloseTo(ktb, 1)
    expect(b.noisePowerDbm).toBeCloseTo(ktb + 5, 1)
  })

  it('SNR = P_rx − N; link margin = SNR − Eb/N0_req', () => {
    const b = computeLinkBudget(input, equipmentSimple, prop)
    const snr = b.prxDbm - b.noisePowerDbm
    expect(b.snrDb).toBeCloseTo(snr, 5)
    expect(b.linkMarginDb).toBeCloseTo(snr - 9.6, 5)
  })

  it('подробный режим учитывает фидеры и рассогласование', () => {
    const detailed: EquipmentParams = {
      ...equipmentSimple,
      mode: 'detailed',
      tx: { ...equipmentSimple.tx, feederLossDb: 2, mismatchLossDb: 1 },
      rx: { ...equipmentSimple.rx, feederLossDb: 1.5, mismatchLossDb: 0.5 },
    }
    const b = computeLinkBudget(input, detailed, prop)
    expect(b.eirpDbm).toBe(30 - 2 - 1 + 10)
    expect(b.prxDbm).toBeCloseTo(b.eirpDbm - 113.3 + 3 - 1.5 - 0.5, 5)
  })

  it('доплер добавляется в бюджет как потеря', () => {
    const b = computeLinkBudget(input, equipmentSimple, prop, { dopplerLossDb: 4 })
    const bNo = computeLinkBudget(input, equipmentSimple, prop)
    expect(b.prxDbm).toBeCloseTo(bNo.prxDbm - 4, 5)
  })
})

describe('Доплер (ТЗ 4.5.2)', () => {
  it('Δf = (v_r / c) · f: 100 м/с на 1 ГГц → 333.6 Гц', () => {
    const df = (100 / 299_792_458) * 1e9
    expect(df).toBeCloseTo(333.56, 0)
  })

  it('в пределах допуска потери 0', () => {
    expect(dopplerLossDb(100, 1e6, 'QPSK')).toBe(0)
  })

  it('за 4× допуска — срыв демодуляции (99 дБ)', () => {
    const tol = dopplerToleranceHz(1e6, 'QPSK')
    expect(dopplerLossDb(4 * tol + 10, 1e6, 'QPSK')).toBe(99)
  })

  it('допуск для QPSK = 5% полосы', () => {
    expect(dopplerToleranceHz(1e6, 'QPSK')).toBeCloseTo(50_000, 0)
  })

  it('радиус зоны связи по порогу чувствительности', () => {
    const r = zoneRadiusM({ powerDbm: 30, txGainDbi: 10, rxGainDbi: 3, sensitivityDbm: -100, frequencyMhz: 2400, marginDb: 0 })
    // FSPL_max = 143 дБ → d ≈ 10^((143−68.6)/20) ≈ 165 км
    expect(r).toBeGreaterThan(100_000)
    expect(r).toBeLessThan(300_000)
  })
})

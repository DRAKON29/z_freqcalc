/**
 * Тесты шумового порога P.372: фиты Table 1 (P.372-17 §6.1.1), зажим
 * экстраполяции, комбинация шум-факторов (Part 7), порядок окружений.
 * Контрольные значения фитов вычислены из Fam = c − d·lg f.
 */
import { describe, it, expect } from 'bun:test'
import { manMadeNoiseFaDb, systemNoisePowerDbm, P372_MAN_MADE_FITS } from '../src/lib/radio/noise'
import { computeLinkBudget } from '../src/lib/radio/budget'
import { KTB_DBM_HZ } from '../src/lib/radio/constants'
import type { CalculationInput, EquipmentParams, PropagationResult } from '../src/lib/radio/types'

describe('P.372: фиты Table 1', () => {
  it('бизнес (city): Fa(100 МГц) = 76.8 − 27.7·2 = 21.4 дБ', () => {
    expect(manMadeNoiseFaDb('business', 100)).toBeCloseTo(21.4, 6)
  })

  it('жилая застройка: Fa(250 МГц) = 72.5 − 27.7·lg250', () => {
    expect(manMadeNoiseFaDb('residential', 250)).toBeCloseTo(72.5 - 27.7 * Math.log10(250), 6)
  })

  it('сельская: Fa(50 МГц) = 67.2 − 27.7·lg50 ≈ 20.1 дБ', () => {
    expect(manMadeNoiseFaDb('rural', 50)).toBeCloseTo(67.2 - 27.7 * Math.log10(50), 6)
  })

  it('тихая сельская: свой наклон d = 28.6', () => {
    expect(manMadeNoiseFaDb('quiet-rural', 30)).toBeCloseTo(53.6 - 28.6 * Math.log10(30), 6)
  })

  it('порядок окружений: quiet-rural < rural < residential < business', () => {
    const f = 100
    expect(manMadeNoiseFaDb('quiet-rural', f)).toBeLessThan(manMadeNoiseFaDb('rural', f))
    expect(manMadeNoiseFaDb('rural', f)).toBeLessThan(manMadeNoiseFaDb('residential', f))
    expect(manMadeNoiseFaDb('residential', f)).toBeLessThan(manMadeNoiseFaDb('business', f))
  })

  it('экстраполяция за 250 МГц зажата снизу на 0 дБ', () => {
    // rural: фит уходит в минус выше ~267 МГц → в полосе приложения 0
    expect(manMadeNoiseFaDb('rural', 2400)).toBe(0)
    expect(manMadeNoiseFaDb('rural', 500)).toBe(0)
    // business: положителен до ~610 МГц
    expect(manMadeNoiseFaDb('business', 500)).toBeCloseTo(76.8 - 27.7 * Math.log10(500), 6)
    expect(manMadeNoiseFaDb('business', 2400)).toBe(0)
    // не учитывать
    expect(manMadeNoiseFaDb('none', 500)).toBe(0)
  })
})

describe('P.372: комбинация шума антенны и приёмника', () => {
  it('Fa = 0 → N = kTB + NF (прежнее поведение)', () => {
    expect(systemNoisePowerDbm(-113.98, 3, 0)).toBeCloseTo(-113.98 + 3, 6)
  })

  it('Fa = NF = 3 дБ → N = kTB + 10lg(1.9953·2 − 1)', () => {
    const expected = -113.98 + 10 * Math.log10(2 * Math.pow(10, 3 / 10) - 1)
    expect(systemNoisePowerDbm(-113.98, 3, 3)).toBeCloseTo(expected, 9)
  })

  it('Fa >> NF → N ≈ kTB + Fa', () => {
    expect(systemNoisePowerDbm(-113.98, 3, 30)).toBeCloseTo(-113.98 + 30, 1)
  })
})

describe('P.372: бюджет линии с окружением', () => {
  const input: CalculationInput = {
    frequencyMhz: 500,
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

  const makeEquipment = (noiseEnvironment?: EquipmentParams['noiseEnvironment']): EquipmentParams => ({
    mode: 'simple',
    noiseEnvironment,
    tx: { gainDbi: 10, polarization: 'vertical', beamwidthDeg: 360 },
    rx: { gainDbi: 3, polarization: 'vertical', beamwidthDeg: 360 },
    transmitter: { powerDbm: 30, sensitivityDbm: -100 },
    receiver: { powerDbm: 0, sensitivityDbm: -100, noiseBandwidthHz: 1e6, noiseFigureDb: 3, modulation: 'QPSK', requiredEbN0Db: 9.6 },
  })

  it('без окружения бюджет не изменился (контрольные значения)', () => {
    const b = computeLinkBudget(input, makeEquipment(), prop)
    const bNone = computeLinkBudget(input, makeEquipment('none'), prop)
    const bRural = computeLinkBudget(input, makeEquipment('rural'), prop)
    expect(b.noisePowerDbm).toBeCloseTo(KTB_DBM_HZ + 60 + 3, 5)
    expect(bNone.noisePowerDbm).toBeCloseTo(b.noisePowerDbm, 9)
    // rural на 500 МГц фит отрицательный → зажат в 0 → бюджет тот же
    expect(bRural.noisePowerDbm).toBeCloseTo(b.noisePowerDbm, 9)
    expect(b.faDb).toBeUndefined()
  })

  it('бизнес на 500 МГц: Fa = 2.04 дБ → строка в расходе, N вырос', () => {
    const b = computeLinkBudget(input, makeEquipment('business'), prop)
    const fa = manMadeNoiseFaDb('business', 500)
    expect(b.faDb).toBeCloseTo(fa, 9)
    const baseline = computeLinkBudget(input, makeEquipment('none'), prop)
    expect(b.noisePowerDbm).toBeGreaterThan(baseline.noisePowerDbm)
    expect(b.linkMarginDb).toBeCloseTo(baseline.linkMarginDb - (b.noisePowerDbm - baseline.noisePowerDbm), 9)
    const faRow = b.expense.find((r) => r.label === 'Шум антенны Fa (P.372)')
    expect(faRow).toBeDefined()
    expect(faRow!.value).toBeCloseTo(fa, 6)
  })
})

describe('P.372: таблица фитов полная', () => {
  it('четыре окружения + none', () => {
    expect(Object.keys(P372_MAN_MADE_FITS).sort()).toEqual(['business', 'quiet-rural', 'residential', 'rural'])
  })
})

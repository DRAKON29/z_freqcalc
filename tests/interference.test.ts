/**
 * Тесты интерференции C/I (роадмап 2.3): чистая логика отчёта — уровни I
 * с разносом антенн, вердикты по защитным отношениям и деградации шума,
 * фоллбек движка пути помехи.
 */
import { describe, it, expect } from 'bun:test'
import {
  buildInterferenceReport,
  discriminationAngleDeg,
  interferenceImpact,
  interferenceLevel,
  computeInterferencePathLosses,
  INTERFERENCE_IMPACT_LABELS,
  type InterferencePathLosses,
} from '../src/lib/radio/interference'
import type { LatLon } from '../src/lib/radio/types'

const victim: LatLon = { lat: 55.1, lon: 37.0 }
const victimTx: LatLon = { lat: 55.0, lon: 37.0 } // юг от жертвы → луч 180°
const sourceEast: LatLon = { lat: 55.1, lon: 37.2 } // восток от жертвы → ~90°

const directionalAntenna = { gainDbi: 10, polarization: 'vertical' as const, beamwidthDeg: 30, sidelobeDb: -25 }
const omniAntenna = { gainDbi: 10, polarization: 'vertical' as const, beamwidthDeg: 360 }

const losses = (p50: number, p1: number | null = null): InterferencePathLosses => ({
  p50,
  p1,
  engineUsed: 'P.452-18 (Py452, вендоренный порт)',
  warnings: [],
})

describe('interference: discriminationAngleDeg', () => {
  it('угол между лучом жертвы и направлением на помеху', () => {
    expect(discriminationAngleDeg(victimTx, victim, sourceEast)).toBeCloseTo(90, 0)
  })

  it('перенос через 0°/360°: луч ~356.7°, помеха на ~3.3° → угол ~6.6°', () => {
    // жертва в центре; Tx чуть севернее-западнее (луч ≈ 356.7°), помеха
    // севернее-восточнее (направление ≈ 3.3°) — сырой угол 353.4° → 6.6°
    const v = { lat: 55.0, lon: 37.0 }
    const vTx = { lat: 55.01, lon: 36.999 }
    const src = { lat: 55.01, lon: 37.001 }
    const ang = discriminationAngleDeg(vTx, v, src)
    expect(ang).toBeGreaterThan(5)
    expect(ang).toBeLessThan(10)
  })
})

describe('interference: interferenceLevel', () => {
  it('omni: без разноса антенн I = EIRP − L + G', () => {
    const lvl = interferenceLevel(50, 150, 40, 10, omniAntenna.beamwidthDeg, undefined, 90, -110)
    expect(lvl.iDbm).toBeCloseTo(40 - 150 + 10, 3) // −100 дБм
    expect(lvl.inDb).toBeCloseTo(10, 3)
    // деградация: 10lg(1 + 10^1) ≈ 10.41 дБ
    expect(lvl.degradationDb).toBeCloseTo(10 * Math.log10(1 + 10), 2)
    expect(interferenceImpact(lvl.degradationDb)).toBe('severe')
  })

  it('направленная антенна: разнос 90° при луче 30° — кламп на УБЛ (−25 дБ)', () => {
    const lvl = interferenceLevel(50, 150, 40, 10, directionalAntenna.beamwidthDeg, directionalAntenna.sidelobeDb, 90, -110)
    // pointing = 12·(90/30)² = 108 дБ, кламп до 25 дБ (УБЛ)
    expect(lvl.iDbm).toBeCloseTo(40 - 150 + 10 - 25, 3) // −125 дБм
    expect(interferenceImpact(lvl.degradationDb)).toBe('none')
  })

  it('классы влияния по деградации', () => {
    expect(interferenceImpact(0.1)).toBe('none')
    expect(interferenceImpact(0.9)).toBe('minor')
    expect(interferenceImpact(2.5)).toBe('notable')
    expect(interferenceImpact(5)).toBe('severe')
    expect(INTERFERENCE_IMPACT_LABELS.severe).toContain('Сильное')
  })
})

describe('interference: buildInterferenceReport', () => {
  const base = {
    source: sourceEast,
    victimPoint: victim,
    victimTxPoint: victimTx,
    frequencyMhz: 2400,
    carrierDbm: -100,
    noisePowerDbm: -110,
    linkMarginDb: 6,
    requiredEbN0Db: 9.6,
    ciMinDb: null as number | null,
    interferenceEirpDbm: 40,
    victimAntenna: directionalAntenna,
  }

  it('медиана и коротковременная помеха, дефолт C/I_min = Eb/N0', () => {
    const rep = buildInterferenceReport({ ...base, losses: losses(150, 130) })
    expect(rep.engineUsed).toContain('P.452-18')
    expect(rep.median.p).toBe(50)
    expect(rep.shortTerm?.p).toBe(1)
    // коротковременная помеха сильнее (потери ниже) → I выше, деградация больше
    expect(rep.shortTerm!.iDbm).toBeGreaterThan(rep.median.iDbm)
    // C/I = −100 − (−125) = 25 ≥ 9.6 → выполнено
    expect(rep.median.ciDb).toBeCloseTo(25, 3)
    expect(rep.ciMet).toBe(true)
    expect(rep.ciMinSource).toBe('default-ebn0')
    expect(rep.marginWithIDb).toBeCloseTo(6 - rep.median.degradationDb, 3)
  })

  it('пользовательский C/I_min строгий — вердикт не выполнен', () => {
    const rep = buildInterferenceReport({ ...base, losses: losses(150), ciMinDb: 40 })
    expect(rep.ciMinSource).toBe('user')
    expect(rep.ciMinDb).toBe(40)
    expect(rep.ciMet).toBe(false)
  })

  it('без p = 1 % (фоллбек) shortTerm null', () => {
    const rep = buildInterferenceReport({ ...base, losses: losses(150) })
    expect(rep.shortTerm).toBeNull()
  })

  it('деградация поднимает шум: C/(N+I) меньше SNR на Δ', () => {
    const rep = buildInterferenceReport({ ...base, losses: losses(120, 110) })
    // при L=120: I = 40−120+10−25 = −95, I/N = 15 → Δ ≈ 15 дБ
    expect(rep.median.inDb).toBeCloseTo(15, 1)
    expect(rep.snrWithIDb).toBeCloseTo(-100 - (-110 + rep.median.degradationDb), 3)
    expect(rep.marginWithIDb).toBeLessThan(6)
  })
})

describe('interference: фоллбек движка пути', () => {
  it('недоступный сервис → медиана P.2001-lite с предупреждением', async () => {
    const input = {
      frequencyMhz: 2400,
      polarization: 'vertical' as const,
      path: {
        points: [sourceEast, victim],
        distanceM: 40000,
        azimuthDeg: 90,
        profile: [
          { d: 0, elev: 50, clutter: 0, total: 50 },
          { d: 20000, elev: 60, clutter: 0, total: 60 },
          { d: 40000, elev: 50, clutter: 0, total: 50 },
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
    const res = await computeInterferencePathLosses({
      paths: [
        {
          id: 'forward',
          source: sourceEast,
          victim,
          txHeightM: 30,
          rxHeightM: 10,
          profile: { d: [0, 20000, 40000], h: [50, 60, 50], g: [50, 60, 50] },
        },
      ],
      frequencyMhz: 2400,
      polarization: 'vertical',
      zone: 2,
      fallbackInputs: { forward: input },
    })
    const fwd = res.forward
    expect(fwd.engineUsed).toContain('P.2001-lite')
    expect(fwd.warnings.some((w) => w.includes('P.452 недоступен'))).toBe(true)
    expect(fwd.p1).toBeNull()
    expect(Number.isFinite(fwd.p50)).toBe(true)
    expect(fwd.p50).toBeGreaterThan(60)
  })
})

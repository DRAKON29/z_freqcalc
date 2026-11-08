/**
 * Тесты динамики с рельефом (роадмап 2.2):
 *  • потери per-sample ≥ FSPL наклонной дальности (дифракция/рассеяние ≥ 0);
 *  • наведение антенн по текущему углу места: ошибка = |el(t) − initialElevationDeg|,
 *    уравнение бюджета восстанавливается по полям сэмпла;
 *  • omni-антенна (луч ≥ 180°) — наведения нет;
 *  • мягкие предупреждения скоростей на границах 0–300 км/ч;
 *  • requiredTilesForPolyline покрывает ломаную шире хорды.
 * Синтетический DEM детерминирован — числа воспроизводимы.
 */
import { describe, it, expect } from 'bun:test'
import { simulateDynamics, dopplerToleranceHz } from '../src/lib/radio/doppler'
import { pointingLossDb } from '../src/lib/radio/budget'
import { fsplDb } from '../src/lib/radio/fspl'
import { KTB_DBM_HZ, MODULATIONS } from '../src/lib/radio/constants'
import { createSyntheticDem, requiredTilesForPolyline, requiredTilesForTrack } from '../src/lib/radio/terrain'
import { destination } from '../src/lib/radio/coordinates'
import type { CalculationInput, DynamicParams } from '../src/lib/radio/types'

const A = { lat: 55.7558, lon: 37.6173 }

const makeInput = (): CalculationInput => ({
  frequencyMhz: 2400,
  polarization: 'vertical',
  path: {
    points: [A, { lat: 55.8, lon: 37.62 }],
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
})

const makeParams = (over: Partial<DynamicParams> = {}): DynamicParams => ({
  altitudeM: 500,
  speedKmh: 150,
  initialElevationDeg: 5,
  initialAzimuthDeg: 90,
  trajectoryAzimuthDeg: 90,
  durationS: 300,
  ...over,
})

const baseOpts = (over: Record<string, unknown> = {}) => ({
  powerDbm: 30,
  txGainDbi: 10,
  rxGainDbi: 3,
  sensitivityDbm: -100,
  noiseBandwidthHz: 1e6,
  noiseFigureDb: 3,
  modulation: 'QPSK' as const,
  dem: createSyntheticDem(),
  ...over,
})

describe('Динамика с рельефом (2.2): потери per-sample', () => {
  it('pathLossDb ≥ FSPL наклонной дальности для всех сэмплов, и есть вклад рельефа', async () => {
    const dyn = await simulateDynamics(makeInput(), makeParams({ altitudeM: 100 }), baseOpts())
    expect(dyn.samples.length).toBeGreaterThanOrEqual(60)
    let maxExcess = 0
    for (const s of dyn.samples) {
      const pure = fsplDb(s.slantM, 2400)
      expect(s.pathLossDb).toBeGreaterThanOrEqual(pure - 1e-6)
      maxExcess = Math.max(maxExcess, s.pathLossDb - pure)
    }
    // на синтетическом DEM часть лучей пересекает рельеф — дифракция > 0.5 дБ хотя бы где-то
    expect(maxExcess).toBeGreaterThan(0.5)
  })

  it('чем ниже борт, тем хуже минимальный запас (рельеф влияет сильнее)', async () => {
    const high = await simulateDynamics(makeInput(), makeParams({ altitudeM: 2000 }), baseOpts())
    const low = await simulateDynamics(makeInput(), makeParams({ altitudeM: 30 }), baseOpts())
    // оба стартуют из одной точки с одинаковой геометрией старта, но низкий борт
    // собирает больше дифракции по траектории
    expect(low.minMarginDb).toBeLessThanOrEqual(high.minMarginDb)
  })
})

describe('Динамика (2.2): наведение по углу места', () => {
  it('уравнение бюджета восстанавливается из полей сэмпла (ширина луча 30°)', async () => {
    const el0 = 5
    const dyn = await simulateDynamics(
      makeInput(),
      makeParams({ initialElevationDeg: el0 }),
      baseOpts({ txBeamwidthDeg: 30, rxBeamwidthDeg: 30 }),
    )
    const noise = KTB_DBM_HZ + 10 * Math.log10(1e6) + 3
    for (const s of [dyn.samples[0], dyn.samples[Math.floor(dyn.samples.length / 2)], dyn.samples[dyn.samples.length - 1]]) {
      const err = Math.abs(s.elevationDeg - el0)
      const txPoint = pointingLossDb(30, undefined, err)
      const rxPoint = pointingLossDb(30, undefined, err)
      const expected = 30 + 10 - txPoint - s.pathLossDb + 3 - rxPoint - noise - s.dopplerLossDb - MODULATIONS.QPSK.ebN0Db
      expect(s.linkMarginDb).toBeCloseTo(expected, 6)
    }
    // ошибка наведения растёт по траектории (угол места меняется)
    const errFirst = Math.abs(dyn.samples[0].elevationDeg - el0)
    const errLast = Math.abs(dyn.samples[dyn.samples.length - 1].elevationDeg - el0)
    if (errFirst < 1) {
      expect(errLast).toBeGreaterThan(errFirst)
      expect(pointingLossDb(30, undefined, errLast)).toBeGreaterThan(pointingLossDb(30, undefined, errFirst))
    }
  })

  it('omni-антенна (360°) — наведения нет', async () => {
    const dyn = await simulateDynamics(
      makeInput(),
      makeParams({ initialElevationDeg: 0 }),
      baseOpts({ txBeamwidthDeg: 360, rxBeamwidthDeg: 360 }),
    )
    const noise = KTB_DBM_HZ + 10 * Math.log10(1e6) + 3
    const s = dyn.samples[dyn.samples.length - 1]
    const expected = 30 + 10 - s.pathLossDb + 3 - noise - s.dopplerLossDb - MODULATIONS.QPSK.ebN0Db
    expect(s.linkMarginDb).toBeCloseTo(expected, 6)
  })
})

describe('Динамика (2.2): скорости и тайлы', () => {
  it('скорость 400 км/ч даёт мягкое предупреждение (диапазон 0–300)', async () => {
    const dyn = await simulateDynamics(makeInput(), makeParams({ speedKmh: 400 }), baseOpts())
    expect(dyn.warnings.some((w) => w.includes('вне диапазона 0–300'))).toBe(true)
  })

  it('скорость 0 и 300 км/ч — без предупреждения', async () => {
    for (const v of [0, 300]) {
      const dyn = await simulateDynamics(makeInput(), makeParams({ speedKmh: v, durationS: 120 }), baseOpts())
      expect(dyn.warnings.some((w) => w.includes('вне диапазона'))).toBe(false)
    }
  })

  it('ломаная траектория собирает тайлы всех колен (отличается от хорды)', () => {
    // Г-образный маршрут: A → B (в сторону) → C — изгиб уводит из квадратов хорды
    const a = A
    const b = destination(a, 60000, 0)
    const c = destination(b, 60000, 90)
    const polyline = requiredTilesForPolyline([a, b, c])
    const chord = requiredTilesForTrack(a, c)
    // тайлы всех вершин ломаной присутствуют
    expect(polyline).toContain('N55E037')
    expect(polyline).toContain('N56E037')
    expect(polyline).toContain('N56E038')
    // наборы различаются: изгиб собирает квадраты, которых нет на диагонали
    expect(polyline.some((t) => !chord.includes(t))).toBe(true)
  })

  it('прогресс доходит до полного перебора', async () => {
    const progress: Array<{ done: number; total: number }> = []
    await simulateDynamics(makeInput(), makeParams(), baseOpts({ onProgress: (done, total) => progress.push({ done, total }) }))
    expect(progress[progress.length - 1]).toEqual({ done: 301, total: 301 })
  })
})

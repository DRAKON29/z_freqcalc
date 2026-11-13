/**
 * Тесты режимов преград кругового покрытия (этап UX.3, референс antenna.2tg.dev):
 *  • fspl — оптимистичнее model (без дифракции/препятствий);
 *  • geometry — рельеф выше прямой обрывает зону (худший случай);
 *  • fresnel — 0.6·F1 жёстче геометрии, зона не дальше геометрической.
 * DEM — синтетическая горка на трассе A→Б.
 */
import { describe, it, expect } from 'bun:test'
import { computeCoverage, sliceProfile, type CoverageMode } from '../src/lib/radio/coverage'
import { buildProfile, type DemSource } from '../src/lib/radio/terrain'
import { destination, distanceM } from '../src/lib/radio/coordinates'
import { computeFsplP526 } from '../src/lib/radio/p2001lite'
import type { CalculationInput, EquipmentParams } from '../src/lib/radio/types'

/** Плоская земля 50 м с одной гауссовой горкой (250 м) на середине трассы. */
function hillDem(): DemSource {
  const center = { lat: 55.79315, lon: 37.7337 } // середина трассы A→Б ниже
  return {
    name: 'тест-горка',
    resolutionM: 30,
    elevationAt(lat: number, lon: number): number {
      const dx = (lat - center.lat) * 111320
      const dy = (lon - center.lon) * 111320 * Math.cos((center.lat * Math.PI) / 180)
      const d2 = dx * dx + dy * dy
      const sigma = 600 // м
      return 50 + 250 * Math.exp(-d2 / (2 * sigma * sigma))
    },
  }
}

const A = { lat: 55.7558, lon: 37.6173 }
const B = { lat: 55.8305, lon: 37.8501 } // ≈ 18 км

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

function run(mode: CoverageMode, dem: DemSource) {
  const input = makeInput(dem)
  return computeCoverage({ input, dem, equipment, radiusKm: 25, mode, azimuthStepDeg: 30 })
}

describe('coverage modes (UX.3)', () => {
  const dem = hillDem()

  it('модель: горка на трассе даёт дифракцию (fspl-срез ниже)', () => {
    const input = makeInput(dem)
    // Срез до точки ЗА горкой (концы на плоском участке, горка посередине профиля)
    const d = input.path.distanceM - 2000
    const sliced = sliceProfile(input.path.profile, d, 240)
    const full = { ...input, path: { ...input.path, distanceM: d, profile: sliced } }
    const propModel = computeFsplP526(full)
    const propFspl = computeFsplP526(full, { skipDiffraction: true })
    expect(propModel.breakdown.diffractionDb ?? 0).toBeGreaterThan(1)
    expect(propFspl.medianLossDb).toBeLessThan(propModel.medianLossDb - 1)
  })

  it('fspl — оптимистичнее model: зона не меньше', () => {
    const model = run('model', dem)
    const fspl = run('fspl', dem)
    const maxOf = (r: ReturnType<typeof run>) => Math.max(...r.radials.map((x) => x.maxKm ?? 0))
    expect(maxOf(fspl)).toBeGreaterThanOrEqual(maxOf(model))
    expect(fspl.engineUsed).toContain('FSPL')
  })

  it('geometry: в направлении горки зона обрывается до неё, fspl — до края радиуса', () => {
    const fspl = run('fspl', dem)
    const geometry = run('geometry', dem)
    const hillAz = geometry.routeAzDeg
    const radialOf = (r: ReturnType<typeof run>) =>
      r.radials.reduce((best, x) => (Math.abs(x.azDeg - hillAz) < Math.abs(best.azDeg - hillAz) ? x : best))
    const gRadial = radialOf(geometry)
    const fRadial = radialOf(fspl)
    expect(gRadial.maxKm).not.toBeNull()
    expect(gRadial.maxKm!).toBeLessThan(9) // горка ≈ на 8.4 км трассы
    expect(fRadial.maxKm).toBe(25) // без преград FSPL-зона до края радиуса
    // marginAtMaxDb не заполняется в геометрических режимах
    expect(gRadial.marginAtMaxDb).toBeNull()
  })

  it('fresnel (0.6·F1) жёстче геометрии: зона не дальше геометрической', () => {
    const geometry = run('geometry', dem)
    const fresnel = run('fresnel', dem)
    const maxOf = (r: ReturnType<typeof run>) => Math.max(...r.radials.map((x) => x.maxKm ?? 0))
    expect(maxOf(fresnel)).toBeLessThanOrEqual(maxOf(geometry))
  })

  it('model по умолчанию: вызов без mode = режим model', () => {
    const input = makeInput(dem)
    const explicit = computeCoverage({ input, dem, equipment, radiusKm: 25, mode: 'model', azimuthStepDeg: 30 })
    const implicit = computeCoverage({ input, dem, equipment, radiusKm: 25, azimuthStepDeg: 30 })
    expect(implicit.engineUsed).toBe(explicit.engineUsed)
    expect(implicit.stats.maxKm).toBe(explicit.stats.maxKm)
  })
})

/**
 * Локальный движок расчёта (TypeScript):
 * • «FSPL + P.526» — детерминированная модель;
 * • «P.2001-lite» — упрощённая статистическая модель: медиана,
 *    изменчивость во времени (многолучёвость + тропосферное рассеяние).
 *
 * P.2001-lite используется как WASM/браузерный режим P.2001 при недоступности
 * Pyodide/карт ITU с явным предупреждением ( fallback на FSPL + P.526
 * запрещает «молчаливую» подмену — причина фиксируется в warnings).
 */
import { diffractionLossDb } from './diffraction'
import { earthBulgeM } from './fspl'
import { fsplDb } from './fspl'
import { gasesLossDb, rainLossDb, vegetationLossDb } from './atmosphere'
import type { CalculationInput, PropagationResult, TimePercentLoss } from './types'

export interface ClutterEdge {
  d: number
  h: number
}

/** Расстояние до радиогоризонта (k-фактор): 4.12·(√h1 + √h2), км (h в м). */
export function radioHorizonKm(h1M: number, h2M: number, kFactor: number): number {
  const k = Math.max(0.5, kFactor)
  return 4.12 * (Math.sqrt(Math.max(0, h1M)) + Math.sqrt(Math.max(0, h2M))) * Math.sqrt(k / (4 / 3))
}

/** Медианные потери: FSPL + дифракция + тропосферное рассеяние за горизонтом. */
export function medianLossFsplP526(
  input: CalculationInput,
): { lossDb: number; fspl: number; diffraction: number; scatter: number } {
  const freq = input.frequencyMhz
  const d = input.path.distanceM
  const profile = input.path.profile
  const txBase = profile[0]?.elev ?? 0
  const rxBase = profile[profile.length - 1]?.elev ?? 0
  const txH = txBase + input.txHeightM
  const rxH = rxBase + input.rxHeightM

  const fspl = fsplDb(d, freq)
  const diffraction = diffractionLossDb(
    profile.map((p) => ({ d: p.d, elev: p.elev })),
    txH,
    rxH,
    freq,
    input.kFactor,
  )

  // Тропосферное рассеяние — упрощённая аппроксимация P.2001 за радиогоризонтом
  const horizonKm = radioHorizonKm(txH, rxH, input.kFactor)
  const dKm = d / 1000
  const beyond = Math.max(0, dKm - horizonKm)
  // θ — угол рассеяния ≈ (d − d_horizon)/a_e; потери ~ 10lg θ + структурный член
  const scatter = beyond > 0 ? beyond * (0.11 + 0.002 * freq / 1000) + 10 * Math.log10(1 + beyond / horizonKm) : 0

  const lossDb = fspl + diffraction + scatter
  return { lossDb, fspl, diffraction, scatter }
}

/** Потери в clutter: здания — дифракция (P.526), растительность — P.833. */
export function clutterLosses(
  input: CalculationInput,
): { diffractionDb: number; vegetationDb: number; hasBuilding: boolean; hasVegetation: boolean } {
  const freq = input.frequencyMhz
  const txBase = input.path.profile[0]?.elev ?? 0
  const rxBase = input.path.profile[input.path.profile.length - 1]?.elev ?? 0
  const txH = txBase + input.txHeightM
  const rxH = rxBase + input.rxHeightM

  const buildingEdges = input.path.profile
    .filter((p) => p.clutter > 0 && p.d > 0 && p.d < input.path.distanceM)
    .map((p) => ({ d: p.d, h: p.elev + p.clutter }))

  const withBuildings =
    buildingEdges.length > 0
      ? diffractionLossDb(
          input.path.profile.map((p) => ({ d: p.d, elev: p.elev })),
          txH,
          rxH,
          freq,
          input.kFactor,
          buildingEdges,
        )
      : 0

  // Растительность: суммарная длина участков с vegetation-объектами
  let vegDepth = 0
  let hasBuilding = false
  let hasVegetation = false
  const step = input.path.profile.length > 1 ? input.path.profile[1].d - input.path.profile[0].d : 0
  for (const p of input.path.profile) {
    if (p.clutter <= 0) continue
  if (p.d <= 0 || p.d >= input.path.distanceM) continue // точки антенн не учитываем
    hasBuilding = true
    // считаем глубину растительности: height > 3 м и тип неизвестен → как vegetation-полоса
    if (p.clutter > 0) vegDepth += step
  }
  hasVegetation = vegDepth > 0

  const vegetationDb = input.atmosphere.vegetation ? vegetationLossDb(vegDepth, freq) : 0
  // Здания уже учтены в withBuildings через P.526; возвращаем прирост относительно рельефа
  const baseOnly =
    buildingEdges.length > 0
      ? diffractionLossDb(
          input.path.profile.map((p) => ({ d: p.d, elev: p.elev })),
          txH,
          rxH,
          freq,
          input.kFactor,
        )
      : 0
  const diffractionDb = Math.max(0, withBuildings - baseOnly)

  return { diffractionDb, vegetationDb, hasBuilding, hasVegetation }
}

/** Полный расчёт «FSPL + P.526». */
export function computeFsplP526(input: CalculationInput): PropagationResult {
  const warnings: string[] = []
  const freq = input.frequencyMhz
  const { lossDb, fspl, diffraction, scatter } = medianLossFsplP526(input)
  const cl = clutterLosses(input)

  let rainDb = 0
  if (input.atmosphere.rainRateMmH && input.frequencyMhz > 3000) {
    rainDb = rainLossDb(input.path.distanceM, input.atmosphere.rainRateMmH, freq, input.polarization)
  }
  let gasesDb = 0
  if (input.atmosphere.gases) {
    gasesDb = gasesLossDb(input.path.distanceM, freq, 5)
    if (gasesDb <= 0) warnings.push('Упрощённая модель газов P.676 применима до 57 ГГц — вклад не учтён')
  }

  const medianLossDb = lossDb + cl.diffractionDb + cl.vegetationDb + rainDb + gasesDb

  return {
    model: 'fspl-p526',
    medianLossDb,
    byTimePercent: [{ percent: 50, lossDb: medianLossDb }],
    breakdown: {
      freeSpaceDb: fspl,
      diffractionDb: diffraction + cl.diffractionDb,
      troposcatterDb: scatter,
      rainDb: rainDb || undefined,
      gasesDb: gasesDb || undefined,
      vegetationDb: cl.vegetationDb || undefined,
    },
    engineUsed: 'TS: FSPL (P.525) + P.526 + P.838/P.676/P.833',
    warnings,
  }
}

/**
 * P.2001-lite (статистическая модель):
 * медиана из FSPL+P.526, затем изменчивость во времени по многолучёвости
 * (хвост Рэлея, P.530-подобный) и тропосферному рассеянию.
 */
export function computeP2001Lite(input: CalculationInput): PropagationResult {
  const base = computeFsplP526(input)
  const warnings: string[] = [
    'Используется упрощённая статистическая модель P.2001-lite (без цифровых карт ITU).',
  ]

  const txBase = input.path.profile[0]?.elev ?? 0
  const rxBase = input.path.profile[input.path.profile.length - 1]?.elev ?? 0
  const txH = txBase + input.txHeightM
  const rxH = rxBase + input.rxHeightM
  const horizonKm = radioHorizonKm(txH, rxH, input.kFactor)
  const dKm = input.path.distanceM / 1000

  // Вероятность многолучёвости p0 (упрощённо, зависит от климатической зоны и длины)
  const climateFactor: Record<string, number> = { A: 0.2, B: 0.4, C: 0.6, D: 0.8, E: 0.3, F: 0.9, G: 1.2, H: 1.5, J: 1.0, K: 1.1, L: 0.7, M: 0.5, N: 0.4, P: 0.3, Q: 0.35 }
  const cf = climateFactor[input.climateZone] ?? 0.8
  const p0 = cf * Math.pow(dKm / 50, 3) * 0.05 // %
  const multipathActive = p0 > 0.001

  const byTime: TimePercentLoss[] = []
  for (const p of input.timePercents) {
    let delta = 0
    if (p < 50) {
      // Хвост распределения: хуже медианы. Рэлеевский предел 10lg(50/p)
      const rayleigh = 10 * Math.log10(50 / p)
      const reach = multipathActive ? Math.min(1, p0 / 6) : 0.15
      // глубокие фединги при малых p возможны только при многолучёвости
      delta = rayleigh * (0.35 + 0.65 * reach)
    } else {
      // лучше медианы: улучшение за счёт подрефракции/усиления
      delta = -Math.min(4, 2 * Math.log10(p / 50))
    }
    byTime.push({ percent: p, lossDb: base.medianLossDb + delta })
  }

  const medianLossDb = byTime.find((t) => t.percent === 50)?.lossDb ?? base.medianLossDb

  const breakdown = { ...base.breakdown }
  if (multipathActive) breakdown.multipathDb = medianLossDb - base.medianLossDb

  return {
    model: 'p2001',
    medianLossDb,
    byTimePercent: byTime,
    breakdown,
    engineUsed: 'TS: P.2001-lite (статистическая аппроксимация)',
    warnings: [...warnings, ...base.warnings],
  }
}

/**
 * Clearance-аудит трассы (практики MW + P.526): проверка просвета 0.6·F1
 * при рефракции K = 4/3, 2/3 и ∞; вердикт «light/heavy route»; доп.
 * дифракционные потери при подрефракции (K = 2/3 относительно K = 4/3).
 *
 * Выпуклость Земли убывает с ростом K (bulge ∝ 1/k), поэтому просвет
 * монотонен по K: K = ∞ — лучший случай, K = 2/3 — худший.
 */
import { fresnelRadiusM } from './fresnel'
import { earthBulgeM } from './fspl'
import { diffractionLossDb } from './diffraction'
import type { CalculationInput } from './types'

export type ClearanceVerdict = 'clear' | 'marginal' | 'blocked'

export interface ClearanceKResult {
  /** Фактор рефракции (∞ — плоская Земля) */
  k: number
  /** Подпись для UI: «K = 4/3» и т.п. */
  label: string
  /** Минимальное отношение просвет/F1 по трассе (∞ — препятствий нет) */
  minRatio: number
  /** Просвет в худшей точке, м (может быть отрицательным) */
  minClearanceM: number
  /** Расстояние худшей точки от Tx, м */
  worstDm: number
  /** ≥ 0.6·F1 — clear; > 0 — частичный просвет; ≤ 0 — перекрыта */
  verdict: ClearanceVerdict
}

export interface ClearanceAudit {
  ks: ClearanceKResult[]
  /** light — 0.6·F1 выполняется при K = 4/3 и K = 2/3; иначе heavy */
  routeClass: 'light' | 'heavy'
  /** Дифракционные потери при K = 2/3 минус при K = 4/3, дБ (≥ 0) */
  extraDiffractionDb: number
}

/** Проверяемые факторы рефракции (P.530: стандартная, подрефракция, плоская Земля). */
export const CLEARANCE_K_FACTORS: ReadonlyArray<{ k: number; label: string }> = [
  { k: 4 / 3, label: 'K = 4/3' },
  { k: 2 / 3, label: 'K = 2/3' },
  { k: Infinity, label: 'K = ∞' },
]

/** Порог критерия полного просвета: 0.6 первой зоны Френеля. */
export const CLEARANCE_CRITERION = 0.6

/**
 * Аудит просвета по профилю: для каждого K — худшая точка трассы
 * (минимум просвет/F1), вердикт, класс трассы и доп. потери подрефракции.
 */
export function auditClearance(input: CalculationInput): ClearanceAudit {
  const dTotal = input.path.distanceM
  const profile = input.path.profile
  const txBase = profile[0]?.elev ?? 0
  const rxBase = profile[profile.length - 1]?.elev ?? 0
  const txH = txBase + input.txHeightM
  const rxH = rxBase + input.rxHeightM

  const ks: ClearanceKResult[] = CLEARANCE_K_FACTORS.map(({ k, label }) => {
    let minRatio = Infinity
    let minClearanceM = Infinity
    let worstDm = 0
    for (const p of profile) {
      if (p.d <= 0 || p.d >= dTotal) continue // концы профиля — точки антенн
      const los = txH + ((rxH - txH) * p.d) / dTotal
      const clearance = los - earthBulgeM(p.d, dTotal, k) - p.total
      const f1 = fresnelRadiusM(p.d, dTotal, input.frequencyMhz)
      const ratio = f1 > 0 ? clearance / f1 : Infinity
      if (ratio < minRatio) {
        minRatio = ratio
        minClearanceM = clearance
        worstDm = p.d
      }
    }
    if (!Number.isFinite(minRatio)) {
      // Промежуточных точек нет (профиль только из концов) — аудит не применим
      return { k, label, minRatio: Infinity, minClearanceM: Infinity, worstDm: 0, verdict: 'clear' }
    }
    const verdict: ClearanceVerdict = minRatio >= CLEARANCE_CRITERION ? 'clear' : minRatio > 0 ? 'marginal' : 'blocked'
    return { k, label, minRatio, minClearanceM, worstDm, verdict }
  })

  // light: 0.6·F1 и при стандартной рефракции, и при подрефракции (худший случай)
  const routeClass: ClearanceAudit['routeClass'] =
    ks[0].verdict === 'clear' && ks[1].verdict === 'clear' ? 'light' : 'heavy'

  const diffAt = (k: number): number =>
    diffractionLossDb(
      profile.map((p) => ({ d: p.d, elev: p.elev })),
      txH,
      rxH,
      input.frequencyMhz,
      k,
    )
  const extraDiffractionDb = Math.max(0, diffAt(2 / 3) - diffAt(4 / 3))

  return { ks, routeClass, extraDiffractionDb }
}

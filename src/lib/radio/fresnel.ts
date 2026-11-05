/**
 * Зона Френеля (ITU-R P.526 §2.3): радиус первой зоны и клиренс.
 */

/** Радиус первой зоны Френеля на расстоянии d1 от Tx при длине трассы d, м. */
export function fresnelRadiusM(d1: number, dTotal: number, freqMhz: number, n = 1): number {
  const lambda = 299.792458 / freqMhz
  if (d1 <= 0 || d1 >= dTotal || dTotal <= 0) return 0
  return Math.sqrt((n * lambda * d1 * (dTotal - d1)) / dTotal)
}

/** Клиренс LOS над препятствием с учётом кривизны Земли, м (положительный = свободно). */
export function clearanceM(
  hTx: number,
  hRx: number,
  dTotal: number,
  d1: number,
  obstacleH: number,
  kFactor: number,
): number {
  const hLos = hTx + ((hRx - hTx) * d1) / dTotal
  const bulge = (d1 * (dTotal - d1)) / (2 * kFactor * 6371000)
  return hLos - bulge - obstacleH
}

/** Отношение клиренса к радиусу первой зоны Френеля (критерий 0.6F1). */
export function fresnelClearanceRatio(
  hTx: number,
  hRx: number,
  dTotal: number,
  d1: number,
  obstacleH: number,
  kFactor: number,
  freqMhz: number,
): number {
  const F1 = fresnelRadiusM(d1, dTotal, freqMhz)
  if (F1 <= 0) return Infinity
  return clearanceM(hTx, hRx, dTotal, d1, obstacleH, kFactor) / F1
}

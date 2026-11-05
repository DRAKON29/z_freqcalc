/**
 * Модели базовых потерь: FSPL (ITU-R P.525) и рефракция (ITU-R P.453).
 */
import { C_LIGHT } from './constants'

/** Свободное пространство (P.525): Lbf = 20lg(d) + 20lg(f) + 32.44, дБ (d в км, f в МГц). */
export function fsplDb(distanceM: number, frequencyMhz: number): number {
  const dKm = distanceM / 1000
  if (dKm <= 0) return 0
  return 20 * Math.log10(dKm) + 20 * Math.log10(frequencyMhz) + 32.44
}

/**
 * Эффективный радиус Земли с учётом рефракции (P.453):
 * a_e = k * a, где k — фактор рефракции (по умолчанию 4/3).
 */
export function effectiveEarthRadiusM(kFactor: number): number {
  return kFactor * 6371000
}

/**
 * Поправка на кривизну Земли (выпуклость) на расстоянии d1 от передатчика
 * для трассы длиной d: h = d1*(d-d1) / (2*a_e), м.
 */
export function earthBulgeM(d1: number, dTotal: number, kFactor: number): number {
  const ae = effectiveEarthRadiusM(kFactor)
  return (d1 * (dTotal - d1)) / (2 * ae)
}

/**
 * Участие цифровых продуктов ITU-R P.2001-6 (Table 3) в расчёте:
 *  • извлечение параметров среды в точках трассы (среднее концов A и Б);
 *  • k-фактор из градиентов рефракции P.453: k = 157/(157 + ΔN);
 *  • дождь: R(p) по P.837-6 (шаги 3–5) из Pr6, Mt и β; затухание через P.838/P.530;
 *  • высота дождя h0 (P.839-4) — наклонная длина пути в дожде (P.838-3 §1);
 *  • спорадический слой E (Annex G): закон секанса MUF_Es = foEs·sec(i);
 *  • зона TropoClim (Annex E) — климатический коэффициент многолучёвости
 *    (аппроксимация, точные коэффициенты зон — Annex E рекомендации).
 */
import { findItuGridSpec, interpolateItu, type ItuGrid } from './itu-grid'
import type { ItuEnvironmentData, LatLon, Polarization } from './types'

/** Набор загруженных сеток: ключ — каноническое имя файла продукта (Table 3). */
export type ItuGridSet = Record<string, ItuGrid>

/** Метаданные продукта Table 3 для интерфейса. */
export interface ItuProductMeta {
  file: string
  /** Параметр (рус.). */
  param: string
  ref: string
  origin: string
  /** Как продукт участвует в расчёте. */
  usage: string
}

/** Все 14 продуктов Table 3 рекомендации ITU-R P.2001-6. */
export const ITU_PRODUCTS: readonly ItuProductMeta[] = [
  { file: 'DN_Median.txt', param: 'Медианный градиент рефракции ΔN (модуль в файле), N/км', ref: '§ 3.4.1', origin: 'P.453', usage: 'k-фактор медианы: k = 157/(157 + ΔN), ΔN = −|ΔN| — геометрия трассы, дифракция' },
  { file: 'DN_SubSlope.txt', param: 'Наклон подрефрактивной ветви CDF ΔN', ref: '§ 3.4.1', origin: 'P.453', usage: 'Характеристика CDF рефракции; участвует в среде и экспорте' },
  { file: 'DN_SupSlope.txt', param: 'Наклон сверхрефрактивной ветви CDF ΔN', ref: '§ 3.4.1', origin: 'P.453', usage: 'Характеристика CDF рефракции; участвует в среде и экспорте' },
  { file: 'dndz_01.txt', param: 'Градиент ΔN, превышаемый 0.1 % времени, N/км', ref: '§ 3.4.2', origin: 'P.453-10', usage: 'k-фактор для 0.1 % времени — глубокие фединги, сверхрефракция' },
  { file: 'Esarain_Pr6_v5.txt', param: 'Интенсивность дождя Pr6, мм/ч', ref: '§ C.2', origin: 'P.837-5', usage: 'Модель дождя P.837-6: CCDF R(p) из Pr6, Mt и β; затухание через P.838' },
  { file: 'Esarain_Mt_v5.txt', param: 'Суммарная масса дождя Mt, кг·м⁻²·год⁻¹', ref: '§ C.2', origin: 'P.837-5', usage: 'Модель дождя P.837-6: деление на конвективную (Mc = β·Mt) и стратиформную (Ms) части' },
  { file: 'Esarain_Beta_v5.txt', param: 'Вероятность дождя β, доля года 0…1', ref: '§ C.2', origin: 'P.837-5', usage: 'Модель дождя P.837-6: вероятность P0 и R(p); при p > P0 дождя нет' },
  { file: 'h0.txt', param: 'Высота дождя (изотерма 0 °C) h0, км', ref: '§ C.2', origin: 'P.839-4', usage: 'Длина пути в дожде для наклонных трасс: Ls = (h0 − hs)/sin θ (P.838-3)' },
  { file: 'Surfwv_50_fixed.txt', param: 'Плотность водяного пара у поверхности ρ, г/м³', ref: 'Att F', origin: 'P.836-4 (испр.)', usage: 'Затухание в атмосферных газах (P.676) вместо константы 7.5 г/м³' },
  { file: 'FoEs0.1.txt', param: 'foEs, превышаемый 0.1 % времени, МГц', ref: 'Att G', origin: 'P.2001', usage: 'Спорадический слой E: MUF_Es = foEs·sec(i) — диагноз аномальной видимости' },
  { file: 'FoEs01.txt', param: 'foEs, превышаемый 1 % времени, МГц', ref: 'Att G', origin: 'P.2001', usage: 'Спорадический слой E: закон секанса для p = 1 %' },
  { file: 'FoEs10.txt', param: 'foEs, превышаемый 10 % времени, МГц', ref: 'Att G', origin: 'P.2001', usage: 'Спорадический слой E: закон секанса для p = 10 %' },
  { file: 'FoEs50.txt', param: 'foEs, превышаемый 50 % времени, МГц', ref: 'Att G', origin: 'P.2001', usage: 'Спорадический слой E: закон секанса для p = 50 %' },
  { file: 'TropoClim.txt', param: 'Климатическая зона тропосферного рассеяния 1–14', ref: 'Att E', origin: 'P.2001', usage: 'Климатический коэффициент многолучёвости p0 (аппроксимация Annex E)' },
]

/** Канонический ключ продукта по имени файла (регистр не важен). */
export function ituProductKey(name: string): string | undefined {
  const spec = findItuGridSpec(name)
  return spec ? spec.name : undefined
}

/**
 * k-фактор из градиента рефракции (P.453): k = 157/(157 + ΔN), ΔN в N/км.
 * Диапазон ограничен [0.5, 10]: сильная сверхрефракция/волновод (ΔN ≤ −157)
 * даёт k → ∞, для геометрии трассы принимается максимум 10;
 * глубокая подрефракция (ΔN ≥ +157) — минимум 0.5.
 */
export function kFromDn(dn: number): number {
  const k = 157 / (157 + dn)
  // Отрицательный k — сверхрефракция за порогом волновода (ΔN < −157): максимум 10
  if (!Number.isFinite(k) || k <= 0) return 10
  return Math.min(Math.max(k, 0.5), 10)
}

/** Среднее двух значений, если хотя бы одно определено. */
function avg2(a?: number, b?: number): number | undefined {
  if (a === undefined && b === undefined) return undefined
  if (a === undefined) return b
  if (b === undefined) return a
  return (a + b) / 2
}

/** Интерполяция из сетки с усреднением по концам трассы. */
function sampleGrid(grid: ItuGrid, a: LatLon, b: LatLon): number {
  return (interpolateItu(grid, a.lat, a.lon) + interpolateItu(grid, b.lat, b.lon)) / 2
}

/**
 * Извлечение условий в точках трассы из загруженных продуктов.
 * Скалярные поля — среднее концов A и Б; зона TropoClim — ближайший узел в середине трассы.
 */
export function ituEnvironmentAt(grids: ItuGridSet, a: LatLon, b: LatLon): ItuEnvironmentData {
  const env: ItuEnvironmentData = { usedProducts: [] }
  const mid: LatLon = { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 }
  const g = (file: string) => grids[file]

  const dnMedianG = g('DN_Median.txt')
  if (dnMedianG) {
    // Файл хранит МОДУЛЬ медианного градиента (положительный, напр. 37.6 для Москвы):
    // фактический градиент отрицательный — ΔN = −|ΔN| (P.453: рефракция — падение N с высотой)
    env.dnMedian = -sampleGrid(dnMedianG, a, b)
    env.k50 = kFromDn(env.dnMedian)
    env.usedProducts.push('DN_Median.txt')
  }
  const dndz01G = g('dndz_01.txt')
  if (dndz01G) {
    // dndz_01 хранит знаковое значение (отрицательное, напр. −281 N/км для Москвы)
    env.dndz01 = sampleGrid(dndz01G, a, b)
    env.k01 = kFromDn(env.dndz01)
    env.usedProducts.push('dndz_01.txt')
  }
  const subG = g('DN_SubSlope.txt')
  if (subG) {
    env.dnSubSlope = sampleGrid(subG, a, b)
    env.usedProducts.push('DN_SubSlope.txt')
  }
  const supG = g('DN_SupSlope.txt')
  if (supG) {
    env.dnSupSlope = sampleGrid(supG, a, b)
    env.usedProducts.push('DN_SupSlope.txt')
  }
  const rhoG = g('Surfwv_50_fixed.txt')
  if (rhoG) {
    env.rho50 = sampleGrid(rhoG, a, b)
    env.usedProducts.push('Surfwv_50_fixed.txt')
  }
  const prG = g('Esarain_Pr6_v5.txt')
  if (prG) {
    env.pr6 = sampleGrid(prG, a, b)
    env.usedProducts.push('Esarain_Pr6_v5.txt')
  }
  const mtG = g('Esarain_Mt_v5.txt')
  if (mtG) {
    env.rainMassMt = sampleGrid(mtG, a, b)
    env.usedProducts.push('Esarain_Mt_v5.txt')
  }
  const betaG = g('Esarain_Beta_v5.txt')
  if (betaG) {
    env.beta0 = sampleGrid(betaG, a, b)
    env.usedProducts.push('Esarain_Beta_v5.txt')
  }
  // Производные P.837-6 (шаги 3–5): P0 и R0.01 — если есть все три файла дождя
  if (env.pr6 !== undefined && env.rainMassMt !== undefined && env.beta0 !== undefined) {
    const p0 = rainProbP0FromItu(env.pr6, env.rainMassMt, env.beta0)
    env.rainProbP0 = p0
    env.rainRate001 = p0 > 0 && env.pr6 > 0 ? ituRainRateForPercent(env, 0.01) : 0
  }
  const h0G = g('h0.txt')
  if (h0G) {
    env.isothermH0Km = sampleGrid(h0G, a, b)
    env.usedProducts.push('h0.txt')
  }
  const tropoG = g('TropoClim.txt')
  if (tropoG) {
    env.tropoZone = Math.round(interpolateItu(tropoG, mid.lat, mid.lon))
    env.usedProducts.push('TropoClim.txt')
  }
  const foEs001G = g('FoEs0.1.txt')
  if (foEs001G) {
    env.foEs001 = sampleGrid(foEs001G, a, b)
    env.usedProducts.push('FoEs0.1.txt')
  }
  const foEs01G = g('FoEs01.txt')
  if (foEs01G) {
    env.foEs01 = sampleGrid(foEs01G, a, b)
    env.usedProducts.push('FoEs01.txt')
  }
  const foEs10G = g('FoEs10.txt')
  if (foEs10G) {
    env.foEs10 = sampleGrid(foEs10G, a, b)
    env.usedProducts.push('FoEs10.txt')
  }
  const foEs50G = g('FoEs50.txt')
  if (foEs50G) {
    env.foEs50 = sampleGrid(foEs50G, a, b)
    env.usedProducts.push('FoEs50.txt')
  }
  return env
}

/**
 * k-фактор для процента времени p: лог-интерполяция между k(0.1 %) из dndz_01
 * и k(50 %) из DN_Median (CDF рефракции аппроксимируется в лог p).
 * При наличии только одного опорного значения — константа.
 */
export function kForPercent(env: ItuEnvironmentData, p: number): number | undefined {
  const { k50, k01 } = env
  if (k50 === undefined && k01 === undefined) return undefined
  if (k50 === undefined) return k01
  if (k01 === undefined) return k50
  const pc = Math.min(Math.max(p, 0.1), 50)
  const t = Math.log10(pc / 0.1) / Math.log10(50 / 0.1) // 0 → 0.1 %, 1 → 50 %
  return k01 + (k50 - k01) * t
}

/**
 * Вероятность дождя P0, % (P.837-6, шаг 4):
 * P0 = Pr6·(1 − e^(−0.0079·Ms/Pr6)), где Ms = (1 − β)·Mt — стратиформная масса.
 * Pr6 = 0 → дождя нет (P0 = 0).
 */
export function rainProbP0FromItu(pr6: number, mt: number, beta: number): number {
  if (pr6 <= 0) return 0
  const ms = Math.max(0, (1 - beta)) * mt
  const p0 = pr6 * (1 - Math.exp((-0.0079 * ms) / pr6))
  return Math.min(Math.max(p0, 0), 100)
}

/**
 * Интенсивность дождя R(p), мм/ч, превышаемая p % среднего года
 * (P.837-6, шаг 5, уравнения 2, 2a–2f) из Pr6, Mt и β:
 *   Mc = β·Mt, Ms = (1 − β)·Mt;  P0 = Pr6·(1 − e^(−0.0079·Ms/Pr6));
 *   a = 1.09;  b = (Mc + Ms)/(21797·P0);  c = 26.02·b;
 *   A = a·b;  B = a + c·ln(p/P0);  C = ln(p/P0);
 *   R(p) = (−B + √(B² − 4AC))/(2A)  для p ≤ P0; при p > P0 дождя нет (0).
 * Если Mt/β не загружены — используется только Pr6 как R0.01-оценка
 * (консервативно, с порогом p ≤ 0.0685 % ≈ 6 ч/год).
 */
export function ituRainRateForPercent(env: ItuEnvironmentData, p: number): number {
  const { pr6, rainMassMt, beta0 } = env
  if (pr6 === undefined || pr6 <= 0) return 0
  if (rainMassMt === undefined || beta0 === undefined) {
    // Fallback: Pr6 как консервативная оценка для редких превышений (≈6 ч/год)
    return p <= 0.0685 ? pr6 : 0
  }
  const mc = Math.max(0, beta0) * rainMassMt
  const ms = Math.max(0, 1 - beta0) * rainMassMt
  const p0 = rainProbP0FromItu(pr6, rainMassMt, beta0)
  if (p0 <= 0 || p > p0) return 0
  const pc = Math.min(Math.max(p, 1e-6), p0)
  const b = (mc + ms) / (21797 * p0)
  const a = 1.09
  const c = 26.02 * b
  const ln = Math.log(pc / p0)
  const A = a * b
  const B = a + c * ln
  const C = ln
  const disc = B * B - 4 * A * C
  if (A <= 0 || disc < 0) return 0
  return (-B + Math.sqrt(disc)) / (2 * A)
}

/** Высота дождя: изотерма 0 °C h0 (P.839-4), км; undefined — не загружена. */
export function rainHeightKm(env: ItuEnvironmentData): number | undefined {
  return env.isothermH0Km
}

/**
 * Наклонная длина пути в дожде (P.838-3 §1): Ls = (hR − hs)/sin θ,
 * ограничена длиной трассы и положительностью. θ — угол места, град.
 */
export function slantRainPathM(
  distanceM: number,
  stationHeightM: number,
  rainHeightKmValue: number,
  elevationDeg: number,
): number {
  const sinEl = Math.sin((Math.max(elevationDeg, 0.5) * Math.PI) / 180)
  if (sinEl <= 0) return distanceM
  const ls = ((rainHeightKmValue * 1000 - stationHeightM) / sinEl)
  if (!Number.isFinite(ls) || ls <= 0) return distanceM
  return Math.min(distanceM, ls)
}

/**
 * foEs для процента времени p: ближайший меньший доступный перцентиль
 * (0.1 → 0.1 %, 1 → 1 %, 10 → 10 %, иначе 50 %).
 */
export function foEsForPercent(env: ItuEnvironmentData, p: number): number | undefined {
  if (p <= 0.3) return env.foEs001 ?? env.foEs01 ?? env.foEs10 ?? env.foEs50
  if (p <= 5) return env.foEs01 ?? env.foEs10 ?? env.foEs50
  if (p <= 30) return env.foEs10 ?? env.foEs50
  return env.foEs50
}

/** Высота спорадического слоя E (км, типовое значение). */
export const ES_LAYER_HEIGHT_KM = 110

/**
 * MUF спорадического слоя E для трассы (закон секанса, односкачковая модель):
 * MUF_Es = foEs(p) · sec(i), sec(i) = √(1 + (d/(2·h_Es))²), d и h в км.
 * При f ≤ MUF_Es возможна аномально малая потеря на трассе (Es-мода).
 */
export function esModeMufMhz(
  env: ItuEnvironmentData,
  p: number,
  distanceM: number,
  hEsKm = ES_LAYER_HEIGHT_KM,
): { foEsMhz?: number; mufMhz?: number } {
  const foEs = foEsForPercent(env, p)
  if (foEs === undefined) return {}
  const dKm = distanceM / 1000
  const secI = Math.sqrt(1 + Math.pow(dKm / (2 * hEsKm), 2))
  return { foEsMhz: foEs, mufMhz: foEs * secI }
}

/**
 * Аппроксимация климатического коэффициента многолучёвости p0 по зоне TropoClim
 * (Annex E P.2001-6): три класса от полярных к тропическим зонам.
 * Значения — документированная аппроксимация (±30 %); точные параметры зон —
 * Annex E рекомендации. Номер зоны всегда сохраняется в среде расчёта.
 */
export const TROPO_ZONE_MULT: Record<number, number> = (() => {
  const m: Record<number, number> = {}
  for (let z = 1; z <= 14; z++) {
    m[z] = z <= 4 ? 0.7 : z <= 9 ? 1.0 : 1.3
  }
  return m
})()

/** Множитель p0 для зоны (1 — вне диапазона 1–14). */
export function tropoZoneMultiplier(zone: number | undefined): number {
  if (zone === undefined) return 1
  return TROPO_ZONE_MULT[zone] ?? 1
}

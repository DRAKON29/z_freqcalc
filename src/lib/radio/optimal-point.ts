/**
 * Поиск оптимальной позиции точки A (наземный Tx) в заданном радиусе —
 * перебор потенциальных позиций по полярной сетке (кольца 0.25R–R) с
 * полной оценкой линии для каждой позиции.
 *
 * Все параметры связи и приёмо-передатчиков берутся из выполненного расчёта
 * (baseInput + equipment); меняется только позиция точки A — профиль трассы
 * перестраивается по рельефу для каждой кандидатной точки. Оценка выполняется
 * локальной TS-моделью (той же по формулам, что выбрана пользователем) —
 * для интерактивности перебора.
 */
import { destination, distanceM, bearingDeg, wgs84ToSk42 } from './coordinates'
import { buildProfile, type DemSource } from './terrain'
import { computeP2001Lite, computeFsplP526 } from './p2001lite'
import { computeLinkBudget } from './budget'
import type { CalculationInput, EquipmentParams, ModelId } from './types'

/** Сэмплер clutter (высоты зданий/растительности в точке). */
type ClutterSampler = (lat: number, lon: number) => { type: string; height: number } | null

/** Ограничение радиуса поиска, м (по ТЗ — не более 5000). */
export const SEARCH_MAX_RADIUS_M = 5000
/** Минимальный осмысленный радиус, м. */
export const SEARCH_MIN_RADIUS_M = 50

/** Кольца поиска (доли радиуса) и число азимутов на каждом. */
export const SEARCH_RINGS: ReadonlyArray<{ fraction: number; azimuths: number }> = [
  { fraction: 0.25, azimuths: 8 },
  { fraction: 0.5, azimuths: 12 },
  { fraction: 0.75, azimuths: 16 },
  { fraction: 1, azimuths: 24 },
]

/** Результат оценки одной кандидатной позиции точки A. */export interface SearchPointResult {
  lat: number
  lon: number
  /** СК-42 Гаусс–Крюгер: X (норотирование), м */
  x42: number
  /** СК-42 Гаусс–Крюгер: Y с номером зоны, м */
  y42: number
  /** Зона СК-42 */
  zone: number
  /** Расстояние от исходной точки A, м */
  distFromOriginalM: number
  /** Медианные потери, дБ */
  medianLossDb: number
  /** P_rx, дБм */
  prxDbm: number
  /** Link margin, дБ (критерий оптимальности) */
  linkMarginDb: number
  /** Исходная позиция точки A (базовая для сравнения) */
  isBaseline: boolean
}

/** Итог поиска оптимальной позиции. */
export interface SearchReport {
  /** Исходная позиция точки A — базовая для сравнения */
  baseline: SearchPointResult
  /** Кандидаты (без baseline), отсортированы по запасу по убыванию */
  points: SearchPointResult[]
  /** Число позиций лучше исходной (оптимальных) */
  optimalCount: number
  /** Радиус поиска, м (после ограничения) */
  radiusM: number
  /** Всего просчитано позиций (включая исходную) */
  candidatesTotal: number
}

/**
 * Кандидатные позиции: исходная точка + кольца 0.25R/0.5R/0.75R/R
 * с 8/12/16/24 азимутами. Итого 61 позиция на любой радиус.
 */
export function buildSearchPoints(center: { lat: number; lon: number }, radiusM: number): Array<{ lat: number; lon: number }> {
  const pts: Array<{ lat: number; lon: number }> = [center]
  for (const { fraction, azimuths } of SEARCH_RINGS) {
    for (let k = 0; k < azimuths; k++) {
      pts.push(destination(center, radiusM * fraction, (360 * k) / azimuths))
    }
  }
  return pts
}

/** СК-42 координата строкой — ровно 7 цифр (метры). */
export function fmtSk42SevenDigits(value: number): string {
  return String(Math.round(value)).padStart(7, '0')
}

/**
 * Перебор кандидатных позиций точки A с полной оценкой линии.
 * Модель — локальная TS (p2001-lite или FSPL+P.526, по modelName); ITM локальной
 * реализации не имеет (роадмап 2.1) — оценивается P.2001-lite.
 */
export async function searchOptimalPointA(
  baseInput: CalculationInput,
  equipment: EquipmentParams,
  dem: DemSource,
  clutterSampler: ClutterSampler | undefined,
  radiusM: number,
  modelName: ModelId,
  onProgress?: (done: number, total: number) => void,
): Promise<SearchReport> {
  const radius = Math.min(SEARCH_MAX_RADIUS_M, Math.max(SEARCH_MIN_RADIUS_M, radiusM))
  const pointB = baseInput.path.points[1]
  const candidates = buildSearchPoints(baseInput.path.points[0], radius)
  const results: SearchPointResult[] = []

  for (let i = 0; i < candidates.length; i++) {
    const p = candidates[i]
    const profile = buildProfile(p, pointB, dem, clutterSampler)
    const input: CalculationInput = {
      ...baseInput,
      path: {
        points: [p, pointB],
        distanceM: distanceM(p, pointB),
        azimuthDeg: bearingDeg(p, pointB),
        profile,
        demStepM: baseInput.path.demStepM,
        demSource: baseInput.path.demSource,
      },
    }
    const prop = modelName === 'fspl-p526' ? computeFsplP526(input) : computeP2001Lite(input)
    const budget = computeLinkBudget(input, equipment, prop)
    const sk = wgs84ToSk42(p)
    results.push({
      lat: p.lat,
      lon: p.lon,
      x42: Math.round(sk.x),
      y42: Math.round(sk.y),
      zone: sk.zone,
      distFromOriginalM: distanceM(baseInput.path.points[0], p),
      medianLossDb: prop.medianLossDb,
      prxDbm: budget.prxDbm,
      linkMarginDb: budget.linkMarginDb,
      isBaseline: i === 0,
    })

    // Отдаём поток UI каждые несколько позиций, чтобы не блокировать вкладку
    if (i % 8 === 7) {
      onProgress?.(i + 1, candidates.length)
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  onProgress?.(candidates.length, candidates.length)

  const baseline = results[0]
  const others = results.slice(1).sort((a, b) => b.linkMarginDb - a.linkMarginDb)
  const optimalCount = others.filter((r) => r.linkMarginDb > baseline.linkMarginDb + 0.05).length
  return { baseline, points: others, optimalCount, radiusM: radius, candidatesTotal: candidates.length }
}

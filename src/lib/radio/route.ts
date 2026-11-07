/**
 * Маршрут из файла траектории (образец — .rt, расширение любое, структура строго JSON):
 *   { "route": { "points": [ { "lat", "lon", "altitude", "speed" } ] }, "tripodHeight": 4 }
 * Первая и последняя точки — концы траектории, между ними промежуточные.
 * Скорость точки действует на участке от неё до следующей; высота внутри
 * участка интерполируется линейно.
 */
import { bearingDeg, distanceM } from './coordinates'
import { routeFileSchema } from './validation'
import type { LatLon, RouteData, RouteWaypoint } from './types'

/** Максимальная длительность прохождения маршрута (как у durationS динамики). */
export const MAX_ROUTE_DURATION_S = 3600

/** Результат разбора файла маршрута. */
export type RouteParseResult = { ok: true; data: RouteData } | { ok: false; error: string }

/** Разбор файла траектории: JSON.parse → zod-схема → контроль суммарной длительности. */
export function parseRouteFile(text: string, name?: string): RouteParseResult {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, error: 'Файл не является корректным JSON' }
  }
  const parsed = routeFileSchema.safeParse(json)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
  }
  const points: RouteWaypoint[] = parsed.data.route.points.map((p) => ({
    lat: p.lat,
    lon: p.lon,
    altitudeM: p.altitude,
    speedKmh: p.speed,
  }))
  const route: RouteData = { name, points, tripodHeightM: parsed.data.tripodHeight }
  const durationS = routeDurationS(route)
  if (!isFinite(durationS) || durationS <= 0) {
    return { ok: false, error: 'Нулевая длина маршрута: точки совпадают' }
  }
  if (durationS > MAX_ROUTE_DURATION_S) {
    return {
      ok: false,
      error: `Длительность прохождения маршрута ${(durationS / 60).toFixed(1)} мин превышает 1 час`,
    }
  }
  return { ok: true, data: route }
}

/** Участок маршрута: от точки до следующей, со временем начала. */
interface RouteSegment {
  from: RouteWaypoint
  to: RouteWaypoint
  lengthM: number
  durationS: number
  courseDeg: number
  tStartS: number
}

/** Кэш сегментации маршрута (позиции не меняются — считаем один раз). */
const segmentsCache = new WeakMap<RouteData, { segments: RouteSegment[]; durationS: number }>()

/** Разбиение маршрута на участки с накопленным временем (кэшируется). */
function routeSegments(route: RouteData): { segments: RouteSegment[]; durationS: number } {
  const cached = segmentsCache.get(route)
  if (cached) return cached
  const segments: RouteSegment[] = []
  let tStart = 0
  for (let i = 0; i < route.points.length - 1; i++) {
    const from = route.points[i]
    const to = route.points[i + 1]
    const lengthM = distanceM(from, to)
    const speedMs = from.speedKmh / 3.6
    const durationS = speedMs > 0 ? lengthM / speedMs : 0
    segments.push({ from, to, lengthM, durationS, courseDeg: bearingDeg(from, to), tStartS: tStart })
    tStart += durationS
  }
  const result = { segments, durationS: tStart }
  segmentsCache.set(route, result)
  return result
}

/** Полная длительность прохождения маршрута, с. */
export function routeDurationS(route: RouteData): number {
  return routeSegments(route).durationS
}

/** Состояние объекта на маршруте в момент t, с (за пределами — кламп к концам). */
export interface RouteStateAt {
  pos: LatLon
  altitudeM: number
  /** Путевая скорость участка, км/ч */
  speedKmh: number
  /** Путевая скорость, м/с */
  speedMs: number
  /** Вертикальная скорость, м/с (со знаком) */
  dhDtMs: number
  /** Курс (азимут движения участка), град */
  courseDeg: number
}

export function routeStateAt(route: RouteData, t: number): RouteStateAt {
  const { segments, durationS } = routeSegments(route)
  const tc = t < 0 ? 0 : t > durationS ? durationS : t

  // Первый участок, покрывающий tc; при tc = T — последний ненулевой
  let idx = segments.findIndex((seg) => tc < seg.tStartS + seg.durationS)
  if (idx === -1) {
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i].durationS > 0) {
        idx = i
        break
      }
    }
    if (idx === -1) idx = segments.length - 1
  }
  const seg = segments[idx]
  const local = seg.durationS > 0 ? (tc - seg.tStartS) / seg.durationS : 0
  const s = Math.max(0, Math.min(1, local))

  const pos: LatLon = {
    lat: seg.from.lat + (seg.to.lat - seg.from.lat) * s,
    lon: seg.from.lon + (seg.to.lon - seg.from.lon) * s,
  }
  const dhDtMs = seg.durationS > 0 ? (seg.to.altitudeM - seg.from.altitudeM) / seg.durationS : 0

  return {
    pos,
    altitudeM: seg.from.altitudeM + (seg.to.altitudeM - seg.from.altitudeM) * s,
    speedKmh: seg.from.speedKmh,
    speedMs: seg.from.speedKmh / 3.6,
    dhDtMs,
    courseDeg: seg.courseDeg,
  }
}

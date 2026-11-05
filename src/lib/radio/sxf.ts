/**
 * Конвертация SXF/RSC (КБ «Панорама») в GeoJSON средствами приложения.
 *
 * Формат SXF — бинарный: паспорт карты (1024 байта) + записи объектов.
 * Координаты метрики — СК-42, проекция Гаусса–Крюгера, метры:
 * x — север (от экватора), y — восток (ложный восток 500 км + номер зоны×1e6).
 *
 * Парсер реализован «по худшему случаю»: сверяются несколько известных
 * вариантов сигнатуры и смещений заголовков записей; при несовпадении
 * возвращается понятная ошибка, а не кривые данные.
 */
import { sk42ToWgs84 } from './coordinates'
import type { ClutterGeoJson } from './terrain'

/** Коды классификатора «Панорама» (упрощённая группа) → тип clutter и типовая высота, м. */
export const SXF_CODE_MAP: Record<number, { type: 'building' | 'vegetation'; height: number; label: string }> = {
  7: { type: 'building', height: 12, label: 'Жилая застройка (многоэтажная)' },
  8: { type: 'building', height: 9, label: 'Жилая застройка (1–2 этажа)' },
  9: { type: 'building', height: 20, label: 'Высотная застройка' },
  10: { type: 'building', height: 6, label: 'Сельская застройка' },
  11: { type: 'building', height: 15, label: 'Промышленные здания' },
  20: { type: 'vegetation', height: 15, label: 'Лес хвойный' },
  21: { type: 'vegetation', height: 12, label: 'Лес лиственный' },
  22: { type: 'vegetation', height: 10, label: 'Лес смешанный' },
  23: { type: 'vegetation', height: 4, label: 'Кустарник' },
  24: { type: 'vegetation', height: 1.5, label: 'Травяная растительность' },
}

export interface SxfPassport {
  version: number
  projection: 'gauss-kruger' | 'other'
  scale: number
  zone: number
}

export interface SxfObject {
  code: number
  /** 0 — линейная, 1 — площадная, 2 — точечная, 3 — текст */
  metricType: number
  /** Контуры в метрах СК-42: x — север, y — восток (с зоной) */
  contours: Array<Array<[number, number]>>
}

export interface SxfParseResult {
  passport: SxfPassport
  objects: SxfObject[]
}

const AREA = 1
const LINE = 0
const POINT = 2

/** Распознавание сигнатуры SXF. Возвращает смещение паспорта (0) или -1. */
function findSignature(view: DataView): number {
  if (view.byteLength < 1024) return -1
  // Классическая сигнатура v4: 0x00304453 (little-endian) или ASCII "SXF"
  const le0 = view.getUint32(0, true)
  const b = [view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)]
  if (le0 === 0x00304453) return 0
  if (b[0] === 0x53 && b[1] === 0x58 && b[2] === 0x46) return 0 // "SXF\0" / "SXF?"
  // Некоторые генераторы пишут ASCII "SXF" со смещением 0 в другом регистре
  if (b[0] === 0x73 && b[1] === 0x78 && b[2] === 0x66) return 0
  return -1
}

/** Разбор паспорта (первые 1024 байта). */
function parsePassport(view: DataView): SxfPassport {
  const safeI32 = (off: number) => (off + 4 <= view.byteLength ? view.getInt32(off, true) : 0)
  const version = safeI32(0x04)
  const projFlag = safeI32(0x08)
  const scale = Math.abs(safeI32(0x38)) || Math.abs(safeI32(0x10)) || 100000
  return {
    version: version > 0 && version < 100 ? version : 4,
    projection: projFlag === 1 ? 'gauss-kruger' : 'other',
    scale,
    zone: 0,
  }
}

/** Разбор записей объектов (после паспорта). */
function parseRecords(view: DataView, passport: SxfPassport): SxfObject[] {
  const objects: SxfObject[] = []
  let off = 1024
  const end = view.byteLength

  while (off + 32 <= end) {
    const recLen = view.getInt32(off, true)
    if (recLen < 32 || off + recLen > end) break
    const metricType = view.getInt16(off + 16, true)
    const countPoint = view.getInt32(off + 20, true)
    const pointSize = view.getInt16(off + 24, true)
    // Код объекта: ищем правдоподобное поле (заголовок записи вариант A: 8..12)
    let code = view.getInt32(off + 8, true)
    if (code <= 0 || code > 400000) code = view.getInt16(off + 4, true) & 0xffff
    if (code <= 0 || code > 400000) code = 0

    const size = pointSize === 16 ? 16 : 8
    if (countPoint > 0 && metricType >= 0 && metricType <= 3) {
      const contours: Array<Array<[number, number]>> = []
      // Точки основной метрики: int32 x (север), int32 y (восток) [, float H]
      const ptsStart = off + 32
      const contour: Array<[number, number]> = []
      let ok = true
      for (let i = 0; i < countPoint; i++) {
        const p = ptsStart + i * size
        if (p + 8 > off + recLen) {
          ok = false
          break
        }
        const x = view.getInt32(p, true)
        const y = view.getInt32(p + 4, true)
        if (!isFinite(x) || !isFinite(y) || Math.abs(x) > 2e7 || Math.abs(y) > 2e7) {
          ok = false
          break
        }
        contour.push([x, y])
      }
      if (ok && contour.length >= 1) {
        contours.push(contour)
        // Подобъекты: ищем доп. контуры в остатке записи (упрощённо: сплошной поток точек)
        const used = 32 + countPoint * size
        let extra = off + used
        const subjCount = view.getInt16(off + 18, true)
        for (let s = 0; s < subjCount && extra + 16 <= off + recLen; s++) {
          const subjLen = view.getInt32(extra, true)
          const subjPts = view.getInt32(extra + 8, true)
          const subjSize = view.getInt16(extra + 12, true) || size
          if (subjLen <= 0 || extra + subjLen > off + recLen) break
          const sub: Array<[number, number]> = []
          for (let i = 0; i < subjPts; i++) {
            const p = extra + 16 + i * subjSize
            if (p + 8 > extra + subjLen) break
            const x = view.getInt32(p, true)
            const y = view.getInt32(p + 4, true)
            if (Math.abs(x) > 2e7 || Math.abs(y) > 2e7) break
            sub.push([x, y])
          }
          if (sub.length >= 2) contours.push(sub)
          extra += subjLen
        }
        objects.push({ code, metricType, contours })
      }
    }
    off += recLen
  }
  passport.zone = objects[0]?.contours[0] ? Math.floor(objects[0].contours[0][0][1] / 1e6) : 0
  return objects
}

/** Разбор SXF (ArrayBuffer). */
export function parseSxf(buffer: ArrayBuffer): SxfParseResult {
  const view = new DataView(buffer)
  if (findSignature(view) < 0) {
    throw new Error(
      'Файл не распознан как SXF: не найдена сигнатура. Убедитесь, что это двоичный файл SXF (КБ «Панорама»), а не экспорт в другом формате.',
    )
  }
  const passport = parsePassport(view)
  const objects = parseRecords(view, passport)
  if (objects.length === 0) {
    throw new Error('В SXF не найдено ни одного объекта: файл повреждён или имеет нестандартную структуру записей.')
  }
  return { passport, objects }
}

/** Чтение имён объектов из RSC-классификатора (текстовые секции, cp1251) — best effort. */
export function parseRscNames(buffer: ArrayBuffer): Record<number, string> {
  const names: Record<number, string> = {}
  try {
    const text = new TextDecoder('windows-1251').decode(buffer)
    let inObjects = false
    let current: number | null = null
    for (const raw of text.split(/\r?\n/)) {
      const s = raw.trim()
      const up = s.toUpperCase()
      if (up.startsWith('OBJECT')) {
        inObjects = true
        continue
      }
      if (inObjects && up.startsWith('END')) {
        inObjects = false
        continue
      }
      if (inObjects && up.startsWith('CODE')) {
        const v = parseInt(s.split('=')[1]?.trim() ?? '', 10)
        current = isFinite(v) ? v : null
      } else if (inObjects && up.startsWith('NAME') && current !== null) {
        names[current] = s.split('=').slice(1).join('=').trim()
      }
    }
  } catch {
    // RSC бинарный/нестандартный — имена недоступны, коды всё равно применимы
  }
  return names
}

export interface SxfConvertOptions {
  /** Квадраты километровой сетки «X-Y» (север-восток), напр. «6183-413». Пусто — все. */
  squares: string
  /** Имена объектов из RSC */
  rscNames?: Record<number, string>
}

export interface SxfConvertResult {
  geojson: ClutterGeoJson
  totalObjects: number
  keptObjects: number
  squaresFound: string[]
  zone: number
}

/** Стабильный ID объекта для дедупликации при добавлении к существующим данным. */
function featureId(type: string, height: number, ring: number[][]): string {
  const first = ring[0]
  return `${type}|${height}|${first[0].toFixed(7)}|${first[1].toFixed(7)}`
}

/** Парсинг строки квадратов «6183-413, 6184-413» → Set ключей. */
export function parseSquaresList(input: string): Set<string> {
  const out = new Set<string>()
  for (const part of input.split(/[,;\s]+/)) {
    const m = /^\s*(\d{1,5})\s*[-:/]\s*(\d{1,5})\s*$/.exec(part)
    if (m) out.add(`${m[1]}-${m[2]}`)
  }
  return out
}

/** Квадрат точки: x — север (км), y' — восток без зоны (км). */
function squareOf(xM: number, yM: number, zone: number): string {
  const xKm = Math.floor(xM / 1000)
  const yLocal = yM - zone * 1e6
  const yKm = Math.floor(yLocal / 1000)
  return `${xKm}-${yKm}`
}

/**
 * Конвертация разобранного SXF в clutter GeoJSON (WGS 84).
 * Оставляются площадные объекты; фильтр по квадратам километровой сетки.
 */
export function convertSxfToClutter(parsed: SxfParseResult, opts: SxfConvertOptions): SxfConvertResult {
  const zone = parsed.passport.zone
  const squares = parseSquaresList(opts.squares)
  const rscNames = opts.rscNames ?? {}
  const features: ClutterGeoJson['features'] = []
  const squaresFound = new Set<string>()
  let total = 0

  for (const obj of parsed.objects) {
    if (obj.metricType !== AREA) continue // только площадные (здания/лес — полигоны)
    total++
    const meta = SXF_CODE_MAP[obj.code] ?? { type: 'building' as const, height: 10, label: `Код ${obj.code}` }

    for (const contour of obj.contours) {
      if (contour.length < 3) continue
      // Квадраты: по центроиду контура
      let cx = 0
      let cy = 0
      for (const [x, y] of contour) {
        cx += x
        cy += y
      }
      cx /= contour.length
      cy /= contour.length
      const sq = squareOf(cx, cy, zone)
      squaresFound.add(sq)
      if (squares.size > 0 && !squares.has(sq)) continue

      const ring: number[][] = contour.map(([x, y]) => {
        const wgs = sk42ToWgs84({ zone, x, y })
        return [wgs.lon, wgs.lat]
      })
      // Замыкаем контур
      const f = ring[0]
      const l = ring[ring.length - 1]
      if (f[0] !== l[0] || f[1] !== l[1]) ring.push([f[0], f[1]])

      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: {
          type: meta.type,
          height: meta.height,
          name: rscNames[obj.code] ?? meta.label,
          id: featureId(meta.type, meta.height, ring),
        },
      })
    }
  }

  return {
    geojson: { type: 'FeatureCollection', features },
    totalObjects: total,
    keptObjects: features.length,
    squaresFound: Array.from(squaresFound).sort(),
    zone,
  }
}

/** Слияние GeoJSON с добавлением (без перезаписи существующих объектов). */
export function mergeClutter(existing: ClutterGeoJson | null, incoming: ClutterGeoJson): ClutterGeoJson {
  if (!existing) return incoming
  const seen = new Set<string>()
  const result: ClutterGeoJson['features'] = []
  for (const f of existing.features) {
    const id = (f.properties?.id as string | undefined) ?? `${f.properties?.type}|${f.properties?.height}|${JSON.stringify((f.geometry?.coordinates as number[][][] | undefined)?.[0]?.[0])}`
    if (seen.has(id)) continue
    seen.add(id)
    result.push(f)
  }
  for (const f of incoming.features) {
    const id = (f.properties?.id as string | undefined) ?? `${f.properties?.type}|${f.properties?.height}|${JSON.stringify((f.geometry?.coordinates as number[][][] | undefined)?.[0]?.[0])}`
    if (seen.has(id)) continue
    seen.add(id)
    result.push(f)
  }
  return { type: 'FeatureCollection', features: result }
}

export { AREA, LINE, POINT }

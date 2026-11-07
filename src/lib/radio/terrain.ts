/**
 * Рельеф:
 *  • парсер SRTM .hgt (int16 BE, 1201×1201 или 3601×3601) с кэшем IndexedDB;
 *  • синтетический DEM для demo-режима (value-noise, детерминированный по seed);
 *  • профиль трассы с шагом, зависящим от разрешения DEM;
 *  • наложение зданий/растительности из clutter.geojson.
 */
import { destination, distanceM, bearingDeg } from './coordinates'
import type { LatLon, ProfilePoint } from './types'

export interface DemSource {
  name: string
  /** Высота (м) в точке */
  elevationAt(lat: number, lon: number): number
  /** Разрешение, м */
  resolutionM: number
}

/** ---------- Синтетический DEM (demo-режим) ---------- */

/** Детерминированный хэш → [0,1). */
function hash2(x: number, y: number, seed: number): number {
  let h = seed + x * 374761393 + y * 668265263
  h = (h ^ (h >>> 13)) * 1274126177
  h = h ^ (h >>> 16)
  return (h >>> 0) / 4294967296
}

/** Сглаженная интерполяция (smoothstep). */
function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

/** Value noise 2D. */
function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const a = hash2(xi, yi, seed)
  const b = hash2(xi + 1, yi, seed)
  const c = hash2(xi, yi + 1, seed)
  const d = hash2(xi + 1, yi + 1, seed)
  const u = smooth(xf)
  const v = smooth(yf)
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v
}

/** Фрактальный шум (fbm) — 4 октавы. */
function fbm(x: number, y: number, seed: number): number {
  let sum = 0
  let amp = 1
  let freq = 1
  let norm = 0
  for (let o = 0; o < 4; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 101)
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm
}

/**
 * Синтетический DEM: плавные холмы 0–350 м с детерминированной морфологией
 * (seed = округление координат до 0.1°, чтобы одна область выглядела стабильно).
 */
export function createSyntheticDem(): DemSource {
  return {
    name: 'Синтетический рельеф (demo)',
    resolutionM: 30,
    elevationAt(lat: number, lon: number): number {
      const sx = Math.round(lat * 10) / 10
      const sy = Math.round(lon * 10) / 10
      const seed = Math.abs(Math.round(sx * 977 + sy * 131)) % 100000
      const x = lat * 60
      const y = lon * 60
      const base = fbm(x, y, seed)
      const ridge = Math.pow(Math.abs(fbm(x * 0.5 + 13.7, y * 0.5 - 7.3, seed + 555) - 0.5) * 2, 1.5)
      const h = base * 260 + ridge * 90
      return Math.round(h)
    },
  }
}

/** ---------- SRTM .hgt ---------- */

export interface HgtTile {
  name: string // N47E039
  latOrigin: number // ЮЗ угол
  lonOrigin: number
  size: number // 1201 | 3601
  stepDeg: number // 3" или 1"
  data: Int16Array
}

/** Разбор .hgt (ArrayBuffer) c проверкой размеров. */
export function parseHgt(buffer: ArrayBuffer, filename: string): HgtTile {
  const name = filename.replace(/\.hgt$/i, '').toUpperCase()
  const m = /^([NS])(\d{2})([EW])(\d{3})$/.exec(name)
  if (!m) throw new Error(`Имя файла ${filename} не соответствует формату NXXEXXX.hgt`)

  const latOrigin = (m[1] === 'N' ? 1 : -1) * parseInt(m[2], 10)
  const lonOrigin = (m[3] === 'E' ? 1 : -1) * parseInt(m[4], 10)

  const n = buffer.byteLength / 2
  const size = Math.round(Math.sqrt(n))
  if (size !== 1201 && size !== 3601) {
    throw new Error(`Неверный размер .hgt: ${size}×${size} (ожидается 1201×1201 или 3601×3601)`)
  }
  if (buffer.byteLength !== size * size * 2) {
    throw new Error(`Размер файла ${buffer.byteLength} Б не соответствует сетке ${size}×${size}`)
  }

  const view = new DataView(buffer)
  const data = new Int16Array(size * size)
  for (let i = 0; i < size * size; i++) {
    data[i] = view.getInt16(i * 2, false) // big-endian
  }

  return {
    name,
    latOrigin,
    lonOrigin,
    size,
    stepDeg: size === 3601 ? 1 / 3600 : 3 / 3600,
    data,
  }
}

/** Высота в тайле (билинейная интерполяция). */
export function tileElevation(tile: HgtTile, lat: number, lon: number): number {
  const fx = (lat - tile.latOrigin) / tile.stepDeg
  const fy = (lon - tile.lonOrigin) / tile.stepDeg
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  if (x0 < 0 || y0 < 0 || x0 >= tile.size - 1 || y0 >= tile.size - 1) {
    // край тайла — ближайший узел
    const xc = Math.min(tile.size - 1, Math.max(0, Math.round(fx)))
    const yc = Math.min(tile.size - 1, Math.max(0, Math.round(fy)))
    return tile.data[xc * tile.size + yc]
  }
  const dx = fx - x0
  const dy = fy - y0
  const h = (xx: number, yy: number) => tile.data[xx * tile.size + yy]
  const top = h(x0, y0) * (1 - dx) + h(x0 + 1, y0) * dx
  const bot = h(x0, y0 + 1) * (1 - dx) + h(x0 + 1, y0 + 1) * dx
  return top * (1 - dy) + bot * dy
}

/** Имя тайла SRTM 3" по координате: N/S + 2 знака широты + E/W + 3 знака долготы (N44E033). */
export function tileNameAt(lat: number, lon: number): string {
  const latFloor = Math.floor(lat)
  const lonFloor = Math.floor(lon)
  return `${latFloor < 0 ? 'S' : 'N'}${String(Math.abs(latFloor)).padStart(2, '0')}${lonFloor < 0 ? 'W' : 'E'}${String(Math.abs(lonFloor)).padStart(3, '0')}`
}

/** Имена тайлов, покрывающих трассу A→Б: сэмплирование прямой линии (~200 точек). */
export function requiredTilesForTrack(a: LatLon, b: LatLon): string[] {
  const N = 200
  const found = new Set<string>()
  for (let i = 0; i <= N; i++) {
    const t = i / N
    found.add(tileNameAt(a.lat + (b.lat - a.lat) * t, a.lon + (b.lon - a.lon) * t))
  }
  return [...found]
}

/** DEM из набора локальных тайлов .hgt. */
export function createHgtDem(tiles: HgtTile[]): DemSource {
  return {
    name: `SRTM .hgt (${tiles.length} тайл.)`,
    resolutionM: tiles[0]?.stepDeg ? tiles[0].stepDeg * 111320 : 30,
    elevationAt(lat: number, lon: number): number {
      const want = tileNameAt(lat, lon)
      const tile = tiles.find((t) => t.name === want)
      if (!tile) return 0
      return tileElevation(tile, lat, lon)
    },
  }
}

/** ---------- Границы тайлов и покрытие ---------- */

/** Прямоугольник покрытия тайла: [юго-запад, северо-восток] в градусах. */
export function tileBounds(tile: HgtTile): {
  minLat: number
  maxLat: number
  minLon: number
  maxLon: number
} {
  return {
    minLat: tile.latOrigin,
    maxLat: tile.latOrigin + 1,
    minLon: tile.lonOrigin,
    maxLon: tile.lonOrigin + 1,
  }
}

/** Проверка точки на попадание в покрытие загруженных тайлов. */
export function pointInTiles(lat: number, lon: number, tiles: HgtTile[]): boolean {
  return tiles.some((t) => {
    const b = tileBounds(t)
    return lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon
  })
}

/**
 * Анализ покрытия трассы загруженными тайлами.
 * Возвращает долю точек профиля, попавших в покрытие (0…1) и список интервалов вне покрытия.
 */
export function pathTileCoverage(
  profile: ProfilePoint[],
  points: LatLon[],
  tiles: HgtTile[],
): { insideRatio: number; outside: boolean } {
  if (tiles.length === 0 || profile.length === 0) return { insideRatio: 1, outside: false }
  // Профиль равномерен по d: сэмплируем точки вдоль линии A→Б
  const a = points[0]
  const b = points[points.length - 1]
  const n = profile.length
  let inside = 0
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1 || 1)
    const lat = a.lat + (b.lat - a.lat) * t
    const lon = a.lon + (b.lon - a.lon) * t
    if (pointInTiles(lat, lon, tiles)) inside++
  }
  const insideRatio = inside / n
  return { insideRatio, outside: insideRatio < 0.999 }
}

/** ---------- Профиль трассы ---------- */

/** Построение профиля с шагом, зависящим от разрешения DEM. */
export function buildProfile(
  a: LatLon,
  b: LatLon,
  dem: DemSource,
  clutterAt?: (lat: number, lon: number) => { type: string; height: number } | null,
): ProfilePoint[] {
  const total = distanceM(a, b)
  // Шаг ≈ разрешение DEM, но 20…200 точек минимум
  const step = Math.max(dem.resolutionM, total / 400, 1)
  const n = Math.max(20, Math.min(2000, Math.ceil(total / step)))
  const az = bearingDeg(a, b)
  const profile: ProfilePoint[] = []

  for (let i = 0; i <= n; i++) {
    const d = (total * i) / n
    const p = i === n ? b : destination(a, d, az)
    const elev = dem.elevationAt(p.lat, p.lon)
    const cl = clutterAt?.(p.lat, p.lon) ?? null
    const clutterH = cl ? cl.height : 0
    profile.push({ d, elev, clutter: clutterH, total: elev + clutterH })
  }
  return profile
}

/** Высоты зданий/растительности вдоль трассы из clutter.geojson (точечная выборка). */
export function makeClutterSampler(geojson: ClutterGeoJson) {
  const features = geojson.features ?? []
  const pointInBbox = (p: [number, number], bbox: number[]) =>
    p[0] >= bbox[0] && p[0] <= bbox[2] && p[1] >= bbox[1] && p[1] <= bbox[3]

  // Простая стратегия: для каждого узла профиля ищем полигон, содержащий точку
  // (для демонстрации — по bbox полигона; полная проверка point-in-polygon ниже)
  function pointInPolygon(pt: [number, number], ring: number[][]): boolean {
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0]
      const yi = ring[i][1]
      const xj = ring[j][0]
      const yj = ring[j][1]
      const intersect = yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi
      if (intersect) inside = !inside
    }
    return inside
  }

  return (lat: number, lon: number): { type: string; height: number } | null => {
    for (const f of features) {
      const g = f.geometry
      if (!g) continue
      const rings: number[][][] = g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map((c: number[][][]) => c[0]) : []
      for (const ring of rings) {
        if (pointInBbox([lon, lat], ringBbox(ring)) && pointInPolygon([lon, lat], ring)) {
          const type = f.properties?.type ?? 'building'
          const height = Number(f.properties?.height ?? (type === 'building' ? 12 : 6))
          return { type, height }
        }
      }
    }
    return null
  }
}

function ringBbox(ring: number[][]): number[] {
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon
    if (lat < minLat) minLat = lat
    if (lon > maxLon) maxLon = lon
    if (lat > maxLat) maxLat = lat
  }
  return [minLon, minLat, maxLon, maxLat]
}

export interface ClutterGeoJson {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] } | null
    properties: { type?: 'building' | 'vegetation'; height?: number; name?: string; [k: string]: unknown }
  }>
}

/** Валидация clutter.geojson (поля type, height). */
export function validateClutter(json: unknown): { ok: boolean; error?: string; count?: number } {
  try {
    const gj = json as ClutterGeoJson
    if (!gj || gj.type !== 'FeatureCollection' || !Array.isArray(gj.features)) {
      return { ok: false, error: 'Не FeatureCollection' }
    }
    let count = 0
    for (const f of gj.features) {
      if (!f.geometry || !['Polygon', 'MultiPolygon'].includes(f.geometry.type)) {
        return { ok: false, error: 'Ожидается геометрия Polygon/MultiPolygon' }
      }
      if (f.properties?.type && !['building', 'vegetation'].includes(f.properties.type)) {
        return { ok: false, error: `Недопустимый type: ${f.properties.type} (building | vegetation)` }
      }
      if (f.properties?.height !== undefined && !isFinite(Number(f.properties.height))) {
        return { ok: false, error: 'height должен быть числом' }
      }
      count++
    }
    return { ok: true, count }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

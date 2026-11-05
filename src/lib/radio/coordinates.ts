/**
 * Преобразование координат WGS 84 ↔ СК-42 (проекция Гаусса–Крюгера,
 * эллипсоид Красовского). ТЗ 4.1.1.
 *
 * Схема: WGS84 (B, L) → геоцентрические XYZ → 7-параметрическое
 * преобразование Гельмерта (WGS84 → СК-42) → геодезические B,L на
 * эллипсоиде Красовского → проекция Гаусса–Крюгера (6-градусные зоны).
 * Обратный путь: Гаусс–Крюгер → B,L (Красовский) → Гельмерт (СК-42 → WGS84)
 * → геодезические WGS84.
 *
 * Точность: ~1–2 м (усреднённые элементы трансформирования по территории РФ).
 */
import type { LatLon, Sk42 } from './types'

// Параметры эллипсоидов
const A_WGS = 6378137.0
const F_WGS = 1 / 298.257223563
const A_KRAS = 6378245.0
const F_KRAS = 1 / 298.3

// Элементы трансформирования WGS84 → СК-42 (усреднённые, ГОСТ Р 51794-2008):
// ΔX, ΔY, ΔZ (м), углы Эйлера (") и масштабный коэффициент m
const DX = 23.57
const DY = -140.95
const DZ = -79.8
const WX = 0.0 // секунды дуги
const WY = -0.35
const WZ = -0.79
const M = -0.22e-6

const WGS_ELL = { a: A_WGS, f: F_WGS }
const KRAS_ELL = { a: A_KRAS, f: F_KRAS }

const toRad = (d: number) => (d * Math.PI) / 180
const toDeg = (r: number) => (r * 180) / Math.PI

interface Ellipsoid {
  a: number
  f: number
}

/** Геодезические → геоцентрические XYZ (плановая связь, высота = 0). */
function geodeticToEcef(latDeg: number, lonDeg: number, ell: Ellipsoid): [number, number, number] {
  const a = ell.a
  const e2 = ell.f * (2 - ell.f)
  const lat = toRad(latDeg)
  const lon = toRad(lonDeg)
  const sinLat = Math.sin(lat)
  const cosLat = Math.cos(lat)
  const N = a / Math.sqrt(1 - e2 * sinLat * sinLat)
  return [N * cosLat * Math.cos(lon), N * cosLat * Math.sin(lon), N * (1 - e2) * sinLat]
}

/** Геоцентрические XYZ → геодезические (итеративный метод). */
function ecefToGeodetic(x: number, y: number, z: number, ell: Ellipsoid): LatLon {
  const a = ell.a
  const e2 = ell.f * (2 - ell.f)
  const lon = Math.atan2(y, x)
  const p = Math.hypot(x, y)
  let lat = Math.atan2(z, p * (1 - e2))
  for (let i = 0; i < 8; i++) {
    const sinLat = Math.sin(lat)
    const N = a / Math.sqrt(1 - e2 * sinLat * sinLat)
    lat = Math.atan2(z + e2 * N * sinLat, p)
  }
  return { lat: toDeg(lat), lon: toDeg(lon) }
}

/** Преобразование Гельмерта: WGS84 → СК-42. */
function helmertWgsToSk42([x, y, z]: [number, number, number]): [number, number, number] {
  const wx = toRad(WX / 3600)
  const wy = toRad(WY / 3600)
  const wz = toRad(WZ / 3600)
  return [
    DX + (1 + M) * (x + wz * y - wy * z),
    DY + (1 + M) * (-wz * x + y + wx * z),
    DZ + (1 + M) * (wy * x - wx * y + z),
  ]
}

/** Обратное преобразование Гельмерта: СК-42 → WGS84 (Rᵀ·(X−T)/(1+m)). */
function helmertSk42ToWgs([x, y, z]: [number, number, number]): [number, number, number] {
  const wx = toRad(WX / 3600)
  const wy = toRad(WY / 3600)
  const wz = toRad(WZ / 3600)
  const Yx = (x - DX) / (1 + M)
  const Yy = (y - DY) / (1 + M)
  const Yz = (z - DZ) / (1 + M)
  // Транспонированная матрица поворота
  return [Yx - wz * Yy + wy * Yz, Yy + wz * Yx - wx * Yz, Yz - wy * Yx + wx * Yy]
}

/** Гаусс–Крюгер (прямо): B,L на Красовском → x,y (м, y с ведущей цифрой зоны). */
function gaussKrugerForward(latDeg: number, lonDeg: number): Sk42 {
  const zone = Math.floor(lonDeg / 6) + 1
  const lon0 = 6 * zone - 3
  const B = toRad(latDeg)
  const l = toRad(lonDeg - lon0)
  const sinB = Math.sin(B)
  const cosB = Math.cos(B)
  const t = Math.tan(B)
  const a = A_KRAS
  const e2 = F_KRAS * (2 - F_KRAS)
  const ep2 = e2 / (1 - e2) * cosB * cosB // η²
  const N = a / Math.sqrt(1 - e2 * sinB * sinB)

  // Длина дуги меридиана от экватора (ряд для эллипсоида Красовского)
  const m =
    a *
    ((1 - e2 / 4 - 3 * e2 * e2 / 64) * B -
      (3 * e2 / 8 + 3 * e2 * e2 / 32) * Math.sin(2 * B) +
      (15 * e2 * e2 / 256) * Math.sin(4 * B))

  const l2 = l * l
  const l4 = l2 * l2
  const l6 = l4 * l2
  const cos2 = cosB * cosB
  const cos3 = cos2 * cosB
  const cos5 = cos3 * cos2

  const x =
    m +
    (N * sinB * cosB * l2) / 2 +
    (N * sinB * cos3 * (5 - t * t + 9 * ep2 + 4 * ep2 * ep2) * l4) / 24 +
    (N * sinB * cos5 * (61 - 58 * t * t + t * t * t * t + 270 * ep2 - 330 * ep2 * t * t) * l6) / 720

  const y =
    N * cosB * l +
    (N * cos3 * (1 - t * t + ep2) * l2 * l) / 6 +
    (N * cos5 * (5 - 18 * t * t + t * t * t * t + 14 * ep2 - 58 * ep2 * t * t) * l4 * l) / 120

  return { zone, x, y: y + 500_000 + zone * 1e6 } // ложный восток 500 км + номер зоны
}

/** Гаусс–Крюгер (обратный): x,y → B,L на Красовском. */
function gaussKrugerInverse(sk: { zone: number; x: number; y: number }): LatLon {
  const zone = sk.zone
  const yFlat = sk.y - 500_000 - zone * 1e6
  const lon0 = 6 * zone - 3
  const a = A_KRAS
  const e2 = F_KRAS * (2 - F_KRAS)
  const e2sq = e2 * e2
  const m0 = sk.x

  // Широта-footpoint (обратный ряд)
  const mu = m0 / (a * (1 - e2 / 4 - 3 * e2sq / 64 - 5 * e2sq * e2sq / 256))
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2))
  const phi1 =
    mu +
    (3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32) * Math.sin(2 * mu) +
    (21 * e1 * e1 / 16 - 55 * Math.pow(e1, 4) / 32) * Math.sin(4 * mu) +
    (151 * Math.pow(e1, 3) / 96) * Math.sin(6 * mu) +
    (1097 * Math.pow(e1, 4) / 512) * Math.sin(8 * mu)

  const sinPhi = Math.sin(phi1)
  const cosPhi = Math.cos(phi1)
  const t2 = Math.tan(phi1) ** 2
  const ep2 = e2 / (1 - e2) * cosPhi * cosPhi
  const ep4 = ep2 * ep2
  const N1 = a / Math.sqrt(1 - e2 * sinPhi * sinPhi)
  const M1 = (N1 * (1 - e2)) / (1 - e2 * sinPhi * sinPhi)

  const yN = yFlat / N1
  const yN2 = yN * yN
  const yN4 = yN2 * yN2
  const yN6 = yN4 * yN2

  const B =
    phi1 -
    (N1 * Math.tan(phi1) / M1) *
      (yN2 / 2 -
        (5 + 3 * t2 + 10 * ep2 - 4 * ep4 - 9 * ep2 * t2) * yN4 / 24 +
        (61 + 90 * t2 + 45 * t2 * t2 + 46 * ep2 - 252 * t2 * ep2 - 3 * ep4) * yN6 / 720)

  const L =
    toRad(lon0) +
    (yN -
      (1 + 2 * t2 + ep2) * yN2 * yN / 6 +
      (5 - 2 * ep2 + 28 * t2 - 3 * ep4 + 8 * ep2 * t2 + 24 * t2 * t2) * yN4 * yN / 120) /
      cosPhi

  return { lat: toDeg(B), lon: toDeg(L) }
}

/** WGS 84 → СК-42 (Гаусс–Крюгер, зона определяется автоматически). */
export function wgs84ToSk42(p: LatLon): Sk42 {
  const ecef = geodeticToEcef(p.lat, p.lon, WGS_ELL)
  const skEcef = helmertWgsToSk42(ecef)
  const skLL = ecefToGeodetic(skEcef[0], skEcef[1], skEcef[2], KRAS_ELL)
  return gaussKrugerForward(skLL.lat, skLL.lon)
}

/** СК-42 (Гаусс–Крюгер) → WGS 84. */
export function sk42ToWgs84(sk: Sk42): LatLon {
  const skLL = gaussKrugerInverse(sk)
  const ecef = geodeticToEcef(skLL.lat, skLL.lon, KRAS_ELL)
  const wgsEcef = helmertSk42ToWgs(ecef)
  return ecefToGeodetic(wgsEcef[0], wgsEcef[1], wgsEcef[2], WGS_ELL)
}

/** Расстояние по большой окружности, м (Haversine). */
export function distanceM(a: LatLon, b: LatLon): number {
  const R = 6371008.8
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/** Азимут из точки a в точку b, град (0 = север, по часовой). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const dLon = toRad(b.lon - a.lon)
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

/** Точка на расстоянии d (м) по азимуту az (град) от точки a. */
export function destination(a: LatLon, dM: number, azDeg: number): LatLon {
  const R = 6371008.8
  const d = dM / R
  const az = toRad(azDeg)
  const lat1 = toRad(a.lat)
  const lon1 = toRad(a.lon)
  const sinLat2 = Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(az)
  const lat2 = Math.asin(sinLat2)
  const lon2 =
    lon1 + Math.atan2(Math.sin(az) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * sinLat2)
  return { lat: toDeg(lat2), lon: toDeg(lon2) }
}

/** Нормализация угла в [-180, 180). */
export function wrap180(deg: number): number {
  return (((deg + 180) % 360) + 360) % 360 - 180
}

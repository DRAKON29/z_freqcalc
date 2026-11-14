/**
 * Покрытие на карте (этап 2.5): геопривязанный канва-оверлей уровней
 * сигнала из computeCoverage. Проекция — та же локальная плоская, что и
 * в sampleElevationGrid (lat ± R/111320, lon ± R/(111320·cosLat)); на
 * дистанциях ≤ 200 км нелинейность Mercator ничтожна, а сжатие по долготе
 * учтено в bounds, поэтому imageOverlay геопривязан корректно.
 *
 * Зоны цвета согласованы с tri-color статусами приложения
 * (budget.linkStatus): ≥ 10 дБ — уверенный приём (тёмно-зелёный),
 * 0–10 — связь (зелёный), −10–0 — на грани (янтарный), < −10 — нет связи
 * (красный полупрозрачный). Геометрические режимы (geometry/fresnel)
 * рисуются по границам радиалов (maxKm/strongKm): margin у них отсутствует.
 */
import type { CoverageMode, CoverageResult, CoverageStats } from './coverage'
import type { LatLon } from './types'

export interface CoverageBounds {
  sw: LatLon
  ne: LatLon
}

/** Прямоугольник покрытия: center ± radiusM (плоская проекция). */
export function coverageBounds(center: LatLon, radiusM: number): CoverageBounds {
  const dLat = radiusM / 111320
  const dLon = radiusM / (111320 * Math.cos((center.lat * Math.PI) / 180))
  return {
    sw: { lat: center.lat - dLat, lon: center.lon - dLon },
    ne: { lat: center.lat + dLat, lon: center.lon + dLon },
  }
}

/** Билинейная интерполяция margin по (азимут, дальность); NaN вне сетки. */
export function marginAt(coverage: CoverageResult, azDeg: number, dM: number): number {
  const { levels, radiusKm } = coverage
  const distCount = levels.distKm.length
  const dKm = dM / 1000
  if (dKm < 0 || dKm > radiusKm) return NaN

  const step = 360 / levels.azCount
  const azNorm = ((azDeg % 360) + 360) % 360
  const azIdx = azNorm / step
  const az0 = Math.floor(azIdx) % levels.azCount
  const az1 = (az0 + 1) % levels.azCount
  const fAz = azIdx - Math.floor(azIdx)

  const distIdx = (dKm / (radiusKm / distCount)) - 1 // dKm/distKm[0] - 1
  const k0 = Math.max(0, Math.min(distCount - 1, Math.floor(distIdx)))
  const k1 = Math.min(distCount - 1, k0 + 1)
  const fD = Math.max(0, Math.min(1, distIdx - k0))

  const m = (az: number, k: number) => levels.margins[az * distCount + k]
  const m00 = m(az0, k0)
  const m10 = m(az1, k0)
  const m01 = m(az0, k1)
  const m11 = m(az1, k1)
  if (Number.isNaN(m00) || Number.isNaN(m10) || Number.isNaN(m01) || Number.isNaN(m11)) return NaN
  return (
    m00 * (1 - fAz) * (1 - fD) +
    m10 * fAz * (1 - fD) +
    m01 * (1 - fAz) * fD +
    m11 * fAz * fD
  )
}

/** Цвет пикселя оверлея по уровню: [r, g, b, alpha 0–255]. */
export function coverageColorAt(marginDb: number): [number, number, number, number] {
  if (Number.isNaN(marginDb)) return [0, 0, 0, 0]
  if (marginDb >= 10) return [4, 120, 87, 235]
  if (marginDb >= 0) return [16, 185, 129, 210]
  if (marginDb >= -10) return [217, 119, 6, 190]
  return [220, 38, 38, 115]
}

/** Цвет пикселя для геометрических режимов — по границе радиала. */
function boundaryColorAt(
  coverage: CoverageResult,
  mode: 'geometry' | 'fresnel',
  azDeg: number,
  dM: number,
): [number, number, number, number] {
  const azIdx = Math.round(azDeg / (360 / coverage.levels.azCount)) % coverage.levels.azCount
  const radial = coverage.radials[azIdx]
  if (!radial || radial.maxKm === null) return [0, 0, 0, 0]
  const dKm = dM / 1000
  if (mode === 'fresnel' && radial.strongKm !== null && dKm <= radial.strongKm) {
    return [4, 120, 87, 235] // полный просвет — уверенный приём
  }
  if (dKm <= radial.maxKm) {
    return mode === 'fresnel' ? [16, 185, 129, 190] : [16, 185, 129, 210]
  }
  return [0, 0, 0, 0]
}

/** Итоговый оверлей для store/карты. */
export interface MapCoverageOverlay {
  dataUrl: string
  bounds: CoverageBounds
  stats: CoverageStats
  radiusKm: number
  frequencyMhz: number
  mode: CoverageMode
  engineUsed: string
}

/**
 * Рендер геопривязанного канва-оверлея: пиксель → (дальность, азимут) →
 * уровень (бюджетные режимы) или граница радиала (геометрические) → цвет.
 * Верх канвы = север, bounds = center ± radiusM (плоская проекция).
 */
export function renderCoverageOverlay(
  coverage: CoverageResult,
  center: LatLon,
  mode: CoverageMode,
  sizePx = 512,
): string | null {
  if (typeof document === 'undefined') return null // bun/SSR
  const canvas = document.createElement('canvas')
  canvas.width = sizePx
  canvas.height = sizePx
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const radiusM = coverage.radiusKm * 1000
  const cosLat = Math.cos((center.lat * Math.PI) / 180)
  const img = ctx.createImageData(sizePx, sizePx)

  for (let py = 0; py < sizePx; py++) {
    // py 0 = северный край (как sampleElevationGrid)
    const dNorth = (0.5 - py / sizePx) * 2 * radiusM
    for (let px = 0; px < sizePx; px++) {
      const dEast = (px / sizePx - 0.5) * 2 * radiusM
      const d = Math.sqrt(dNorth * dNorth + dEast * dEast)
      const azNorm = (((Math.atan2(dEast, dNorth) * 180) / Math.PI) + 360) % 360
      let rgba: [number, number, number, number]
      if (mode === 'geometry' || mode === 'fresnel') {
        rgba = boundaryColorAt(coverage, mode, azNorm, d)
      } else {
        rgba = coverageColorAt(marginAt(coverage, azNorm, d))
      }
      const idx = (py * sizePx + px) * 4
      img.data[idx] = rgba[0]
      img.data[idx + 1] = rgba[1]
      img.data[idx + 2] = rgba[2]
      img.data[idx + 3] = rgba[3]
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}

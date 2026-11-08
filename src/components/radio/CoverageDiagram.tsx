'use client'

/**
 * Канва круговой диаграммы покрытия: рельеф подложкой + зоны связи + сетка
 * колец + трасса A→Б. Без подложки-карты (слой карты убран). Используется в
 * панели покрытия (базовый размер 1120 px) и в предпросмотре кандидатных
 * позиций поиска точки A (мини-размер) — все абсолютные размеры масштабируются.
 */
import { useEffect, useRef } from 'react'
import { ringStepKm, type CoverageResult, type ElevationGrid } from '@/lib/radio/coverage'

const BASE_PX = 1120

/** Гипсометрическая палитра рельефа: низины → вершины. */
const TERRAIN_STOPS: Array<[number, [number, number, number]]> = [
  [0.0, [86, 118, 76]],
  [0.3, [126, 149, 89]],
  [0.55, [172, 160, 100]],
  [0.78, [148, 117, 82]],
  [1.0, [208, 201, 188]],
]

function terrainColor(elev: number, grid: ElevationGrid): [number, number, number] {
  // вне тайлов высота 0 м — «нет данных»
  if (grid.nodataZero && elev === 0) return [148, 163, 184]
  const span = grid.maxElev - grid.minElev
  const t = span > 0 ? (elev - grid.minElev) / span : 0.5
  for (let i = 1; i < TERRAIN_STOPS.length; i++) {
    const [t1, c1] = TERRAIN_STOPS[i]
    const [t0, c0] = TERRAIN_STOPS[i - 1]
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0 || 1)
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * k),
        Math.round(c0[1] + (c1[1] - c0[1]) * k),
        Math.round(c0[2] + (c1[2] - c0[2]) * k),
      ]
    }
  }
  return TERRAIN_STOPS[TERRAIN_STOPS.length - 1][1]
}

interface DiagramProps {
  coverage: CoverageResult
  grid: ElevationGrid
  radiusKm: number
  /** Размер канвы в физических пикселях (по умолчанию 1120) */
  sizePx?: number
  className?: string
}

/** Отрисовка диаграммы на канве (азимут 0° — север, по часовой). */
export function CoverageDiagram({ coverage, grid, radiusKm, sizePx = BASE_PX, className }: DiagramProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const k = sizePx / BASE_PX

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const S = sizePx
    const c = S / 2
    const pad = 36 * k
    const maxR = c - pad
    const scale = maxR / (radiusKm * 1000)

    const toXY = (azDeg: number, km: number): [number, number] => {
      const a = (azDeg * Math.PI) / 180
      const r = km * 1000 * scale
      return [c + r * Math.sin(a), c - r * Math.cos(a)]
    }

    ctx.clearRect(0, 0, S, S)
    ctx.fillStyle = '#f1f2ee'
    ctx.fillRect(0, 0, S, S)

    // Круг расчёта — клип для подложки и зон
    ctx.save()
    ctx.beginPath()
    ctx.arc(c, c, maxR, 0, 2 * Math.PI)
    ctx.clip()

    // ---- Рельеф (сплошная подложка) ----
    const n = grid.n
    const off = document.createElement('canvas')
    off.width = n
    off.height = n
    const octx = off.getContext('2d')
    if (octx) {
      const img = octx.createImageData(n, n)
      for (let i = 0; i < n * n; i++) {
        const [r, g, b] = terrainColor(grid.data[i], grid)
        img.data[i * 4] = r
        img.data[i * 4 + 1] = g
        img.data[i * 4 + 2] = b
        img.data[i * 4 + 3] = 255
      }
      octx.putImageData(img, 0, 0)
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(off, c - maxR, c - maxR, maxR * 2, maxR * 2)
    }

    // ---- Зоны покрытия (ступенчатая граница по азимутам, без диагоналей) ----
    // Дуга сектора i идёт на радиусе r_i; на границе секторов радиус
    // переключается на r_{i+1} — граница повторяет данные каждого азимута.
    const phiOf = (azDeg: number, halfStepDeg: number) => ((azDeg + halfStepDeg - 90) * Math.PI) / 180
    const pathFor = (key: 'maxKm' | 'strongKm') => {
      ctx.beginPath()
      const rads = coverage.radials
      const startPhi = phiOf(rads[0].azDeg, -coverage.azimuthStepDeg / 2)
      const startR = (rads[0][key] ?? 0) * 1000 * scale
      ctx.moveTo(c + startR * Math.cos(startPhi), c + startR * Math.sin(startPhi))
      for (let i = 0; i < rads.length; i++) {
        const cur = rads[i]
        const next = rads[(i + 1) % rads.length]
        const rCur = ((cur[key] ?? 0) * 1000 * scale) || 0
        const rNext = ((next[key] ?? 0) * 1000 * scale) || 0
        ctx.arc(c, c, rCur, phiOf(cur.azDeg, -coverage.azimuthStepDeg / 2), phiOf(cur.azDeg, coverage.azimuthStepDeg / 2))
        const endPhi = phiOf(next.azDeg, -coverage.azimuthStepDeg / 2)
        const startPhiNext = phiOf(cur.azDeg, coverage.azimuthStepDeg / 2)
        ctx.arc(c, c, rNext, startPhiNext, endPhi >= startPhiNext ? endPhi : endPhi + 2 * Math.PI)
      }
      ctx.closePath()
    }
    if (coverage.stats.strongMinKm !== null) {
      pathFor('strongKm')
      ctx.fillStyle = 'rgba(4, 120, 87, 0.5)'
      ctx.fill()
    }
    if (coverage.stats.minKm !== null) {
      pathFor('maxKm')
      ctx.fillStyle = 'rgba(16, 185, 129, 0.30)'
      ctx.fill()
      ctx.strokeStyle = '#047857'
      ctx.lineWidth = Math.max(1, 3 * k)
      ctx.stroke()
    }

    // ---- Сетка колец дальности ----
    const stepKm = ringStepKm(radiusKm)
    ctx.strokeStyle = 'rgba(30, 41, 59, 0.35)'
    ctx.lineWidth = Math.max(0.5, 1.5 * k)
    ctx.fillStyle = '#1e293b'
    ctx.font = `${Math.max(8, 20 * k)}px system-ui, sans-serif`
    ctx.textAlign = 'left'
    for (let km = stepKm; km <= radiusKm + 1e-9; km += stepKm) {
      ctx.beginPath()
      ctx.arc(c, c, km * 1000 * scale, 0, 2 * Math.PI)
      ctx.stroke()
      ctx.fillText(`${km} км`, c + 6 * k, c - km * 1000 * scale + 22 * k)
    }

    // ---- Трасса A → Б ----
    const [bx, by] = toXY(coverage.routeAzDeg, Math.min(coverage.routeKm, radiusKm * 1.2))
    ctx.setLineDash([12 * k, 9 * k])
    ctx.strokeStyle = '#dc2626'
    ctx.lineWidth = Math.max(1, 3 * k)
    ctx.beginPath()
    ctx.moveTo(c, c)
    ctx.lineTo(bx, by)
    ctx.stroke()
    ctx.setLineDash([])
    if (coverage.routeKm <= radiusKm) {
      ctx.beginPath()
      ctx.arc(bx, by, 8 * k, 0, 2 * Math.PI)
      ctx.fillStyle = '#dc2626'
      ctx.fill()
      ctx.fillStyle = '#7f1d1d'
      ctx.font = `bold ${Math.max(10, 26 * k)}px system-ui, sans-serif`
      ctx.fillText('Б', bx + 12 * k, by - 12 * k)
    }

    // ---- Передатчик в центре ----
    ctx.beginPath()
    ctx.arc(c, c, 9 * k, 0, 2 * Math.PI)
    ctx.fillStyle = '#111827'
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = Math.max(1, 3 * k)
    ctx.stroke()
    ctx.fillStyle = '#111827'
    ctx.font = `bold ${Math.max(10, 26 * k)}px system-ui, sans-serif`
    ctx.fillText('A', c + 14 * k, c - 14 * k)

    ctx.restore()

    // ---- Рамка круга и румбы ----
    ctx.beginPath()
    ctx.arc(c, c, maxR, 0, 2 * Math.PI)
    ctx.strokeStyle = '#94a3b8'
    ctx.lineWidth = Math.max(1, 2 * k)
    ctx.stroke()

    ctx.fillStyle = '#334155'
    ctx.font = `bold ${Math.max(11, 28 * k)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('С', c, pad - 18 * k)
    ctx.fillText('Ю', c, S - pad + 18 * k)
    ctx.textAlign = 'left'
    ctx.fillText('В', c + maxR + 18 * k, c)
    ctx.textAlign = 'right'
    ctx.fillText('З', c - maxR - 18 * k, c)
    ctx.textBaseline = 'alphabetic'
  }, [coverage, grid, radiusKm, sizePx, k])

  return (
    <canvas
      ref={ref}
      width={sizePx}
      height={sizePx}
      role="img"
      aria-label="Круговая диаграмма радиосигнала с учётом рельефа"
      className={className ?? 'w-full max-w-[560px] aspect-square rounded-lg border bg-background'}
    />
  )
}

'use client'

/**
 * Круговая диаграмма радиосигнала (polar coverage diagram):
 *  • строится автоматически после расчёта по параметрам трассы;
 *  • граница зоны связи считается по азимутам с учётом рельефа и препятствий;
 *  • рельеф отображается подложкой внутри круга расчёта;
 *  • радиус расчёта: «длина трассы + 10 км» (по умолчанию) или
 *    фиксированные значения до 200 км с шагом 15 км.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRadioStore } from '@/store/radio-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, RotateCcw } from 'lucide-react'
import {
  autoRadiusKm,
  computeCoverage,
  radiusOptions,
  ringStepKm,
  sampleElevationGrid,
  STRONG_MARGIN_DB,
  type CoverageResult,
  type ElevationGrid,
} from '@/lib/radio/coverage'
import { createHgtDem, createSyntheticDem, makeClutterSampler } from '@/lib/radio/terrain'

/** Размер канвы в физических пикселях (2× для чёткости). */
const CANVAS_PX = 1120

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
}

/** Отрисовка диаграммы на канве (азимут 0° — север, по часовой). */
function CoverageDiagram({ coverage, grid, radiusKm }: DiagramProps) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const S = CANVAS_PX
    const c = S / 2
    const pad = 36
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

    // ---- Рельеф (подложка) ----
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
      // старт: (азимут первого − полшага) на радиусе первого
      const startPhi = phiOf(rads[0].azDeg, -coverage.azimuthStepDeg / 2)
      const startR = (rads[0][key] ?? 0) * 1000 * scale
      ctx.moveTo(c + startR * Math.cos(startPhi), c + startR * Math.sin(startPhi))
      for (let i = 0; i < rads.length; i++) {
        const cur = rads[i]
        const next = rads[(i + 1) % rads.length]
        const rCur = ((cur[key] ?? 0) * 1000 * scale) || 0
        const rNext = ((next[key] ?? 0) * 1000 * scale) || 0
        // сектор текущего азимута: [az − полшага … az + полшага] на rCur
        ctx.arc(c, c, rCur, phiOf(cur.azDeg, -coverage.azimuthStepDeg / 2), phiOf(cur.azDeg, coverage.azimuthStepDeg / 2))
        // радиальный переход на радиус следующего азимута (canvas проводит
        // прямую от текущей точки к началу дуги; дуга нулевой длины на стыке)
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
      ctx.lineWidth = 3
      ctx.stroke()
    }

    // ---- Сетка колец дальности ----
    const stepKm = ringStepKm(radiusKm)
    ctx.strokeStyle = 'rgba(30, 41, 59, 0.35)'
    ctx.lineWidth = 1.5
    ctx.fillStyle = '#1e293b'
    ctx.font = '20px system-ui, sans-serif'
    ctx.textAlign = 'left'
    for (let km = stepKm; km <= radiusKm + 1e-9; km += stepKm) {
      ctx.beginPath()
      ctx.arc(c, c, km * 1000 * scale, 0, 2 * Math.PI)
      ctx.stroke()
      ctx.fillText(`${km} км`, c + 6, c - km * 1000 * scale + 22)
    }

    // ---- Трасса A → Б ----
    const [bx, by] = toXY(coverage.routeAzDeg, Math.min(coverage.routeKm, radiusKm * 1.2))
    ctx.setLineDash([12, 9])
    ctx.strokeStyle = '#dc2626'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(c, c)
    ctx.lineTo(bx, by)
    ctx.stroke()
    ctx.setLineDash([])
    if (coverage.routeKm <= radiusKm) {
      ctx.beginPath()
      ctx.arc(bx, by, 8, 0, 2 * Math.PI)
      ctx.fillStyle = '#dc2626'
      ctx.fill()
      ctx.fillStyle = '#7f1d1d'
      ctx.font = 'bold 26px system-ui, sans-serif'
      ctx.fillText('Б', bx + 12, by - 12)
    }

    // ---- Передатчик в центре ----
    ctx.beginPath()
    ctx.arc(c, c, 9, 0, 2 * Math.PI)
    ctx.fillStyle = '#111827'
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.fillStyle = '#111827'
    ctx.font = 'bold 26px system-ui, sans-serif'
    ctx.fillText('A', c + 14, c - 14)

    ctx.restore()

    // ---- Рамка круга и румбы ----
    ctx.beginPath()
    ctx.arc(c, c, maxR, 0, 2 * Math.PI)
    ctx.strokeStyle = '#94a3b8'
    ctx.lineWidth = 2
    ctx.stroke()

    ctx.fillStyle = '#334155'
    ctx.font = 'bold 28px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('С', c, pad - 18)
    ctx.fillText('Ю', c, S - pad + 18)
    ctx.textAlign = 'left'
    ctx.fillText('В', c + maxR + 18, c)
    ctx.textAlign = 'right'
    ctx.fillText('З', c - maxR - 18, c)
    ctx.textBaseline = 'alphabetic'
  }, [coverage, grid, radiusKm])

  return (
    <canvas
      ref={ref}
      width={CANVAS_PX}
      height={CANVAS_PX}
      role="img"
      aria-label="Круговая диаграмма радиосигнала с учётом рельефа"
      className="w-full max-w-[560px] aspect-square rounded-lg border bg-background"
    />
  )
}

export function CoveragePanel() {
  const lastInput = useRadioStore((s) => s.lastInput)
  const equipment = useRadioStore((s) => s.equipment)
  const hgtTiles = useRadioStore((s) => s.hgtTiles)
  const clutter = useRadioStore((s) => s.clutter)

  // null — автоматический радиус «длина трассы + 10 км»
  const [radiusChoice, setRadiusChoice] = useState<number | null>(null)
  const [nonce, setNonce] = useState(0)
  const [data, setData] = useState<{ coverage: CoverageResult; grid: ElevationGrid } | null>(null)
  const [building, setBuilding] = useState(false)

  const routeKm = lastInput ? lastInput.path.distanceM / 1000 : 0
  const autoKm = useMemo(() => autoRadiusKm(routeKm), [routeKm])
  const radiusKm = radiusChoice ?? autoKm
  const options = useMemo(() => radiusOptions(routeKm), [routeKm])

  useEffect(() => {
    if (!lastInput) return
    let cancelled = false
    setBuilding(true)
    const t = setTimeout(() => {
      try {
        const dem = hgtTiles.length > 0 ? createHgtDem(hgtTiles) : createSyntheticDem()
        const clutterAt = clutter ? makeClutterSampler(clutter) : undefined
        const coverage = computeCoverage({ input: lastInput, dem, clutterAt, equipment, radiusKm, hgtTiles })
        const grid = sampleElevationGrid(dem, lastInput.path.points[0], radiusKm * 1000, 160, hgtTiles.length > 0)
        if (!cancelled) setData({ coverage, grid })
      } catch {
        // построение диаграммы не должно ломать панель результатов
      } finally {
        if (!cancelled) setBuilding(false)
      }
    }, 30)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [lastInput, equipment, hgtTiles, clutter, radiusKm, nonce])

  if (!lastInput) return null

  const cov = data?.coverage
  const fmtRange = (min: number | null, max: number | null) =>
    min !== null && max !== null ? `${min.toFixed(1)}–${max.toFixed(1)} км` : 'нет'

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
          Круговая диаграмма радиосигнала (polar coverage)
          <Badge variant="outline" className="font-mono">
            {lastInput.frequencyMhz.toFixed(0)} МГц · радиус {radiusKm.toFixed(1)} км
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-80 space-y-1.5">
            <Label htmlFor="coverage-radius">Радиус расчёта (radius)</Label>
            <Select
              value={radiusChoice === null ? 'auto' : String(radiusChoice)}
              onValueChange={(v) => setRadiusChoice(v === 'auto' ? null : Number(v))}
            >
              <SelectTrigger id="coverage-radius" className="w-full">
                <SelectValue placeholder="Радиус расчёта" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {options.map((o) => (
                  <SelectItem key={o.auto ? 'auto' : String(o.valueKm)} value={o.auto ? 'auto' : String(o.valueKm)}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              По умолчанию — длина трассы + 10 км. Фиксированные значения: до 200 км с шагом 15 км.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setNonce((v) => v + 1)} disabled={building}>
            {building ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-1" />}
            {building ? 'Построение…' : 'Построить заново'}
          </Button>
        </div>

        {cov && (
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Граница связи (запас ≥ 0 дБ)</p>
              <p className="text-base font-semibold">{fmtRange(cov.stats.minKm, cov.stats.maxKm)}</p>
              <p className="text-xs text-muted-foreground">медиана {cov.stats.medianKm?.toFixed(1) ?? '—'} км</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Уверенный приём (запас ≥ {STRONG_MARGIN_DB} дБ)</p>
              <p className="text-base font-semibold">{fmtRange(cov.stats.strongMinKm, cov.stats.strongMaxKm)}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Сектор покрытия</p>
              <p className="text-base font-semibold">{cov.stats.coveredAzimuthPercent.toFixed(0)} % азимутов</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Оценка площади покрытия</p>
              <p className="text-base font-semibold">{cov.stats.areaPercent.toFixed(0)} % круга</p>
            </div>
          </div>
        )}

        {data && cov && (
          <div className="space-y-2">
            <div className="flex justify-center">
              <CoverageDiagram coverage={cov} grid={data.grid} radiusKm={radiusKm} />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground justify-center">
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-6 rounded-sm" style={{ background: 'rgba(16,185,129,0.35)', border: '1px solid #047857' }} />
                зона связи (запас ≥ 0 дБ)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-6 rounded-sm" style={{ background: 'rgba(4,120,87,0.6)' }} />
                уверенный приём (запас ≥ {STRONG_MARGIN_DB} дБ)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-6 rounded-sm" style={{ background: 'linear-gradient(90deg,#56764c,#aca064,#947552,#d0c9bc)' }} />
                рельеф ({data.grid.minElev.toFixed(0)}–{data.grid.maxElev.toFixed(0)} м)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0 w-6 border-t-2 border-dashed border-red-600" />
                трасса A→Б
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Азимут 0° — север (С), по часовой стрелке. Центр — точка A (передатчик, Tx). Граница зоны — максимальная
              дальность с запасом на линию (link margin) ≥ 0 дБ по медианным потерям 50 % времени (та же цепочка
              механизмов, что в основном расчёте: {cov.engineUsed}). Построено за {cov.computedAtMs} мс ·
              азимутов: {cov.radials.length} (шаг {cov.azimuthStepDeg}°).
              {cov.stats.outsideTilesPercent !== undefined && cov.stats.outsideTilesPercent > 1 && (
                <> Вне тайлов рельефа — {cov.stats.outsideTilesPercent} % точек круга (там высота принята 0 м, серая подложка).</>
              )}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

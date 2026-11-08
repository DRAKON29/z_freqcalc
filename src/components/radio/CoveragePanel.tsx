'use client'

/**
 * Круговая диаграмма радиосигнала (polar coverage diagram):
 *  • строится автоматически после расчёта по параметрам трассы;
 *  • граница зоны связи считается по азимутам с учётом рельефа и препятствий;
 *  • рельеф отображается подложкой внутри круга расчёта (без слоя карты);
 *  • радиус расчёта: «длина трассы + 10 км» (по умолчанию) или
 *    фиксированные значения до 200 км с шагом 15 км.
 */
import { useEffect, useMemo, useState } from 'react'
import { useRadioStore } from '@/store/radio-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, RotateCcw } from 'lucide-react'
import { CoverageDiagram } from './CoverageDiagram'
import {
  autoRadiusKm,
  computeCoverage,
  radiusOptions,
  sampleElevationGrid,
  STRONG_MARGIN_DB,
  type CoverageResult,
  type ElevationGrid,
} from '@/lib/radio/coverage'
import { createHgtDem, createSyntheticDem, makeClutterSampler } from '@/lib/radio/terrain'

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
              азимутов: {cov.radials.length} (шаг {cov.azimuthStepDeg}°). Слои: рельеф, зоны связи.
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

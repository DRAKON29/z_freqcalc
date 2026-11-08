'use client'

/**
 * Предпросмотр круговой диаграммы покрытия для кандидатной позиции поиска
 * точки A: расчёт выполняется при открытии всплывающей подсказки и кэшируется
 * по координатам кандидата (повторное наведение — мгновенно). Диаграмма без
 * слоя карты, шаг 10° по азимуту и сетка 80×80 — быстрее полной.
 */
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { CoverageDiagram } from './CoverageDiagram'
import {
  autoRadiusKm,
  computeCoverage,
  sampleElevationGrid,
  STRONG_MARGIN_DB,
  type CoverageResult,
  type ElevationGrid,
} from '@/lib/radio/coverage'
import { bearingDeg, distanceM } from '@/lib/radio/coordinates'
import { createHgtDem, createSyntheticDem, makeClutterSampler, type ClutterGeoJson, type HgtTile } from '@/lib/radio/terrain'
import type { CalculationInput, EquipmentParams, LatLon } from '@/lib/radio/types'

/** Размер канвы предпросмотра в физических пикселях. */
const PREVIEW_PX = 640

/** Кэш построенных предпросмотров (ключ — координаты кандидата). */
const previewCache = new Map<string, { coverage: CoverageResult; grid: ElevationGrid }>()

interface PreviewProps {
  candidateA: LatLon
  baseInput: CalculationInput
  equipment: EquipmentParams
  hgtTiles: HgtTile[]
  clutter: ClutterGeoJson | null
}

export function CandidateCoveragePreview({ candidateA, baseInput, equipment, hgtTiles, clutter }: PreviewProps) {
  const key = `${candidateA.lat.toFixed(6)},${candidateA.lon.toFixed(6)}`
  const [data, setData] = useState<{ coverage: CoverageResult; grid: ElevationGrid } | null>(
    () => previewCache.get(key) ?? null,
  )
  const [building, setBuilding] = useState(false)

  useEffect(() => {
    const cached = previewCache.get(key)
    if (cached) {
      setData(cached)
      return
    }
    let cancelled = false
    setBuilding(true)
    const t = setTimeout(() => {
      try {
        const dem = hgtTiles.length > 0 ? createHgtDem(hgtTiles) : createSyntheticDem()
        const clutterAt = clutter ? makeClutterSampler(clutter) : undefined
        const pointB = baseInput.path.points[1]
        const radiusKm = autoRadiusKm(distanceM(candidateA, pointB) / 1000)
        const candInput: CalculationInput = {
          ...baseInput,
          path: {
            points: [candidateA, pointB],
            distanceM: distanceM(candidateA, pointB),
            azimuthDeg: bearingDeg(candidateA, pointB),
            // профиль заменяется по каждому азимуту внутри computeCoverage
            profile: baseInput.path.profile,
            demStepM: baseInput.path.demStepM,
            demSource: baseInput.path.demSource,
          },
        }
        const coverage = computeCoverage({
          input: candInput,
          dem,
          clutterAt,
          equipment,
          radiusKm,
          azimuthStepDeg: 10,
          hgtTiles,
        })
        const grid = sampleElevationGrid(dem, candidateA, radiusKm * 1000, 80, hgtTiles.length > 0)
        if (previewCache.size > 12) previewCache.clear()
        previewCache.set(key, { coverage, grid })
        if (!cancelled) setData({ coverage, grid })
      } catch {
        // предпросмотр не должен ломать таблицу кандидатов
      } finally {
        if (!cancelled) setBuilding(false)
      }
    }, 30)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [key])

  if (building || !data) {
    return (
      <div className="flex items-center justify-center h-[220px] text-muted-foreground text-xs gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> построение диаграммы…
      </div>
    )
  }

  const cov = data.coverage
  const fmtRange = (min: number | null, max: number | null) =>
    min !== null && max !== null ? `${min.toFixed(1)}–${max.toFixed(1)} км` : 'нет'

  return (
    <div className="space-y-1.5 w-[240px]">
      <CoverageDiagram
        coverage={cov}
        grid={data.grid}
        radiusKm={cov.radiusKm}
        sizePx={PREVIEW_PX}
        className="w-full aspect-square rounded border bg-background"
      />
      <p className="text-[11px] text-muted-foreground leading-snug">
        Граница связи: {fmtRange(cov.stats.minKm, cov.stats.maxKm)} (медиана{' '}
        {cov.stats.medianKm?.toFixed(1) ?? '—'} км); уверенный приём ≥ {STRONG_MARGIN_DB} дБ:{' '}
        {fmtRange(cov.stats.strongMinKm, cov.stats.strongMaxKm)}. Радиус {cov.radiusKm.toFixed(1)} км
        (трасса кандидата + 10 км), за {cov.computedAtMs} мс.
      </p>
    </div>
  )
}

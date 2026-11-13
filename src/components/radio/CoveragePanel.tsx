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
  FRESNEL_CRITERION,
  type CoverageMode,
  type CoverageResult,
  type ElevationGrid,
} from '@/lib/radio/coverage'
import { createHgtDem, createSyntheticDem, makeClutterSampler } from '@/lib/radio/terrain'

/**
 * Режимы преград (этап UX.3, референс antenna.2tg.dev): честные подписи —
 * что оптимистично, что пессимистично, что инженерный критерий.
 */
const COVERAGE_MODE_META: ReadonlyArray<{ value: CoverageMode; label: string; hint: string }> = [
  {
    value: 'model',
    label: 'Текущая модель (FSPL + P.526 + clutter)',
    hint: 'Полная цепочка механизмов основного расчёта: дифракция P.526 по рельефу и зданиям, растительность, газы — медиана 50 % времени. Самая сбалансированная картина.',
  },
  {
    value: 'fspl',
    label: 'Только FSPL — оптимистичная',
    hint: 'Без рельефа и препятствий вообще: верхняя граница по свободному пространству. Там, где есть холмы или застройка, реальная зона будет меньше — смотрите «Текущая модель» или «Геометрия».',
  },
  {
    value: 'geometry',
    label: 'Геометрия LOS — худший случай',
    hint: 'Жёсткая геометрия: рельеф/препятствия выше прямой видимости (с учётом кривизны Земли) обрывают зону. В жизни за хребтом сигнал часто есть, просто ослаблен (дифракция) — здесь он не показан вовсе.',
  },
  {
    value: 'fresnel',
    label: 'Строго по Френелю (0.6·F1)',
    hint: 'Инженерный критерий качества трассы: зона там, где просвет ≥ 0.6·F1 при K из ввода (уверенный приём — полный F1). Это метрика просвета, а не модель поля в каждой точке.',
  },
]

export function CoveragePanel() {
  const lastInput = useRadioStore((s) => s.lastInput)
  const equipment = useRadioStore((s) => s.equipment)
  const hgtTiles = useRadioStore((s) => s.hgtTiles)
  const clutter = useRadioStore((s) => s.clutter)
  const coverageMode = useRadioStore((s) => s.coverageMode)
  const setField = useRadioStore((s) => s.setField)

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
        const coverage = computeCoverage({ input: lastInput, dem, clutterAt, equipment, radiusKm, hgtTiles, mode: coverageMode })
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
  }, [lastInput, equipment, hgtTiles, clutter, radiusKm, coverageMode, nonce])

  if (!lastInput) return null

  const cov = data?.coverage
  const fmtRange = (min: number | null, max: number | null) =>
    min !== null && max !== null ? `${min.toFixed(1)}–${max.toFixed(1)} км` : 'нет'
  const meta = COVERAGE_MODE_META.find((m) => m.value === coverageMode) ?? COVERAGE_MODE_META[0]
  const zoneLabel =
    coverageMode === 'geometry'
      ? 'зона видимости (LOS)'
      : coverageMode === 'fresnel'
        ? `просвет ≥ ${FRESNEL_CRITERION}·F1`
        : coverageMode === 'fspl'
          ? 'зона связи по FSPL (запас ≥ 0 дБ)'
          : 'зона связи (запас ≥ 0 дБ)'
  const strongLabel =
    coverageMode === 'fresnel'
      ? 'уверенный приём (просвет ≥ F1)'
      : coverageMode === 'geometry'
        ? null // в геометрии «уверенный приём» не определяется
        : `уверенный приём (запас ≥ ${STRONG_MARGIN_DB} дБ)`
  const borderCardLabel =
    coverageMode === 'geometry'
      ? 'Граница видимости (LOS)'
      : coverageMode === 'fresnel'
        ? `Граница просвета (≥ ${FRESNEL_CRITERION}·F1)`
        : 'Граница связи (запас ≥ 0 дБ)'
  const marginFootnote =
    coverageMode === 'geometry'
      ? 'Граница зоны — дальность, до которой прямая видимость свободна (рельеф и препятствия ниже луча с учётом кривизны Земли).'
      : coverageMode === 'fresnel'
        ? `Граница зоны — дальность непрерывного просвета ≥ ${FRESNEL_CRITERION}·F1; уверенный приём — полный F1.`
        : 'Граница зоны — максимальная дальность с запасом на линию (link margin) ≥ 0 дБ по медианным потерям 50 % времени.'

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
          <div className="w-full sm:w-80 space-y-1.5">
            <Label htmlFor="coverage-mode">Преграды на покрытии</Label>
            <Select value={coverageMode} onValueChange={(v) => setField('coverageMode', v as CoverageMode)}>
              <SelectTrigger id="coverage-mode" className="w-full">
                <SelectValue placeholder="Режим преград" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {COVERAGE_MODE_META.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{meta.hint}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setNonce((v) => v + 1)} disabled={building}>
            {building ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-1" />}
            {building ? 'Построение…' : 'Построить заново'}
          </Button>
        </div>

        {cov && (
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{borderCardLabel}</p>
              <p className="text-base font-semibold">{fmtRange(cov.stats.minKm, cov.stats.maxKm)}</p>
              <p className="text-xs text-muted-foreground">медиана {cov.stats.medianKm?.toFixed(1) ?? '—'} км</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">
                {coverageMode === 'geometry'
                  ? 'Уверенный приём'
                  : coverageMode === 'fresnel'
                    ? 'Уверенный приём (просвет ≥ F1)'
                    : `Уверенный приём (запас ≥ ${STRONG_MARGIN_DB} дБ)`}
              </p>
              <p className="text-base font-semibold">
                {coverageMode === 'geometry' ? '—' : fmtRange(cov.stats.strongMinKm, cov.stats.strongMaxKm)}
              </p>
              {coverageMode === 'geometry' && (
                <p className="text-xs text-muted-foreground">в геометрии не определяется</p>
              )}
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
                {zoneLabel}
              </span>
              {strongLabel && (
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-6 rounded-sm" style={{ background: 'rgba(4,120,87,0.6)' }} />
                  {strongLabel}
                </span>
              )}
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
              Азимут 0° — север (С), по часовой стрелке. Центр — точка A (передатчик, Tx). {marginFootnote} Режим
              преград: «{meta.label}». Движок: {cov.engineUsed}. Построено за {cov.computedAtMs} мс · азимутов:{' '}
              {cov.radials.length} (шаг {cov.azimuthStepDeg}°). Слои: рельеф, зоны связи.
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

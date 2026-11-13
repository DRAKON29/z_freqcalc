'use client'

/**
 * Результаты:
 * бюджет линии (таблица приход/расход + предупреждение при margin < 0),
 * профиль трассы (рельеф, LOS, зона Френеля, препятствия),
 * график потерь vs процент времени (P.2001), сводка по диапазону частот,
 * вклад механизмов, экспорт JSON/CSV.
 */
import { useMemo } from 'react'
import { useRadioStore } from '@/store/radio-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  LineChart,
  CartesianGrid,
} from 'recharts'
import { earthBulgeM } from '@/lib/radio/fspl'
import { fresnelRadiusM } from '@/lib/radio/fresnel'
import { buildExportPayload, toJson, toCsv, download } from '@/lib/radio/export'
import { linkStatus, type LinkStatus } from '@/lib/radio/budget'
import { availabilitySummary } from '@/lib/radio/availability'
import { auditClearance, type ClearanceVerdict } from '@/lib/radio/clearance'
import { diffractionMethodsDb } from '@/lib/radio/diffraction'
import { fmtSk42SevenDigits } from '@/lib/radio/optimal-point'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { CandidateCoveragePreview } from '@/components/radio/CoveragePreview'
import { PieChart } from 'lucide-react'
import { CoveragePanel } from '@/components/radio/CoveragePanel'
import { AlertTriangle, Download, FileJson, FileSpreadsheet } from 'lucide-react'

/** Цветовая дифференциация статуса связи: зелёный / жёлтый / красный. */
const STATUS_META: Record<LinkStatus, { label: string; text: string; dot: string; border: string; bg: string; alert: string }> = {
  stable: { label: 'Связь стабильна', text: 'text-emerald-600', dot: 'bg-emerald-600', border: 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30', bg: 'bg-emerald-50 dark:bg-emerald-950/30', alert: 'text-emerald-700' },
  marginal: { label: 'Связь нестабильна', text: 'text-amber-600', dot: 'bg-amber-500', border: 'border-amber-300 bg-amber-50 dark:bg-amber-950/30', bg: 'bg-amber-50 dark:bg-amber-950/30', alert: 'text-amber-800 dark:text-amber-300' },
  lost: { label: 'Связь отсутствует', text: 'text-destructive', dot: 'bg-destructive', border: 'border-destructive/50 bg-destructive/10', bg: 'bg-destructive/10', alert: 'text-destructive' },
}

/** Цвет значения запаса в таблицах по трёхуровневому статусу. */
const marginCls = (marginDb: number): string => {
  const st = linkStatus(marginDb)
  return st === 'stable' ? 'text-emerald-600' : st === 'marginal' ? 'text-amber-600' : 'text-destructive'
}

/** Оформление вердикта clearance-аудита. */
const CLEARANCE_META: Record<ClearanceVerdict, { label: string; cls: string }> = {
  clear: { label: '0.6·F1 выполнен', cls: 'text-emerald-600 dark:text-emerald-400' },
  marginal: { label: 'частичный просвет', cls: 'text-amber-600 dark:text-amber-400' },
  blocked: { label: 'перекрыта', cls: 'text-red-600 dark:text-red-400' },
}

/** Статусная плашка «Связь …» с цветной точкой. */
function StatusChip({ status }: { status: LinkStatus }) {
  const m = STATUS_META[status]
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${m.border} ${m.text}`}>
      <span className={`h-2.5 w-2.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  )
}

/** Значение строки бюджета: ч/год — с двумя знаками (значения часто < 1), остальное — с одним. */
function fmtRowValue(r: { value: number; unit: string }): string {
  return r.unit === 'ч/год' ? r.value.toFixed(2) : r.value.toFixed(1)
}

/** Недоступность в человекочитаемом виде: ч/год или мин/год. */
function fmtHours(hoursPerYear: number): string {
  if (hoursPerYear < 1 / 60) return '< 1 мин/год'
  if (hoursPerYear < 1) return `${(hoursPerYear * 60).toFixed(0)} мин/год`
  return `${hoursPerYear.toFixed(1)} ч/год`
}

/** Малые проценты времени: < 0.001 % — в экспоненциальной форме. */
function fmtSmallPercent(p: number): string {
  return p >= 0.001 ? `${p.toFixed(3)} %` : `${p.toExponential(1)} %`
}

function rainSourceLabel(src: 'itu' | 'user' | 'zone' | null): string {
  return src === 'itu' ? 'карты ITU P.837-6' : src === 'user' ? 'ввод пользователя' : src === 'zone' ? 'оценка по зоне дождя (P.837-3)' : 'не задано'
}

export function ResultsPanel() {
  const s = useRadioStore()
  const { result, budget, availability, comparison, lastInput, rangeResults, reverseResult, reverseBudget, reverseInput, reverseAvailability, reverseRangeResults, mobileFrequencyMhz, mobileFrequencyMode, terrainWarning, searchReport, searchProgress } = s

  const profileData = useMemo(() => {
    if (!lastInput) return []
    const dTotal = lastInput.path.distanceM
    const k = lastInput.kFactor
    const txBase = lastInput.path.profile[0]?.elev ?? 0
    const rxBase = lastInput.path.profile[lastInput.path.profile.length - 1]?.elev ?? 0
    const txAnt = txBase + lastInput.txHeightM
    const rxAnt = rxBase + lastInput.rxHeightM
    return lastInput.path.profile.map((p) => {
      const bulge = earthBulgeM(p.d, dTotal, k)
      const relElev = p.elev - bulge
      const relTotal = p.total - bulge
      // LOS — прямая между антеннами в системе координат с вычтенной кривизной
      const los = txAnt + ((rxAnt - txAnt) * p.d) / dTotal
      const f1 = fresnelRadiusM(p.d, dTotal, lastInput.frequencyMhz)
      return {
        dKm: +(p.d / 1000).toFixed(2),
        рельеф: +relElev.toFixed(1),
        препятствие: +(relTotal - relElev).toFixed(1),
        LOS: +los.toFixed(1),
        френель: +(los + f1).toFixed(1),
      }
    })
  }, [lastInput])

  const breakdownData = useMemo(() => {
    if (!result) return []
    const b = result.breakdown
    return [
      { name: 'Свободное пространство', value: +b.freeSpaceDb.toFixed(1) },
      { name: 'Дифракция', value: +b.diffractionDb.toFixed(1) },
      { name: 'Тропосфера', value: +(b.troposcatterDb ?? 0).toFixed(1) },
      { name: 'Дождь', value: +(b.rainDb ?? 0).toFixed(1) },
      { name: 'Газы', value: +(b.gasesDb ?? 0).toFixed(1) },
      { name: 'Растительность', value: +(b.vegetationDb ?? 0).toFixed(1) },
    ].filter((r) => r.value > 0.001)
  }, [result])

  // Clearance-аудит трассы: 0.6·F1 при K = 4/3, 2/3, ∞ (чистая функция от input)
  const clearanceAudit = useMemo(() => (lastInput ? auditClearance(lastInput) : null), [lastInput])

  // Сравнение методов дифракции (роадмап 1.3): показывается при наличии затенения;
  // k-фактор тот же, что в медиане модели (env?.k50 ?? kFactor)
  const diffractionMethods = useMemo(() => {
    if (!lastInput || !result) return null
    if (!(result.breakdown.diffractionDb > 0.05)) return null
    const profile = lastInput.path.profile
    if (profile.length < 3) return null
    const txH = (profile[0]?.elev ?? 0) + lastInput.txHeightM
    const rxH = (profile[profile.length - 1]?.elev ?? 0) + lastInput.rxHeightM
    const k = lastInput.environment?.k50 ?? lastInput.kFactor
    return diffractionMethodsDb(profile, txH, rxH, lastInput.frequencyMhz, k)
  }, [lastInput, result])

  if (!result || !budget) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Выполните расчёт — здесь появятся бюджет линии, профиль трассы и графики.
        </CardContent>
      </Card>
    )
  }

  const rangeData = (rangeResults ?? []).map((r) => ({
    f: r.frequencyMhz,
    loss: +r.medianLossDb.toFixed(1),
    margin: +r.linkMarginDb.toFixed(1),
  }))

  const reverseRangeData = (reverseRangeResults ?? []).map((r) => ({
    f: r.frequencyMhz,
    loss: +r.medianLossDb.toFixed(1),
    margin: +r.linkMarginDb.toFixed(1),
  }))

  // Применить кандидатную позицию поиска: точка A переносится в позицию
  // кандидата, расчёт перезапускается (поиск — заново от новой точки, если включён)
  const applyCandidate = (p: { lat: number; lon: number }) => {
    s.setPointA({ lat: p.lat, lon: p.lon })
    void s.calculate()
  }

  const doExportJson = () => {
    const payload = buildExportPayload(lastInput!, result, budget, s.dynamics ?? undefined)
    download(`расчёт-${new Date().toISOString().slice(0, 19)}.json`, toJson(payload), 'application/json')
  }
  const doExportCsv = () => {
    const payload = buildExportPayload(lastInput!, result, budget)
    download(`расчёт-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(payload), 'text/csv')
  }

  const fwdStatus = linkStatus(budget.linkMarginDb, result)
  const revStatus = reverseBudget ? linkStatus(reverseBudget.linkMarginDb, reverseResult ?? undefined) : null

  return (
    <div className="space-y-4">
      {/* Предупреждение о покрытии рельефа */}
      {terrainWarning && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 flex items-start gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 dark:text-amber-300">{terrainWarning}</p>
        </div>
      )}

      {/* Предупреждения fallback */}
      {result.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-1">
          {result.warnings.map((w, i) => (
            <p key={i} className="text-sm text-amber-800 dark:text-amber-300 flex gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> {w}
            </p>
          ))}
        </div>
      )}

      {/* Итоги */}
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={fwdStatus} />
        <span className="text-xs text-muted-foreground">
          прямая линия: наземный Tx → подвижный Rx
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Медианные потери</p>
            <p className="text-2xl font-semibold">{result.medianLossDb.toFixed(1)} <span className="text-sm">дБ</span></p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">P_rx</p>
            <p className="text-2xl font-semibold">{budget.prxDbm.toFixed(1)} <span className="text-sm">дБм</span></p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Отношение сигнал/шум (SNR)</p>
            <p className="text-2xl font-semibold">{budget.snrDb.toFixed(1)} <span className="text-sm">дБ</span></p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Запас на линию (link margin)</p>
            <p className={`text-2xl font-semibold ${STATUS_META[fwdStatus].text}`}>
              {budget.linkMarginDb.toFixed(1)} <span className="text-sm">дБ</span>
            </p>
          </CardContent>
        </Card>
      </div>

      {fwdStatus !== 'stable' && (
        <div className={`rounded-lg border p-3 flex items-center gap-2 ${STATUS_META[fwdStatus].border}`}>
          <AlertTriangle className={`h-5 w-5 shrink-0 ${STATUS_META[fwdStatus].text}`} />
          <p className={`text-sm font-medium ${STATUS_META[fwdStatus].alert}`}>
            {fwdStatus === 'marginal'
              ? 'Связь нестабильна: запас на линии на грани — возможны срывы при замираниях (SNR ниже требуемого Eb/N₀ на ' + Math.abs(budget.linkMarginDb).toFixed(1) + ' дБ).'
              : 'Связь отсутствует: SNR ниже требуемого Eb/N₀ на ' + Math.abs(budget.linkMarginDb).toFixed(1) + ' дБ.'}
          </p>
        </div>
      )}

      {/* Условия из цифровых продуктов ITU-R P.2001-6 */}
      {lastInput?.environment && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
              Условия из цифровых продуктов ITU-R P.2001-6
              <Badge variant="outline" className="font-mono">{lastInput.environment.usedProducts.length} продукта(ов)</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4 text-sm">
              {lastInput.environment.rho50 !== undefined && (
                <div><p className="text-xs text-muted-foreground">Плотность пара ρ (Surfwv_50_fixed)</p><p className="font-mono">{lastInput.environment.rho50.toFixed(1)} г/м³</p></div>
              )}
              {lastInput.environment.pr6 !== undefined && (
                <div><p className="text-xs text-muted-foreground">Дождь Pr6 (Esarain_Pr6)</p><p className="font-mono">{lastInput.environment.pr6.toFixed(1)} мм/ч</p></div>
              )}
              {lastInput.environment.rainMassMt !== undefined && (
                <div><p className="text-xs text-muted-foreground">Масса дождя Mt (Esarain_Mt)</p><p className="font-mono">{lastInput.environment.rainMassMt.toFixed(0)} кг/м²/год</p></div>
              )}
              {lastInput.environment.beta0 !== undefined && (
                <div><p className="text-xs text-muted-foreground">Вероятность дождя β (Esarain_Beta)</p><p className="font-mono">{(lastInput.environment.beta0 * 100).toFixed(2)} %</p></div>
              )}
              {lastInput.environment.rainProbP0 !== undefined && (
                <div><p className="text-xs text-muted-foreground">Вероятность дождя P0 (P.837-6)</p><p className="font-mono">{lastInput.environment.rainProbP0.toFixed(2)} %</p></div>
              )}
              {lastInput.environment.rainRate001 !== undefined && (
                <div><p className="text-xs text-muted-foreground">Дождь R0.01 (P.837-6, шаг 5)</p><p className="font-mono">{lastInput.environment.rainRate001.toFixed(1)} мм/ч</p></div>
              )}
              {lastInput.environment.isothermH0Km !== undefined && (
                <div><p className="text-xs text-muted-foreground">Изотерма 0 °C h0 (P.839-4)</p><p className="font-mono">{lastInput.environment.isothermH0Km.toFixed(2)} км</p></div>
              )}
              {lastInput.environment.dnMedian !== undefined && (
                <div><p className="text-xs text-muted-foreground">Медианный ΔN (DN_Median)</p><p className="font-mono">{lastInput.environment.dnMedian.toFixed(1)} N/км</p></div>
              )}
              {lastInput.environment.dndz01 !== undefined && (
                <div><p className="text-xs text-muted-foreground">ΔN при 0.1 % (dndz_01)</p><p className="font-mono">{lastInput.environment.dndz01.toFixed(1)} N/км</p></div>
              )}
              {lastInput.environment.k50 !== undefined && (
                <div><p className="text-xs text-muted-foreground">k-фактор медианы (из ΔN)</p><p className="font-mono">{lastInput.environment.k50.toFixed(2)}{lastInput.kFactorSource === 'itu' ? ' (использован)' : ''}</p></div>
              )}
              {lastInput.environment.k01 !== undefined && (
                <div><p className="text-xs text-muted-foreground">k-фактор при 0.1 %</p><p className="font-mono">{lastInput.environment.k01.toFixed(2)}</p></div>
              )}
              {lastInput.environment.tropoZone !== undefined && (
                <div><p className="text-xs text-muted-foreground">Зона TropoClim (Annex E)</p><p className="font-mono">№ {lastInput.environment.tropoZone}</p></div>
              )}
              {lastInput.environment.foEs001 !== undefined && (
                <div><p className="text-xs text-muted-foreground">foEs 0.1/1/10/50 % (Annex G)</p><p className="font-mono">{lastInput.environment.foEs001?.toFixed(1)} / {lastInput.environment.foEs01?.toFixed(1)} / {lastInput.environment.foEs10?.toFixed(1)} / {lastInput.environment.foEs50?.toFixed(1)} МГц</p></div>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {lastInput.environment.usedProducts.map((f) => (
                <Badge key={f} variant="secondary" className="font-mono text-xs">{f}</Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {lastInput.environment.pr6 !== undefined && 'Дождь из карт ITU: CCDF R(p) по P.837-6 (Pr6, Mt, β) — в хвосте распределения (p ≤ P0); медиана — без дождя. '}
              {lastInput.kFactorSource === 'itu' && 'k-фактор геометрии взят из карты DN_Median (P.453): k = 157/(157 + ΔN). '}
              Извлечение — среднее значений в точках A и Б (билинейная интерполяция P.1144; TropoClim — ближайший узел).
            </p>
          </CardContent>
        </Card>
      )}

      {/* Бюджет линии: приход/расход */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            Бюджет линии (Link Budget)
            <Badge variant="outline" className="font-mono">{result.engineUsed}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-sm font-medium mb-2">Приход</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Параметр</TableHead>
                  <TableHead className="text-right">Значение</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {budget.income.map((r, i) => (
                  <TableRow key={i} className={r.sign === '=' ? 'bg-muted/50 font-medium' : ''}>
                    <TableCell>{r.label}</TableCell>
                    <TableCell className="text-right font-mono">
                      {r.value.toFixed(1)} {r.unit}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div>
            <p className="text-sm font-medium mb-2">Расход</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Параметр</TableHead>
                  <TableHead className="text-right">Значение</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {budget.expense.map((r, i) => (
                  <TableRow key={i} className={r.sign === '=' ? 'bg-muted/50 font-medium' : ''}>
                    <TableCell>{r.label}</TableCell>
                    <TableCell className="text-right font-mono">
                      {fmtRowValue(r)} {r.unit}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Availability-отчёт (ITU-R P.530) */}
      {availability && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex flex-wrap items-center justify-between gap-2">
              Доступность связи (ITU-R P.530)
              <Badge variant="outline">прогноз при запасе {availability.marginDb.toFixed(1)} дБ</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Прогноз недоступности</p>
                  <p className="text-xl font-semibold">{fmtHours(availability.outage.totalHoursPerYear)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Прогноз доступности</p>
                  <p className="text-xl font-semibold">
                    {availability.outage.availabilityPercent > 99.999
                      ? '> 99.999'
                      : availability.outage.availabilityPercent.toFixed(3)}{' '}
                    <span className="text-sm">%</span>
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">
                    Дождь R(0.01 %) — {rainSourceLabel(availability.rainSource)}
                  </p>
                  <p className="text-xl font-semibold">
                    {availability.rainRate001 !== null ? availability.rainRate001.toFixed(0) : '—'}{' '}
                    <span className="text-sm">мм/ч</span>
                  </p>
                </CardContent>
              </Card>
            </div>
            <p className="text-xs text-muted-foreground">
              Разбивка недоступности: многолучёвость {fmtSmallPercent(availability.outage.multipathPercent)}, дождь{' '}
              {fmtSmallPercent(availability.outage.rainPercent)} времени.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Цель доступности</TableHead>
                  <TableHead className="text-right">Требуемый запас, дБ</TableHead>
                  <TableHead className="text-right">Фактический запас, дБ</TableHead>
                  <TableHead className="text-right">Итог</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {availability.targets.map((t) => (
                  <TableRow key={t.availabilityPercent}>
                    <TableCell>{t.availabilityPercent} %</TableCell>
                    <TableCell className="text-right font-mono">{t.requiredMarginDb.toFixed(1)}</TableCell>
                    <TableCell className="text-right font-mono">{availability.marginDb.toFixed(1)}</TableCell>
                    <TableCell className={`text-right font-semibold ${t.met ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      {t.met ? '✓' : '✗'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground">
              Метод P.530-19: многолучёвость p₀ = {availability.multipathP0Percent.toFixed(3)} % → p = p₀·10^(−FM/10);
              дождь — A(0.01 %) по P.838 с path reduction factor (d₀ = 35·e^(−0.015·R₀.₀₁)), интерполяция A(p) по §2.4.1.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Поиск оптимальной позиции точки A: сворачиваемый блок, свёрнут — «найдено N оптимальных точек» */}
      {searchReport && (
        <details className="rounded-lg border p-3" open={!!searchProgress}>
          <summary className="cursor-pointer select-none text-sm font-medium">
            Поиск позиции A:{' '}
            {searchProgress
              ? `поиск… ${searchProgress.done}/${searchProgress.total}`
              : `найдено ${searchReport.optimalCount} оптимальных точек`}
            <span className="text-muted-foreground"> · радиус {searchReport.radiusM} м · просчитано {searchReport.candidatesTotal} позиц.</span>
          </summary>
          <div className="mt-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Позиция</TableHead>
                  <TableHead>СК-42 X, м</TableHead>
                  <TableHead>СК-42 Y, м</TableHead>
                  <TableHead className="text-right">Запас, дБ</TableHead>
                  <TableHead className="text-right">P_rx, дБм</TableHead>
                  <TableHead className="text-right">Потери, дБ</TableHead>
                  <TableHead className="text-right">От исходной, м</TableHead>
                  <TableHead className="text-right">Δ запаса, дБ</TableHead>
                  <TableHead>Диаграмма · применение</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="bg-muted/50 font-medium">
                  <TableCell>Исходная точка A</TableCell>
                  <TableCell className="font-mono">{fmtSk42SevenDigits(searchReport.baseline.x42)}</TableCell>
                  <TableCell className="font-mono">{fmtSk42SevenDigits(searchReport.baseline.y42)}</TableCell>
                  <TableCell className="text-right font-mono">{searchReport.baseline.linkMarginDb.toFixed(1)}</TableCell>
                  <TableCell className="text-right font-mono">{searchReport.baseline.prxDbm.toFixed(1)}</TableCell>
                  <TableCell className="text-right font-mono">{searchReport.baseline.medianLossDb.toFixed(1)}</TableCell>
                  <TableCell className="text-right font-mono">0</TableCell>
                  <TableCell className="text-right font-mono">—</TableCell>
                  <TableCell className="text-muted-foreground">—</TableCell>
                </TableRow>
                {searchReport.points
                  .filter((p) => p.linkMarginDb > searchReport!.baseline.linkMarginDb + 0.05)
                  .map((p, i) => (
                    <TableRow key={`${p.x42}-${p.y42}`}>
                      <TableCell>Кандидат {i + 1}</TableCell>
                      <TableCell className="font-mono">{fmtSk42SevenDigits(p.x42)}</TableCell>
                      <TableCell className="font-mono">{fmtSk42SevenDigits(p.y42)}</TableCell>
                      <TableCell className={`text-right font-mono ${marginCls(p.linkMarginDb)}`}>{p.linkMarginDb.toFixed(1)}</TableCell>
                      <TableCell className="text-right font-mono">{p.prxDbm.toFixed(1)}</TableCell>
                      <TableCell className="text-right font-mono">{p.medianLossDb.toFixed(1)}</TableCell>
                      <TableCell className="text-right font-mono">{Math.round(p.distFromOriginalM)}</TableCell>
                      <TableCell className="text-right font-mono text-emerald-600 dark:text-emerald-400">
                        +{(p.linkMarginDb - searchReport!.baseline.linkMarginDb).toFixed(1)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <HoverCard openDelay={200} closeDelay={100}>
                          <HoverCardTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              aria-label={`Диаграмма позиции ${i + 1}`}
                            >
                              <PieChart className="h-4 w-4" />
                            </Button>
                          </HoverCardTrigger>
                          <HoverCardContent className="w-[260px] p-2">
                            <CandidateCoveragePreview
                              candidateA={{ lat: p.lat, lon: p.lon }}
                              baseInput={lastInput!}
                              equipment={s.equipment}
                              hgtTiles={s.hgtTiles}
                              clutter={s.clutter}
                            />
                          </HoverCardContent>
                        </HoverCard>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 ml-1"
                          aria-label={`Применить позицию ${i + 1}`}
                          onClick={() => applyCandidate({ lat: p.lat, lon: p.lon })}
                        >
                          Применить
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                {searchReport.optimalCount === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground">
                      Лучше исходной позиции в радиусе {searchReport.radiusM} м не найдено — текущая точка A оптимальна.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground mt-2">
              Перебор по кольцам 0.25R/0.5R/0.75R/R (8/12/16/24 азимута) вокруг исходной точки A; все параметры связи
              и приёмо-передатчиков — из выполненного расчёта, меняется только позиция A (профиль перестраивается по
              рельефу). Позиции оцениваются локальной моделью (те же формулы, что выбранная) для скорости перебора.
              Пиктограмма диаграммы — предпросмотр покрытия от позиции кандидата (наведите курсор); «Применить»
              переносит точку A в позицию кандидата и пересчитывает. Координаты СК-42 Гаусс–Крюгер, зона{' '}
              {searchReport.baseline.zone}: X — от экватора на север, Y — с номером зоны (первая цифра); по 7 цифр
              на координату.
            </p>
          </div>
        </details>
      )}

      {/* Сравнение с P.2001 (роадмап 2.1): показывается при выбранной модели ITM */}
      {result.model === 'itm' && comparison && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex flex-wrap items-center justify-between gap-2">
              Сравнение моделей: ITM vs P.2001
              <Badge variant="outline" className="font-mono text-[10px]">{comparison.engineUsed}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Модель</TableHead>
                  <TableHead className="text-right">Медианные потери, дБ</TableHead>
                  <TableHead className="text-right">Запас на линию, дБ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Longley-Rice ITM (выбрана)</TableCell>
                  <TableCell className="text-right font-mono">{result.medianLossDb.toFixed(1)}</TableCell>
                  <TableCell className={`text-right font-mono ${marginCls(budget.linkMarginDb)}`}>{budget.linkMarginDb.toFixed(1)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>ITU-R P.2001 (перекрёстный расчёт)</TableCell>
                  <TableCell className="text-right font-mono">{comparison.medianLossDb.toFixed(1)}</TableCell>
                  <TableCell className={`text-right font-mono ${marginCls(comparison.linkMarginDb)}`}>{comparison.linkMarginDb.toFixed(1)}</TableCell>
                </TableRow>
                <TableRow className="bg-muted/50 font-medium">
                  <TableCell>Δ (ITM − P.2001)</TableCell>
                  <TableCell className="text-right font-mono">{(result.medianLossDb - comparison.medianLossDb).toFixed(1)}</TableCell>
                  <TableCell className="text-right font-mono">{(budget.linkMarginDb - comparison.linkMarginDb).toFixed(1)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground">
              Независимые модели NLOS: расхождение до 5–10 дБ — норма для пересечённого рельефа (оценка
              неопределённости); проектируйте запас по худшей оценке. P.2001 дополнительно учитывает
              изменчивость во времени и климатические карты.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Обратная линия: подвижный Tx → наземный Rx */}
      {reverseBudget && reverseResult && reverseInput ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex flex-wrap items-center justify-between gap-2">
              Обратная линия: подвижный Tx → наземный Rx
              <Badge variant="outline" className="font-mono">
                {reverseInput.frequencyMhz.toFixed(0)} МГц · {reverseResult.engineUsed}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <StatusChip status={revStatus!} />
            <div className="grid gap-3 sm:grid-cols-4">
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Медианные потери</p>
                  <p className="text-xl font-semibold">{reverseResult.medianLossDb.toFixed(1)} <span className="text-sm">дБ</span></p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">P_rx (наземный)</p>
                  <p className="text-xl font-semibold">{reverseBudget.prxDbm.toFixed(1)} <span className="text-sm">дБм</span></p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">SNR</p>
                  <p className="text-xl font-semibold">{reverseBudget.snrDb.toFixed(1)} <span className="text-sm">дБ</span></p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Запас на линию</p>
                  <p className={`text-xl font-semibold ${STATUS_META[revStatus!].text}`}>
                    {reverseBudget.linkMarginDb.toFixed(1)} <span className="text-sm">дБ</span>
                  </p>
                </CardContent>
              </Card>
            </div>
            {revStatus !== 'stable' && (
              <div className={`rounded-lg border p-3 flex items-center gap-2 ${STATUS_META[revStatus!].border}`}>
                <AlertTriangle className={`h-5 w-5 shrink-0 ${STATUS_META[revStatus!].text}`} />
                <p className={`text-sm font-medium ${STATUS_META[revStatus!].alert}`}>
                  {revStatus === 'marginal'
                    ? 'Обратная линия нестабильна: запас на грани — возможны срывы при замираниях (SNR ниже требуемого Eb/N₀ на ' + Math.abs(reverseBudget.linkMarginDb).toFixed(1) + ' дБ).'
                    : 'Обратная линия отсутствует (SNR ниже требуемого Eb/N₀ на ' + Math.abs(reverseBudget.linkMarginDb).toFixed(1) + ' дБ).'}
                </p>
              </div>
            )}
            {reverseAvailability && (
              <p className="text-xs text-muted-foreground">
                Прогноз доступности (P.530): {availabilitySummary(reverseAvailability)}.
              </p>
            )}
            <CardContent className="grid gap-4 md:grid-cols-2 p-0">
              <div>
                <p className="text-sm font-medium mb-2">Приход</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Параметр</TableHead>
                      <TableHead className="text-right">Значение</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reverseBudget.income.map((r, i) => (
                      <TableRow key={i} className={r.sign === '=' ? 'bg-muted/50 font-medium' : ''}>
                        <TableCell>{r.label}</TableCell>
                        <TableCell className="text-right font-mono">
                          {r.value.toFixed(1)} {r.unit}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div>
                <p className="text-sm font-medium mb-2">Расход</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Параметр</TableHead>
                      <TableHead className="text-right">Значение</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reverseBudget.expense.map((r, i) => (
                      <TableRow key={i} className={r.sign === '=' ? 'bg-muted/50 font-medium' : ''}>
                        <TableCell>{r.label}</TableCell>
                        <TableCell className="text-right font-mono">
                          {fmtRowValue(r)} {r.unit}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </CardContent>
        </Card>
      ) : !(reverseRangeResults && reverseRangeResults.length > 0) ? (
        <p className="text-xs text-muted-foreground">
          Обратная линия не рассчитана:{' '}
          {mobileFrequencyMode === 'range'
            ? 'включён режим диапазона для подвижного — выполните расчёт, чтобы получить развёртку обратной линии.'
            : mobileFrequencyMhz < 500 || mobileFrequencyMhz > 7000
              ? 'частота подвижного передатчика вне диапазона 500–7000 МГц.'
              : 'частота подвижного передатчика совпадает с частотой наземного.'}
        </p>
      ) : null}

      {/* Обратная линия — развёртка по диапазону частот подвижного передатчика */}
      {reverseRangeResults && reverseRangeResults.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex flex-wrap items-center justify-between gap-2">
              Обратная линия — диапазон частот:{' '}
              {reverseRangeResults[0].frequencyMhz.toFixed(1)}–
              {reverseRangeResults[reverseRangeResults.length - 1].frequencyMhz.toFixed(1)} МГц
              <Badge variant="outline" className="font-mono">подвижный Tx → наземный Rx</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-2">
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={reverseRangeData} margin={{ top: 5, right: 10, bottom: 16, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="f" tick={{ fontSize: 11 }} label={{ value: 'МГц', position: 'insideBottom', offset: -8, fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(value: number, name: string) => [`${value} дБ`, name === 'loss' ? 'Потери' : 'Запас']}
                    labelFormatter={(l) => `${l} МГц`}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => (v === 'loss' ? 'Потери' : 'Запас (link margin)')} />
                  <Line type="monotone" dataKey="loss" stroke="#d97706" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="margin" stroke="#dc2626" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">Частота, МГц</TableHead>
                  <TableHead className="text-right">Потери, дБ</TableHead>
                  <TableHead className="text-right">P_rx (наземный), дБм</TableHead>
                  <TableHead className="text-right">SNR, дБ</TableHead>
                  <TableHead className="text-right">Запас, дБ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reverseRangeResults.map((r) => (
                  <TableRow key={r.frequencyMhz}>
                    <TableCell className="text-right font-mono">{r.frequencyMhz.toFixed(1)}</TableCell>
                    <TableCell className="text-right font-mono">{r.medianLossDb.toFixed(1)}</TableCell>
                    <TableCell className="text-right font-mono">{r.prxDbm.toFixed(1)}</TableCell>
                    <TableCell className="text-right font-mono">{r.snrDb.toFixed(1)}</TableCell>
                    <TableCell className={`text-right font-mono ${marginCls(r.linkMarginDb)}`}>
                      {r.linkMarginDb.toFixed(1)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Круговая диаграмма радиосигнала с учётом рельефа */}
      <CoveragePanel />

      {/* Профиль трассы */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Профиль трассы: рельеф, прямая видимость, зона Френеля, препятствия
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={profileData} margin={{ top: 5, right: 10, bottom: 20, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis
                  dataKey="dKm"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tick={{ fontSize: 11 }}
                  label={{ value: 'км', position: 'insideBottom', offset: -12, fontSize: 11 }}
                />
                <YAxis tick={{ fontSize: 11 }} label={{ value: 'м', angle: -90, position: 'insideLeft', fontSize: 11 }} />
                <Tooltip
                  formatter={(value: number | string, name: string) => [value, name]}
                  labelFormatter={(l) => `d = ${l} км`}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="рельеф" stackId="t" stroke="#57534e" fill="#a8a29e" fillOpacity={0.9} isAnimationActive={false} />
                <Area type="monotone" dataKey="препятствие" stackId="t" stroke="#78350f" fill="#d97706" fillOpacity={0.8} isAnimationActive={false} name="Здания/растительность" />
                <Line type="monotone" dataKey="френель" stroke="#0891b2" strokeDasharray="4 4" dot={false} strokeWidth={1} name="Зона Френеля (Fresnel) F1" isAnimationActive={false} />
                <Line type="monotone" dataKey="LOS" stroke="#dc2626" dot={false} strokeWidth={2} name="Прямая видимость (LOS)" isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Высоты показаны с учётом кривизны Земли (k = {s.kFactor.toFixed(2)}). Препятствия — здания/растительность из данных clutter.
          </p>
          {clearanceAudit && (
            <div className="mt-3 rounded-lg border p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Аудит просвета (0.6·F1):</span>
                <Badge
                  variant="outline"
                  className={clearanceAudit.routeClass === 'light' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}
                >
                  {clearanceAudit.routeClass === 'light' ? 'лёгкая трасса (light)' : 'тяжёлая трасса (heavy)'}
                </Badge>
                {clearanceAudit.extraDiffractionDb > 0.1 && (
                  <span className="text-xs text-amber-600 dark:text-amber-400">
                    доп. потери при подрефракции K = 2/3: +{clearanceAudit.extraDiffractionDb.toFixed(1)} дБ
                  </span>
                )}
              </div>
              <div className="grid gap-1.5 sm:grid-cols-3 text-xs">
                {clearanceAudit.ks.map((k) => (
                  <div key={k.label} className="rounded border p-2">
                    <p className="font-mono font-medium">{k.label}</p>
                    <p className={CLEARANCE_META[k.verdict].cls}>
                      {CLEARANCE_META[k.verdict].label}
                      {Number.isFinite(k.minRatio) && (
                        <span className="text-muted-foreground"> · min {k.minRatio.toFixed(2)}·F1 ({k.minClearanceM.toFixed(0)} м)</span>
                      )}
                    </p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Просвет считается по профилю (рельеф + clutter) с выпуклостью Земли: K = 4/3 — стандартная рефракция,
                K = 2/3 — подрефракция (худший случай), K = ∞ — плоская Земля. «Лёгкая трасса» — 0.6·F1 выполняется
                и при 4/3, и при 2/3.
              </p>
            </div>
          )}
          {diffractionMethods && (
            <details className="mt-3 rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium select-none">
                Сравнение методов дифракции · {diffractionMethods.edgeCount} препятств.
                {diffractionMethods.edgeCount === 1 ? 'ие' : 'ий'} · разброс {diffractionMethods.spreadDb.toFixed(1)} дБ
              </summary>
              <Table className="mt-2">
                <TableHeader>
                  <TableRow>
                    <TableHead>Метод (P.526)</TableHead>
                    <TableHead className="text-right">Потери, дБ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>Буллингтон (§4.5.2) — эквивалентное ребро</TableCell>
                    <TableCell className="text-right font-mono">{diffractionMethods.bullingtonDb.toFixed(1)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Дейгаут (§4.4) — главные препятствия</TableCell>
                    <TableCell className="text-right font-mono">{diffractionMethods.deygoutDb.toFixed(1)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Эпштейн–Петерсон (§4.5.1) — последовательные рёбра</TableCell>
                    <TableCell className="text-right font-mono">{diffractionMethods.epsteinPetersonDb.toFixed(1)}</TableCell>
                  </TableRow>
                  <TableRow className="bg-muted/50 font-medium">
                    <TableCell>В расчёте: max(Дейгаут, Буллингтон)</TableCell>
                    <TableCell className="text-right font-mono">{diffractionMethods.currentDb.toFixed(1)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground mt-2">
                Методы сходятся — дифракционной оценке можно верить. Разброс 5–10 дБ и больше — на трассе несколько
                сопоставимых препятствий, точность ограничена знанием рельефа: запас лучше брать по худшей оценке
                (Буллингтон обычно занижает, Дейгаут может завышать, Эпштейн–Петерсон — между ними).
              </p>
            </details>
          )}
        </CardContent>
      </Card>

      {/* Сводка по диапазону частот */}
      {rangeResults && rangeResults.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Диапазон частот: {rangeResults[0].frequencyMhz.toFixed(1)}–{rangeResults[rangeResults.length - 1].frequencyMhz.toFixed(1)} МГц
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-2">
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rangeData} margin={{ top: 5, right: 10, bottom: 16, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="f" tick={{ fontSize: 11 }} label={{ value: 'МГц', position: 'insideBottom', offset: -8, fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(value: number, name: string) => [`${value} дБ`, name === 'loss' ? 'Потери' : 'Запас']}
                    labelFormatter={(l) => `${l} МГц`}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => (v === 'loss' ? 'Потери' : 'Запас (link margin)')} />
                  <Line type="monotone" dataKey="loss" stroke="#0f766e" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="margin" stroke="#dc2626" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">Частота, МГц</TableHead>
                  <TableHead className="text-right">Потери, дБ</TableHead>
                  <TableHead className="text-right">P_rx, дБм</TableHead>
                  <TableHead className="text-right">SNR, дБ</TableHead>
                  <TableHead className="text-right">Запас, дБ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rangeResults.map((r) => (
                  <TableRow key={r.frequencyMhz}>
                    <TableCell className="text-right font-mono">{r.frequencyMhz.toFixed(1)}</TableCell>
                    <TableCell className="text-right font-mono">{r.medianLossDb.toFixed(1)}</TableCell>
                    <TableCell className="text-right font-mono">{r.prxDbm.toFixed(1)}</TableCell>
                    <TableCell className="text-right font-mono">{r.snrDb.toFixed(1)}</TableCell>
                    <TableCell className={`text-right font-mono ${marginCls(r.linkMarginDb)}`}>
                      {r.linkMarginDb.toFixed(1)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Потери vs % времени (P.2001) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Потери vs процент времени (P.2001)</CardTitle>
          </CardHeader>
          <CardContent>
            {result.byTimePercent.length > 1 ? (
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={result.byTimePercent.map((t) => ({ p: t.percent, loss: +t.lossDb.toFixed(1) }))} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="p" tick={{ fontSize: 11 }} label={{ value: '% времени', position: 'insideBottom', offset: -4, fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
                    <Tooltip formatter={(v) => [`${v} дБ`, 'Потери']} labelFormatter={(l) => `Превышаются ${l}% времени`} />
                    <Line type="monotone" dataKey="loss" stroke="#0f766e" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Кривая изменчивости доступна только для модели P.2001 (детерминированная FSPL+P.526 не зависит от процента времени).
              </p>
            )}
          </CardContent>
        </Card>

        {/* Вклад механизмов */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Вклад механизмов потерь, дБ</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={breakdownData} layout="vertical" margin={{ top: 5, right: 10, bottom: 5, left: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={150} />
                  <Tooltip formatter={(v) => [`${v} дБ`, 'Потери']} />
                  <Bar dataKey="value" fill="#0f766e" radius={[0, 4, 4, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Экспорт */}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={doExportJson}>
          <FileJson className="h-4 w-4 mr-1" /> Экспорт JSON
        </Button>
        <Button variant="outline" size="sm" onClick={doExportCsv}>
          <FileSpreadsheet className="h-4 w-4 mr-1" /> Экспорт CSV
        </Button>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Download className="h-4 w-4 mr-1" /> Печать
        </Button>
      </div>
    </div>
  )
}

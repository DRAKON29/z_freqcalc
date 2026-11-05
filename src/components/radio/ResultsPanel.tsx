'use client'

/**
 * Результаты — ТЗ 4.4.4, 4.8, 4.9:
 * бюджет линии (таблица приход/расход + предупреждение при margin < 0),
 * профиль трассы (рельеф, LOS, зона Френеля, препятствия),
 * график потерь vs процент времени (P.2001), вклад механизмов,
 * экспорт JSON/CSV.
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
import { AlertTriangle, Download, FileJson, FileSpreadsheet } from 'lucide-react'

export function ResultsPanel() {
  const s = useRadioStore()
  const { result, budget, lastInput } = s

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

  if (!result || !budget) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Выполните расчёт — здесь появятся бюджет линии, профиль трассы и графики.
        </CardContent>
      </Card>
    )
  }

  const doExportJson = () => {
    const payload = buildExportPayload(lastInput!, result, budget, s.dynamics ?? undefined)
    download(`расчёт-${new Date().toISOString().slice(0, 19)}.json`, toJson(payload), 'application/json')
  }
  const doExportCsv = () => {
    const payload = buildExportPayload(lastInput!, result, budget)
    download(`расчёт-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(payload), 'text/csv')
  }

  const marginColor = budget.linkMarginDb < 0 ? 'bg-destructive' : 'bg-emerald-600'

  return (
    <div className="space-y-4">
      {/* Предупреждения fallback (ТЗ 4.2.3) */}
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
            <p className="text-xs text-muted-foreground">SNR</p>
            <p className="text-2xl font-semibold">{budget.snrDb.toFixed(1)} <span className="text-sm">дБ</span></p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Link margin</p>
            <p className={`text-2xl font-semibold ${budget.linkMarginDb < 0 ? 'text-destructive' : 'text-emerald-600'}`}>
              {budget.linkMarginDb.toFixed(1)} <span className="text-sm">дБ</span>
            </p>
          </CardContent>
        </Card>
      </div>

      {budget.linkMarginDb < 0 && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <p className="text-sm text-destructive font-medium">
            Link margin &lt; 0: линия связи не обеспечивается (SNR ниже требуемого Eb/N₀ на {Math.abs(budget.linkMarginDb).toFixed(1)} дБ).
          </p>
        </div>
      )}

      {/* Бюджет линии: приход/расход */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            Бюджет линии (ТЗ 4.4.4)
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
                      {r.value.toFixed(1)} {r.unit}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

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
                <Line type="monotone" dataKey="френель" stroke="#0891b2" strokeDasharray="4 4" dot={false} strokeWidth={1} name="Зона Френеля F1" isAnimationActive={false} />
                <Line type="monotone" dataKey="LOS" stroke="#dc2626" dot={false} strokeWidth={2} name="Прямая видимость" isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Высоты показаны с учётом кривизны Земли (k = {s.kFactor.toFixed(2)}). Препятствия — здания/растительность из clutter.geojson.
          </p>
        </CardContent>
      </Card>

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

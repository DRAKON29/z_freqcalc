'use client'

/**
 * Динамические (летающие) объекты:
 * параметры борта, заполнение параметров «от трассы» (вручную — только высота
 * и путевая скорость), расчёт по одной или нескольким высотам (переключатель,
 * добавление высот кнопкой «+»), доплеровский сдвиг Δf = (v_r/c)·f,
 * предупреждение при выходе из зоны связи, анимация при ≥ 24 FPS,
 * иначе интерактивные графики с tooltip.
 */
import { useState } from 'react'
import { useRadioStore } from '@/store/radio-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts'
import { FPS_THRESHOLD, LIMITS } from '@/lib/radio/constants'
import { bearingDeg, distanceM } from '@/lib/radio/coordinates'
import { routeDurationS } from '@/lib/radio/route'
import { Play, Timer, Plane, Route, Plus, X, Upload } from 'lucide-react'

const ALT_COLORS = ['#0f766e', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#65a30d', '#db2777', '#475569']

function altColor(idx: number): string {
  return ALT_COLORS[idx % ALT_COLORS.length]
}

export function DynamicsPanel() {
  const dp = useRadioStore((s) => s.dynamicsParams)
  const setDp = useRadioStore((s) => s.setDynamicsParams)
  const dynamics = useRadioStore((s) => s.dynamics)
  const dynamicsAll = useRadioStore((s) => s.dynamicsAll)
  const runDynamics = useRadioStore((s) => s.runDynamics)
  const result = useRadioStore((s) => s.result)
  const fpsMeasured = useRadioStore((s) => s.fpsMeasured)
  const animationAllowed = useRadioStore((s) => s.animationAllowed)
  const setField = useRadioStore((s) => s.setField)
  const altitudeMode = useRadioStore((s) => s.altitudeMode)
  const altitudes = useRadioStore((s) => s.altitudes)
  const setAltitudes = useRadioStore((s) => s.setAltitudes)
  const applyFromTrack = useRadioStore((s) => s.applyDynamicsFromTrack)
  const route = useRadioStore((s) => s.route)
  const loadRoute = useRadioStore((s) => s.loadRoute)
  const clearRoute = useRadioStore((s) => s.clearRoute)
  const pointA = useRadioStore((s) => s.pointA)
  const pointB = useRadioStore((s) => s.pointB)
  const lastError = useRadioStore((s) => s.lastError)

  const isMulti = altitudeMode === 'multi'
  const [routeError, setRouteError] = useState<string | null>(null)

  const uploadRoute = async (file: File) => {
    const text = await file.text()
    const res = loadRoute(file.name, text)
    setRouteError(res.ok ? null : res.error ?? 'Ошибка загрузки файла траектории')
  }

  // Данные графиков: серии по высотам (маршрут — одна серия «По маршруту»)
  const seriesName = (d: { label?: string; altitudeM?: number }) => d.label ?? `${d.altitudeM ?? dp.altitudeM} м`
  const seriesNames = dynamicsAll.map(seriesName)
  const times = dynamicsAll[0]?.samples.map((s) => s.t) ?? []
  const chartData = times.map((t, i) => {
    const row: Record<string, number> = { t: +t.toFixed(1) }
    for (const d of dynamicsAll) {
      const sm = d.samples[i]
      const name = seriesName(d)
      if (sm) {
        row[`dop_${name}`] = +sm.dopplerHz.toFixed(0)
        row[`elev_${name}`] = +sm.elevationDeg.toFixed(2)
        row[`azim_${name}`] = +sm.azimuthDeg.toFixed(1)
        row[`margin_${name}`] = +sm.linkMarginDb.toFixed(1)
        row[`snr_${name}`] = +sm.snrDb.toFixed(1)
      }
    }
    return row
  })

  const trackAz = bearingDeg(pointA, pointB)
  const trackDistKm = distanceM(pointA, pointB) / 1000

  const num = (
    label: string,
    key: keyof typeof dp,
    value: number,
    onChange: (v: number) => void,
    min?: number,
    max?: number,
  ) => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input type="number" value={value} min={min} max={max} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )

  const addAltitude = () => {
    const last = altitudes.length > 0 ? altitudes[altitudes.length - 1] : dp.altitudeM
    const next = Math.max(5, last + 500)
    setAltitudes([...altitudes, next])
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Plane className="h-4 w-4 text-emerald-600" /> Параметры борта
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Маршрут из файла */}
          <div className="rounded-lg border p-2.5 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex">
                <Input
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void uploadRoute(f)
                    e.target.value = ''
                  }}
                />
                <Button size="sm" variant="outline" asChild>
                  <span>
                    <Upload className="h-4 w-4 mr-1" /> {route ? 'Заменить траекторию…' : 'Загрузить траекторию…'}
                  </span>
                </Button>
              </label>
              {route && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    clearRoute()
                    setRouteError(null)
                  }}
                  title="Убрать маршрут и вернуться к ручным параметрам"
                >
                  <X className="h-4 w-4 mr-1" /> Убрать
                </Button>
              )}
              <p className="text-xs text-muted-foreground flex-1 min-w-[220px]">
                Файл траектории (расширение любое): JSON вида{' '}
                <code className="text-[10px]">{`{route:{points:[{lat,lon,altitude,speed}]},tripodHeight}`}</code>; минимум 4
                точки, первая и последняя — концы траектории; высота в м, скорость в км/ч.
              </p>
            </div>
            {route && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Badge className="bg-emerald-600 text-[10px]">Маршрут: {route.name ?? 'файл'}</Badge>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="rounded border bg-muted/30 px-2 py-1">
                    <span className="text-muted-foreground">Точек:</span>{' '}
                    <span className="font-medium">{route.points.length}</span>
                  </div>
                  <div className="rounded border bg-muted/30 px-2 py-1">
                    <span className="text-muted-foreground">Длительность:</span>{' '}
                    <span className="font-medium">{(routeDurationS(route) / 60).toFixed(1)} мин</span>
                  </div>
                  <div className="rounded border bg-muted/30 px-2 py-1">
                    <span className="text-muted-foreground">Высота:</span>{' '}
                    <span className="font-medium">
                      {Math.min(...route.points.map((p) => p.altitudeM))}–{Math.max(...route.points.map((p) => p.altitudeM))} м
                    </span>
                  </div>
                  <div className="rounded border bg-muted/30 px-2 py-1">
                    <span className="text-muted-foreground">Скорость:</span>{' '}
                    <span className="font-medium">
                      {Math.min(...route.points.map((p) => p.speedKmh))}–{Math.max(...route.points.map((p) => p.speedKmh))} км/ч
                    </span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Первая и последняя точки маршрута перенесены в трассу A–Б (вкладка «Расчёт»), высота штатива из
                  файла ({route.tripodHeightM} м) — к антенне наземной станции. Выполните расчёт на вкладке «Расчёт»
                  для новой трассы. Высота и скорость полёта берутся из маршрута; длительность моделирования
                  игнорируется.
                </p>
              </div>
            )}
            {routeError && <p className="text-xs text-destructive">{routeError}</p>}
          </div>

          {/* Заполнение от трассы (без маршрута из файла) */}
          {!route && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2.5">
            <Button
              size="sm"
              variant="outline"
              onClick={applyFromTrack}
              title="Азимут, начальные углы и длительность берутся из трассы A–Б"
            >
              <Route className="h-4 w-4 mr-1" /> От трассы
            </Button>
            <p className="text-xs text-muted-foreground flex-1 min-w-[200px]">
              Параметры из трассы: азимут траектории и начальный азимут = {trackAz.toFixed(1)}°,
              начальный угол места = 90° (объект над точкой A), длительность = длина трассы
              ({trackDistKm.toFixed(1)} км) / путевая скорость. Вручную остаются только{' '}
              <b>высота полёта</b> и <b>путевая скорость</b>.
            </p>
          </div>
          )}

          {/* Режим высот и ручные параметры — без маршрута из файла */}
          {!route && (
          <>
          <div className="flex items-center justify-between rounded-lg border p-2.5">
            <div className="flex items-center gap-2 text-sm">
              <span className={!isMulti ? 'font-medium' : 'text-muted-foreground'}>Одна высота</span>
              <Switch
                checked={isMulti}
                onCheckedChange={(v) => setField('altitudeMode', v ? 'multi' : 'single')}
                aria-label="Переключатель режима высот"
              />
              <span className={isMulti ? 'font-medium' : 'text-muted-foreground'}>Несколько высот</span>
            </div>
            {isMulti && <Badge variant="secondary" className="text-[10px]">{altitudes.length} высот</Badge>}
          </div>

          {isMulti ? (
            <div className="space-y-2">
              <Label className="text-xs">Высоты полёта, м (добавляйте кнопкой «+»)</Label>
              <div className="flex flex-wrap items-center gap-2">
                {altitudes.map((a, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <Input
                      type="number"
                      min={5}
                      max={20000}
                      value={a}
                      onChange={(e) => {
                        const list = [...altitudes]
                        list[i] = Number(e.target.value)
                        setAltitudes(list)
                      }}
                      className="w-24 h-9"
                      style={{ borderColor: altColor(i) }}
                    />
                    <button
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setAltitudes(altitudes.filter((_, j) => j !== i))}
                      title="Убрать высоту"
                      aria-label={`Убрать высоту ${a}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={addAltitude} aria-label="Добавить высоту">
                  <Plus className="h-4 w-4" /> Добавить
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              {num('Высота полёта, м', 'altitudeM', dp.altitudeM, (v) => setDp({ altitudeM: v }), 5, 20000)}
              {num(`Путевая скорость, км/ч (${LIMITS.speedMinKmh}–${LIMITS.speedMaxKmh})`, 'speedKmh', dp.speedKmh, (v) => setDp({ speedKmh: v }), LIMITS.speedMinKmh, LIMITS.speedMaxKmh)}
              {num('Длительность моделирования, с', 'durationS', dp.durationS, (v) => setDp({ durationS: v }), 10, 3600)}
            </div>
          )}

          {isMulti && (
            <div className="grid gap-3 sm:grid-cols-2">
              {num(`Путевая скорость, км/ч (${LIMITS.speedMinKmh}–${LIMITS.speedMaxKmh})`, 'speedKmh', dp.speedKmh, (v) => setDp({ speedKmh: v }), LIMITS.speedMinKmh, LIMITS.speedMaxKmh)}
              {num('Длительность моделирования, с', 'durationS', dp.durationS, (v) => setDp({ durationS: v }), 10, 3600)}
            </div>
          )}
          </>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={runDynamics} disabled={!result}>
              <Play className="h-4 w-4 mr-1" /> Рассчитать динамику
            </Button>
            {dynamics && animationAllowed !== false && (
              <Button size="sm" variant="outline" onClick={() => setField('animationAllowed', true)}>
                <Timer className="h-4 w-4 mr-1" /> Анимировать на карте
              </Button>
            )}
            {!result && <p className="text-xs text-muted-foreground">Сначала выполните расчёт на вкладке «Расчёт».</p>}
          </div>
          {dynamics && fpsMeasured !== null && (
            <p className="text-xs text-muted-foreground">
              Измеренный FPS анимации: <span className="font-medium">{fpsMeasured}</span> (порог {FPS_THRESHOLD}).
            </p>
          )}
          {lastError && <p className="text-xs text-destructive">{lastError}</p>}
        </CardContent>
      </Card>

      {dynamics && (
        <>
          {/* Сводка */}
          <div className="grid gap-3 sm:grid-cols-4">
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Макс. доплер (Doppler)</p>
                <p className="text-xl font-semibold">
                  {Math.max(...dynamicsAll.map((d) => d.maxDopplerHz), 0).toFixed(0)} Гц
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Мин. запас (link margin)</p>
                <p className={`text-xl font-semibold ${Math.min(...dynamicsAll.map((d) => d.minMarginDb)) < 0 ? 'text-destructive' : 'text-emerald-600'}`}>
                  {Math.min(...dynamicsAll.map((d) => d.minMarginDb)).toFixed(1)} дБ
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Выход из зоны связи</p>
                <p className="text-xl font-semibold">
                  {dynamicsAll.some((d) => d.exitTimeS !== null)
                    ? `${Math.min(...dynamicsAll.filter((d) => d.exitTimeS !== null).map((d) => d.exitTimeS as number)).toFixed(0)} с`
                    : 'нет'}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">{route ? 'Точек' : 'Высот / точек'}</p>
                <p className="text-xl font-semibold">
                  {route ? dynamics.samples.length : `${dynamicsAll.length} / ${dynamics.samples.length}`}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Таблица по высотам (многовысотный режим) */}
          {isMulti && dynamicsAll.length > 1 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Результаты по высотам</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Высота, м</TableHead>
                      <TableHead className="text-right">Макс. доплер, Гц</TableHead>
                      <TableHead className="text-right">Мин. запас, дБ</TableHead>
                      <TableHead className="text-right">Выход из зоны, с</TableHead>
                      <TableHead className="text-right">Точек</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dynamicsAll.map((d) => (
                      <TableRow key={d.altitudeM}>
                        <TableCell className="font-medium">{d.altitudeM}</TableCell>
                        <TableCell className="text-right font-mono">{d.maxDopplerHz.toFixed(0)}</TableCell>
                        <TableCell className={`text-right font-mono ${d.minMarginDb < 0 ? 'text-destructive' : ''}`}>
                          {d.minMarginDb.toFixed(1)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {d.exitTimeS === null ? '—' : d.exitTimeS.toFixed(0)}
                        </TableCell>
                        <TableCell className="text-right font-mono">{d.samples.length}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {dynamicsAll.flatMap((d) => d.warnings).length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-1">
                  {dynamicsAll
                    .filter((d) => d.warnings.length > 0)
                    .map((d) =>
                      d.warnings.map((w, i) => (
                        <p key={`${d.label ?? d.altitudeM}-${i}`} className="text-sm text-amber-800 dark:text-amber-300">
                          ⚠ {d.label ? `${d.label}: ` : d.altitudeM ? `H = ${d.altitudeM} м: ` : ''}
                          {w}
                        </p>
                      )),
                    )}
            </div>
          )}

          {/* Графики динамики с tooltip */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Углы и доплер (Doppler)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 5, right: 10, bottom: 16, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="t" tick={{ fontSize: 11 }} label={{ value: 't, с', position: 'insideBottom', offset: -10, fontSize: 11 }} />
                      <YAxis yAxisId="ang" tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="hz" orientation="right" tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(value: number, name: string) => {
                          if (name.startsWith('elev_')) return [value, `Угол места, ${name.slice(5)}`]
                          if (name.startsWith('azim_')) return [value, `Азимут, ${name.slice(5)}`]
                          return [value, `Доплер, ${name.slice(5)}`]
                        }}
                        labelFormatter={(l) => `t = ${l} с`}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: 12 }}
                        formatter={(v) => {
                          const s = String(v)
                          if (s.startsWith('elev_')) return `Угол места ${s.slice(5)}`
                          if (s.startsWith('azim_')) return `Азимут ${s.slice(5)}`
                          return `Доплер ${s.slice(5)}`
                        }}
                      />
                      {dynamicsAll.map((d, idx) => (
                        <Line
                          key={`elev-${seriesName(d)}`}
                          yAxisId="ang"
                          type="monotone"
                          dataKey={`elev_${seriesName(d)}`}
                          stroke={altColor(idx)}
                          dot={false}
                          isAnimationActive={false}
                          strokeWidth={2}
                        />
                      ))}
                      {dynamicsAll.map((d, idx) => (
                        <Line
                          key={`dop-${seriesName(d)}`}
                          yAxisId="hz"
                          type="monotone"
                          dataKey={`dop_${seriesName(d)}`}
                          stroke={altColor(idx)}
                          dot={false}
                          isAnimationActive={false}
                          strokeDasharray="5 3"
                        />
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">ОСШ (SNR) и запас (link margin)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 5, right: 10, bottom: 16, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="t" tick={{ fontSize: 11 }} label={{ value: 't, с', position: 'insideBottom', offset: -10, fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(value: number, name: string) => [
                          `${value} дБ`,
                          name.startsWith('margin_') ? `Запас ${name.slice(7)}` : `ОСШ ${name.slice(4)}`,
                        ]}
                        labelFormatter={(l) => `t = ${l} с`}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: 12 }}
                        formatter={(v) => {
                          const s = String(v)
                          return s.startsWith('margin_') ? `Запас ${s.slice(7)}` : `ОСШ ${s.slice(4)}`
                        }}
                      />
                      {dynamicsAll.map((d, idx) => (
                        <Line
                          key={`snr-${seriesName(d)}`}
                          type="monotone"
                          dataKey={`snr_${seriesName(d)}`}
                          stroke={altColor(idx)}
                          dot={false}
                          isAnimationActive={false}
                        />
                      ))}
                      {dynamicsAll.map((d, idx) => (
                        <Line
                          key={`margin-${seriesName(d)}`}
                          type="monotone"
                          dataKey={`margin_${seriesName(d)}`}
                          stroke={altColor(idx)}
                          dot={false}
                          isAnimationActive={false}
                          strokeDasharray="5 3"
                          strokeWidth={2}
                        />
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {dynamicsAll.some((d) => d.exitTimeS !== null) && (
            <Badge variant="destructive">
              Объект покидает зону связи через{' '}
              {Math.min(...dynamicsAll.filter((d) => d.exitTimeS !== null).map((d) => d.exitTimeS as number)).toFixed(0)} с
            </Badge>
          )}
        </>
      )}
    </div>
  )
}

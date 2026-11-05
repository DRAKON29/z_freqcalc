'use client'

/**
 * Динамические (летающие) объекты — ТЗ 4.5:
 * параметры борта, доплеровский сдвиг Δf = (v_r/c)·f, обязательный учёт
 * доплера в бюджете, предупреждение при выходе из зоны связи,
 * анимация при ≥ 24 FPS, иначе интерактивные графики с tooltip.
 */
import { useRadioStore } from '@/store/radio-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import { Play, Timer, Plane } from 'lucide-react'

export function DynamicsPanel() {
  const dp = useRadioStore((s) => s.dynamicsParams)
  const setDp = useRadioStore((s) => s.setDynamicsParams)
  const dynamics = useRadioStore((s) => s.dynamics)
  const runDynamics = useRadioStore((s) => s.runDynamics)
  const result = useRadioStore((s) => s.result)
  const fpsMeasured = useRadioStore((s) => s.fpsMeasured)
  const animationAllowed = useRadioStore((s) => s.animationAllowed)
  const setField = useRadioStore((s) => s.setField)

  const chartData = (dynamics?.samples ?? []).map((sm) => ({
    t: +sm.t.toFixed(1),
    elev: +sm.elevationDeg.toFixed(2),
    azim: +sm.azimuthDeg.toFixed(1),
    doppler: +sm.dopplerHz.toFixed(0),
    margin: +sm.linkMarginDb.toFixed(1),
    snr: +sm.snrDb.toFixed(1),
  }))

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

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Plane className="h-4 w-4 text-emerald-600" /> Параметры борта (ТЗ 4.5.1)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            {num('Высота полёта, м', 'altitudeM', dp.altitudeM, (v) => setDp({ altitudeM: v }), 5, 20000)}
            {num(`Путевая скорость, км/ч (${LIMITS.speedMinKmh}–${LIMITS.speedMaxKmh})`, 'speedKmh', dp.speedKmh, (v) => setDp({ speedKmh: v }), LIMITS.speedMinKmh, LIMITS.speedMaxKmh)}
            {num('Азимут траектории, °', 'trajectoryAzimuthDeg', dp.trajectoryAzimuthDeg, (v) => setDp({ trajectoryAzimuthDeg: v }), 0, 360)}
            {num('Начальный угол места, °', 'initialElevationDeg', dp.initialElevationDeg, (v) => setDp({ initialElevationDeg: v }), -30, 90)}
            {num('Начальный азимут, °', 'initialAzimuthDeg', dp.initialAzimuthDeg, (v) => setDp({ initialAzimuthDeg: v }), 0, 360)}
            {num('Длительность моделирования, с', 'durationS', dp.durationS, (v) => setDp({ durationS: v }), 10, 3600)}
          </div>
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
              Измеренный FPS анимации: <span className="font-medium">{fpsMeasured}</span> (порог {FPS_THRESHOLD},
              решение по ТЗ 4.5.3 зафиксировано в README).
            </p>
          )}
        </CardContent>
      </Card>

      {dynamics && (
        <>
          {/* Сводка */}
          <div className="grid gap-3 sm:grid-cols-4">
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Макс. доплер</p>
                <p className="text-xl font-semibold">{dynamics.maxDopplerHz.toFixed(0)} Гц</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Мин. link margin</p>
                <p className={`text-xl font-semibold ${dynamics.minMarginDb < 0 ? 'text-destructive' : 'text-emerald-600'}`}>
                  {dynamics.minMarginDb.toFixed(1)} дБ
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Выход из зоны связи</p>
                <p className="text-xl font-semibold">
                  {dynamics.exitTimeS === null ? 'нет' : `${dynamics.exitTimeS.toFixed(0)} с`}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Точек расчёта</p>
                <p className="text-xl font-semibold">{dynamics.samples.length}</p>
              </CardContent>
            </Card>
          </div>

          {dynamics.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-1">
              {dynamics.warnings.map((w, i) => (
                <p key={i} className="text-sm text-amber-800 dark:text-amber-300">⚠ {w}</p>
              ))}
            </div>
          )}

          {/* Графики динамики с tooltip (ТЗ 4.5.3) */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Углы и доплер</CardTitle>
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
                        formatter={(value: number, name: string) => [value, name === 'elev' ? 'Угол места, °' : name === 'azim' ? 'Азимут, °' : 'Доплер, Гц']}
                        labelFormatter={(l) => `t = ${l} с`}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => (v === 'elev' ? 'Угол места' : v === 'azim' ? 'Азимут' : 'Доплер')} />
                      <Line yAxisId="ang" type="monotone" dataKey="elev" stroke="#0f766e" dot={false} isAnimationActive={false} />
                      <Line yAxisId="ang" type="monotone" dataKey="azim" stroke="#d97706" dot={false} isAnimationActive={false} />
                      <Line yAxisId="hz" type="monotone" dataKey="doppler" stroke="#dc2626" dot={false} isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">SNR и link margin</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 5, right: 10, bottom: 16, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="t" tick={{ fontSize: 11 }} label={{ value: 't, с', position: 'insideBottom', offset: -10, fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(value: number, name: string) => [`${value} дБ`, name === 'snr' ? 'SNR' : 'Link margin']}
                        labelFormatter={(l) => `t = ${l} с`}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => (v === 'snr' ? 'SNR' : 'Link margin')} />
                      <Line type="monotone" dataKey="snr" stroke="#0f766e" dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="margin" stroke="#dc2626" dot={false} isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {dynamics.exitTimeS !== null && (
            <Badge variant="destructive">
              Объект покидает зону связи через {dynamics.exitTimeS.toFixed(0)} с — предупреждение по ТЗ 4.5.2
            </Badge>
          )}
        </>
      )}
    </div>
  )
}

'use client'

/**
 * Параметры антенн и приёмопередатчиков:
 * переключатель «Упрощённо / Подробно», мощность передатчика в дБм или мВт,
 * полный набор полей подробного режима. Выбор модели и бэкенда расчёта.
 */
import { useState } from 'react'
import { useRadioStore } from '@/store/radio-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { MODULATIONS } from '@/lib/radio/constants'
import type { ModulationId } from '@/lib/radio/types'
import { SlidersHorizontal, RadioTower, Plane } from 'lucide-react'

type PowerUnit = 'dbm' | 'mw'

const dbmToMw = (dbm: number): number => Math.pow(10, dbm / 10)
const mwToDbm = (mw: number): number => 10 * Math.log10(Math.max(mw, Number.MIN_VALUE))

function NumField({
  label,
  value,
  onChange,
  step = 0.1,
  min,
  max,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  max?: number
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input type="number" step={step} min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}

export function EquipmentPanel() {
  const eq = useRadioStore((s) => s.equipment)
  const setEquipment = useRadioStore((s) => s.setEquipment)
  const model = useRadioStore((s) => s.model)
  const backend = useRadioStore((s) => s.backend)
  const backendAvailable = useRadioStore((s) => s.backendAvailable)
  const setField = useRadioStore((s) => s.setField)
  const setBackend = useRadioStore((s) => s.setBackend)
  const checkBackend = useRadioStore((s) => s.checkBackend)
  const txHeightM = useRadioStore((s) => s.txHeightM)
  const rxHeightM = useRadioStore((s) => s.rxHeightM)
  const [powerUnit, setPowerUnit] = useState<PowerUnit>('dbm')

  const detailed = eq.mode === 'detailed'
  const txPowerDbm = eq.transmitter.powerDbm

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-emerald-600" /> Модель и бэкенд расчёта
            </span>
            <Badge
              variant={backendAvailable === false ? 'destructive' : 'secondary'}
              className="font-mono text-xs"
            >
              бэкенд: {backend}{backendAvailable === false ? ' (недоступен)' : ''}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Модель распространения</Label>
              <Select value={model} onValueChange={(v) => setField('model', v as 'p2001' | 'fspl-p526')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="p2001">ITU-R P.2001</SelectItem>
                  <SelectItem value="fspl-p526">FSPL + P.526</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Бэкенд расчёта</Label>
              <Select value={backend} onValueChange={(v) => setBackend(v as 'http' | 'wasm')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="http">http — Python-сервис</SelectItem>
                  <SelectItem value="wasm">wasm — Pyodide в браузере</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <button className="text-xs text-muted-foreground underline" onClick={() => void checkBackend()}>
                проверить доступность
              </button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            P.2001: дифракция, тропосферное рассеяние, замирания 0–100% времени, климатические зоны.
            В wasm-режиме P.2001 выполняется в браузере (Pyodide), при его недоступности — fallback на FSPL + P.526
            (потери в свободном пространстве + коррекция дифракции) с предупреждением.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex flex-wrap items-center justify-between gap-2">
            <span>Приёмо-передатчики (сигнал и условия)</span>
            <div className="flex items-center gap-2 text-sm font-normal">
              <span className={detailed ? 'text-muted-foreground' : 'font-medium'}>Упрощённо</span>
              <Switch
                checked={detailed}
                onCheckedChange={(v) => setEquipment({ mode: v ? 'detailed' : 'simple' })}
                aria-label="Переключатель подробно/упрощённо"
              />
              <span className={detailed ? 'font-medium' : 'text-muted-foreground'}>Подробно</span>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Наземный приёмо-передатчик (Tx, точка A) */}
            <div className="space-y-3 rounded-lg border p-3">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
                  <RadioTower className="h-4 w-4" /> Наземный приёмо-передатчик (Tx)
                </p>
                <p className="text-[11px] text-muted-foreground">точка A · высота антенны над землёй</p>
              </div>
              <NumField
                label="Высота антенны, м"
                value={txHeightM}
                onChange={(v) => setField('txHeightM', v)}
                step={0.5}
                min={0.5}
                max={600}
              />

              <div className="space-y-2 rounded-md border p-2.5">
                <p className="text-xs font-medium text-muted-foreground">Антенна Tx</p>
                <div className="grid grid-cols-2 gap-2">
                  <NumField label="Усиление, дБи" value={eq.tx.gainDbi} onChange={(v) => setEquipment({ tx: { ...eq.tx, gainDbi: v } })} />
                  <div>
                    <Label className="text-xs">Поляризация</Label>
                    <Select
                      value={eq.tx.polarization}
                      onValueChange={(v) => setEquipment({ tx: { ...eq.tx, polarization: v as 'vertical' | 'horizontal' | 'circular' } })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="vertical">Вертикальная</SelectItem>
                        <SelectItem value="horizontal">Горизонтальная</SelectItem>
                        <SelectItem value="circular">Круговая</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {detailed && (
                    <>
                      <NumField label="Ширина луча, °" value={eq.tx.beamwidthDeg ?? 30} onChange={(v) => setEquipment({ tx: { ...eq.tx, beamwidthDeg: v } })} />
                      <NumField label="Ур. боковых лепестков, дБ" value={eq.tx.sidelobeDb ?? -25} onChange={(v) => setEquipment({ tx: { ...eq.tx, sidelobeDb: v } })} />
                      <NumField label="Рассогласование, дБ" value={eq.tx.mismatchLossDb ?? 0.5} onChange={(v) => setEquipment({ tx: { ...eq.tx, mismatchLossDb: v } })} />
                      <NumField label="КСВН (VSWR)" value={eq.tx.vswr ?? 1.5} onChange={(v) => setEquipment({ tx: { ...eq.tx, vswr: v } })} />
                      <NumField label="Потери фидера, дБ" value={eq.tx.feederLossDb ?? 1.5} onChange={(v) => setEquipment({ tx: { ...eq.tx, feederLossDb: v } })} />
                      <NumField label="Азимут, °" value={eq.tx.azimuthDeg ?? 0} onChange={(v) => setEquipment({ tx: { ...eq.tx, azimuthDeg: v } })} step={1} />
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-2 rounded-md border p-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">Передатчик</p>
                  {/* Переключатель единиц мощности */}
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className={powerUnit === 'dbm' ? 'font-medium' : 'text-muted-foreground'}>дБм (dBm)</span>
                    <Switch
                      checked={powerUnit === 'mw'}
                      onCheckedChange={(v) => setPowerUnit(v ? 'mw' : 'dbm')}
                      aria-label="Переключатель единиц мощности"
                    />
                    <span className={powerUnit === 'mw' ? 'font-medium' : 'text-muted-foreground'}>мВт (mW)</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {powerUnit === 'dbm' ? (
                    <NumField
                      label="Мощность, дБм (dBm)"
                      value={txPowerDbm}
                      onChange={(v) => setEquipment({ transmitter: { ...eq.transmitter, powerDbm: v } })}
                      step={1}
                    />
                  ) : (
                    <NumField
                      label="Мощность, мВт (mW)"
                      value={+dbmToMw(txPowerDbm).toFixed(2)}
                      onChange={(v) => setEquipment({ transmitter: { ...eq.transmitter, powerDbm: +mwToDbm(v).toFixed(2) } })}
                      step={10}
                      min={0}
                    />
                  )}
                  <NumField label="Чувствительность приёмника (обратная линия), дБм" value={eq.transmitter.sensitivityDbm} onChange={(v) => setEquipment({ transmitter: { ...eq.transmitter, sensitivityDbm: v } })} step={1} />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {powerUnit === 'dbm'
                    ? `≈ ${dbmToMw(txPowerDbm).toFixed(2)} мВт (mW)`
                    : `≈ ${txPowerDbm.toFixed(2)} дБм (dBm)`}
                </p>
              </div>
            </div>

            {/* Подвижный приёмо-передатчик (Rx, точка Б) */}
            <div className="space-y-3 rounded-lg border p-3">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-700">
                  <Plane className="h-4 w-4" /> Подвижный приёмо-передатчик (Rx)
                </p>
                <p className="text-[11px] text-muted-foreground">точка Б · текущая позиция объекта</p>
              </div>
              <NumField
                label="Высота антенны, м"
                value={rxHeightM}
                onChange={(v) => setField('rxHeightM', v)}
                step={0.5}
                min={0.5}
                max={600}
              />

              <div className="space-y-2 rounded-md border p-2.5">
                <p className="text-xs font-medium text-muted-foreground">Антенна Rx</p>
                <div className="grid grid-cols-2 gap-2">
                  <NumField label="Усиление, дБи" value={eq.rx.gainDbi} onChange={(v) => setEquipment({ rx: { ...eq.rx, gainDbi: v } })} />
                  <div>
                    <Label className="text-xs">Поляризация</Label>
                    <Select
                      value={eq.rx.polarization}
                      onValueChange={(v) => setEquipment({ rx: { ...eq.rx, polarization: v as 'vertical' | 'horizontal' | 'circular' } })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="vertical">Вертикальная</SelectItem>
                        <SelectItem value="horizontal">Горизонтальная</SelectItem>
                        <SelectItem value="circular">Круговая</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {detailed && (
                    <>
                      <NumField label="Ширина луча, °" value={eq.rx.beamwidthDeg ?? 30} onChange={(v) => setEquipment({ rx: { ...eq.rx, beamwidthDeg: v } })} />
                      <NumField label="Ур. боковых лепестков, дБ" value={eq.rx.sidelobeDb ?? -25} onChange={(v) => setEquipment({ rx: { ...eq.rx, sidelobeDb: v } })} />
                      <NumField label="Рассогласование, дБ" value={eq.rx.mismatchLossDb ?? 0.5} onChange={(v) => setEquipment({ rx: { ...eq.rx, mismatchLossDb: v } })} />
                      <NumField label="КСВН (VSWR)" value={eq.rx.vswr ?? 1.5} onChange={(v) => setEquipment({ rx: { ...eq.rx, vswr: v } })} />
                      <NumField label="Потери фидера, дБ" value={eq.rx.feederLossDb ?? 1.5} onChange={(v) => setEquipment({ rx: { ...eq.rx, feederLossDb: v } })} />
                      <NumField label="Азимут, °" value={eq.rx.azimuthDeg ?? 0} onChange={(v) => setEquipment({ rx: { ...eq.rx, azimuthDeg: v } })} step={1} />
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-2 rounded-md border p-2.5">
                <p className="text-xs font-medium text-muted-foreground">Приёмник</p>
                <div className="grid grid-cols-2 gap-2">
                  <NumField label="Мощность передатчика (обратная линия), дБм" value={eq.receiver.powerDbm} onChange={(v) => setEquipment({ receiver: { ...eq.receiver, powerDbm: v } })} step={1} />
                  <NumField label="Чувствительность, дБм (dBm)" value={eq.receiver.sensitivityDbm} onChange={(v) => setEquipment({ receiver: { ...eq.receiver, sensitivityDbm: v } })} step={1} />
                  {detailed && (
                    <>
                      <NumField
                        label="Шумовая полоса, Гц"
                        value={eq.receiver.noiseBandwidthHz ?? 1e6}
                        onChange={(v) => setEquipment({ receiver: { ...eq.receiver, noiseBandwidthHz: v } })}
                        step={1e5}
                        min={100}
                      />
                      <NumField label="Коэффициент шума (NF), дБ" value={eq.receiver.noiseFigureDb ?? 3} onChange={(v) => setEquipment({ receiver: { ...eq.receiver, noiseFigureDb: v } })} />
                      <div>
                        <Label className="text-xs">Модуляция</Label>
                        <Select
                          value={eq.receiver.modulation ?? 'QPSK'}
                          onValueChange={(v) => {
                            const mod = v as ModulationId
                            setEquipment({
                              receiver: {
                                ...eq.receiver,
                                modulation: mod,
                                requiredEbN0Db: MODULATIONS[mod].ebN0Db,
                              },
                            })
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(MODULATIONS).map(([id, m]) => (
                              <SelectItem key={id} value={id}>
                                {m.label} (Eb/N₀ {m.ebN0Db} дБ)
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <NumField
                        label="Требуемое Eb/N₀, дБ"
                        value={eq.receiver.requiredEbN0Db ?? 9.6}
                        onChange={(v) => setEquipment({ receiver: { ...eq.receiver, requiredEbN0Db: v } })}
                      />
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
          <Separator />
          <p className="text-xs text-muted-foreground">
            Высота антенны каждой станции задаётся в её карточке. В упрощённом режиме: усиления антенн,
            мощность передатчика и чувствительность приёмника. В подробном добавляются ширина луча,
            боковые лепестки, рассогласование, КСВН (VSWR), фидеры, полоса шума, коэффициент шума (NF)
            и модуляция. Общие условия линии (частоты передатчиков, климатическая зона, рефракция,
            атмосферные потери) — в карточке «Условия распространения». Обратная линия (подвижный Tx →
            наземный Rx) использует мощность передатчика подвижной станции и чувствительность приёмника
            наземной станции.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

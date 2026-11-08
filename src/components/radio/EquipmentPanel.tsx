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
import { manMadeNoiseFaDb, NOISE_ENVIRONMENT_LABELS } from '@/lib/radio/noise'
import type { AntennaParams, ModulationId, NoiseEnvironment } from '@/lib/radio/types'
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

/**
 * Карточка приёмо-передатчика станции. Обе станции (наземная и подвижная)
 * рендерятся этим же компонентом — структура карточек идентична по построению:
 * высота антенны, антенна, передатчик (мощность), приёмник (чувствительность),
 * в подробном режиме — параметры антенны и общие параметры приёмника.
 * Различаются только данные, цвет и направление линии в секциях.
 */
function StationCard({
  station,
  detailed,
  powerUnit,
  onPowerUnitChange,
}: {
  station: 'ground' | 'mobile'
  detailed: boolean
  powerUnit: PowerUnit
  onPowerUnitChange: (u: PowerUnit) => void
}) {
  const eq = useRadioStore((s) => s.equipment)
  const setEquipment = useRadioStore((s) => s.setEquipment)
  const setField = useRadioStore((s) => s.setField)
  const heightM = useRadioStore((s) => (station === 'ground' ? s.txHeightM : s.rxHeightM))
  // Частота линии, на которую смотрит приёмник этой станции (для подсказки Fa):
  // наземный приёмник — обратная линия (частота подвижного), подвижный — прямая
  const rxLinkFreqMhz = useRadioStore((s) => (station === 'ground' ? s.mobileFrequencyMhz : s.frequencyMhz))

  const isGround = station === 'ground'
  const noiseEnv: NoiseEnvironment = eq.noiseEnvironment ?? 'none'
  const faNow = manMadeNoiseFaDb(noiseEnv, rxLinkFreqMhz)
  const ant = isGround ? eq.tx : eq.rx
  const setAnt = (patch: Partial<AntennaParams>) =>
    setEquipment(isGround ? { tx: { ...eq.tx, ...patch } } : { rx: { ...eq.rx, ...patch } })
  const txPowerDbm = isGround ? eq.transmitter.powerDbm : eq.receiver.powerDbm
  const setTxPowerDbm = (v: number) =>
    setEquipment(
      isGround
        ? { transmitter: { ...eq.transmitter, powerDbm: v } }
        : { receiver: { ...eq.receiver, powerDbm: v } },
    )
  const rxSensDbm = isGround ? eq.transmitter.sensitivityDbm : eq.receiver.sensitivityDbm
  const setRxSensDbm = (v: number) =>
    setEquipment(
      isGround
        ? { transmitter: { ...eq.transmitter, sensitivityDbm: v } }
        : { receiver: { ...eq.receiver, sensitivityDbm: v } },
    )

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div>
        <p className={`flex items-center gap-1.5 text-sm font-semibold ${isGround ? 'text-emerald-700' : 'text-amber-700'}`}>
          {isGround ? <RadioTower className="h-4 w-4" /> : <Plane className="h-4 w-4" />}
          {isGround ? 'Наземный приёмо-передатчик (Tx)' : 'Подвижный приёмо-передатчик (Rx)'}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {isGround ? 'точка A · высота антенны над землёй' : 'точка Б · текущая позиция объекта'}
        </p>
      </div>
      <NumField
        label="Высота антенны, м"
        value={heightM}
        onChange={(v) => setField(isGround ? 'txHeightM' : 'rxHeightM', v)}
        step={0.5}
        min={0.5}
        max={5000}
      />

      <div className="space-y-2 rounded-md border p-2.5">
        <p className="text-xs font-medium text-muted-foreground">Антенна {isGround ? 'Tx' : 'Rx'}</p>
        <div className="grid grid-cols-2 gap-2">
          <NumField label="Усиление, дБи" value={ant.gainDbi} onChange={(v) => setAnt({ gainDbi: v })} />
          <div>
            <Label className="text-xs">Поляризация</Label>
            <Select
              value={ant.polarization}
              onValueChange={(v) => setAnt({ polarization: v as 'vertical' | 'horizontal' | 'circular' })}
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
          <NumField label="Ширина луча, °" value={ant.beamwidthDeg ?? 30} onChange={(v) => setAnt({ beamwidthDeg: v })} step={1} min={1} max={360} />
          {detailed && (
            <>
              <NumField label="Ур. боковых лепестков, дБ" value={ant.sidelobeDb ?? -25} onChange={(v) => setAnt({ sidelobeDb: v })} />
              <NumField label="Рассогласование, дБ" value={ant.mismatchLossDb ?? 0.5} onChange={(v) => setAnt({ mismatchLossDb: v })} />
              <NumField label="КСВН (VSWR)" value={ant.vswr ?? 1.5} onChange={(v) => setAnt({ vswr: v })} />
              <NumField label="Потери фидера, дБ" value={ant.feederLossDb ?? 1.5} onChange={(v) => setAnt({ feederLossDb: v })} />
              <NumField label="Азимут, °" value={ant.azimuthDeg ?? 0} onChange={(v) => setAnt({ azimuthDeg: v })} step={1} />
            </>
          )}
        </div>
      </div>

      <div className="space-y-2 rounded-md border p-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            Передатчик
            <Badge variant="outline" className="text-[10px] font-normal">
              {isGround ? 'прямая линия' : 'обратная линия'}
            </Badge>
          </p>
          {/* Переключатель единиц мощности (общий для обеих карточек) */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className={powerUnit === 'dbm' ? 'font-medium' : 'text-muted-foreground'}>дБм (dBm)</span>
            <Switch
              checked={powerUnit === 'mw'}
              onCheckedChange={(v) => onPowerUnitChange(v ? 'mw' : 'dbm')}
              aria-label={`Переключатель единиц мощности ${isGround ? 'наземного' : 'подвижного'}`}
            />
            <span className={powerUnit === 'mw' ? 'font-medium' : 'text-muted-foreground'}>мВт (mW)</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {powerUnit === 'dbm' ? (
            <NumField
              label="Мощность, дБм (dBm)"
              value={txPowerDbm}
              onChange={setTxPowerDbm}
              step={1}
            />
          ) : (
            <NumField
              label="Мощность, мВт (mW)"
              value={+dbmToMw(txPowerDbm).toFixed(2)}
              onChange={(v) => setTxPowerDbm(+mwToDbm(v).toFixed(2))}
              step={10}
              min={0}
            />
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {powerUnit === 'dbm'
            ? `≈ ${dbmToMw(txPowerDbm).toFixed(2)} мВт (mW)`
            : `≈ ${txPowerDbm.toFixed(2)} дБм (dBm)`}
        </p>
      </div>

      <div className="space-y-2 rounded-md border p-2.5">
        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          Приёмник
          <Badge variant="outline" className="text-[10px] font-normal">
            {isGround ? 'обратная линия' : 'прямая линия'}
          </Badge>
        </p>
        <div className="grid grid-cols-2 gap-2">
          <NumField label="Чувствительность, дБм (dBm)" value={rxSensDbm} onChange={setRxSensDbm} step={1} />
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
        <div>
          <Label className="text-xs">Шумовое окружение (P.372)</Label>
          <Select
            value={noiseEnv}
            onValueChange={(v) => setEquipment({ noiseEnvironment: v as NoiseEnvironment })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(NOISE_ENVIRONMENT_LABELS) as [NoiseEnvironment, string][]).map(([id, label]) => (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {noiseEnv !== 'none' && (
            <p className="text-[11px] text-muted-foreground">
              {faNow > 0
                ? `Fa ≈ ${faNow.toFixed(1)} дБ на ${rxLinkFreqMhz.toFixed(0)} МГц — учтено в шуме линии`
                : `на ${rxLinkFreqMhz.toFixed(0)} МГц фит P.372 ниже теплового фона — учтено 0 дБ`}
            </p>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Окружение, полоса, NF, модуляция — общие для обеих станций (одна радиосистема).
        </p>
      </div>
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
  const [powerUnit, setPowerUnit] = useState<PowerUnit>('dbm')

  const detailed = eq.mode === 'detailed'

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
            <StationCard station="ground" detailed={detailed} powerUnit={powerUnit} onPowerUnitChange={setPowerUnit} />

            {/* Подвижный приёмо-передатчик (Rx, точка Б) */}
            <StationCard station="mobile" detailed={detailed} powerUnit={powerUnit} onPowerUnitChange={setPowerUnit} />
          </div>
          <Separator />
          <p className="text-xs text-muted-foreground">
            Карточки станций устроены одинаково: высота антенны, антенна, передатчик (мощность) и приёмник
            (чувствительность). Секция передатчика наземной станции работает в прямой линии, подвижной — в обратной;
            приёмник наземной станции принимает обратную линию, подвижной — прямую. Ширина луча антенны задаёт потери
            на неточное наведение: A = 12·(θ/θ₃дБ)² при номинальном отклонении оси 10°, ограничение — по уровню боковых
            лепестков; при ширине луча ≥ 180° (всенаправленная) не учитываются. В подробном режиме добавляются уровень
            боковых лепестков, рассогласование, КСВН (VSWR), фидер и азимут антенн, а также параметры приёмника
            (шумовая полоса, коэффициент шума (NF), модуляция, Eb/N₀) — последние общие для обеих станций: одна
            радиосистема. Переключатель дБм/мВт действует на обе карточки. Общие условия линии (частоты передатчиков,
            климатическая зона, рефракция, атмосферные потери) — в карточке «Условия распространения».
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

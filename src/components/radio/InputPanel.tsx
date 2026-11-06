'use client'

/**
 * Ввод исходных данных:
 * координаты A/Б (WGS 84 и СК-42 с автоматическим определением зоны),
 * справочные данные трассы (азимут, дирекционный угол, обратный угол,
 * угол места, расчётное время полёта), частота (одна или диапазон),
 * поляризация, высоты антенн, k-фактор, атмосфера.
 */
import { useMemo, useState } from 'react'
import { useRadioStore, sk42Of, wgsFromSk42 } from '@/store/radio-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { CLIMATE_ZONES, LIMITS } from '@/lib/radio/constants'
import { distanceM, bearingDeg, wrap180 } from '@/lib/radio/coordinates'
import { buildProfile, createHgtDem, createSyntheticDem } from '@/lib/radio/terrain'
import { Radio, Clock, Navigation } from 'lucide-react'

/**
 * Редактор координат точки.
 * СК-42: поле ввода без ведущей цифры зоны — зона определяется автоматически
 * из введённых координат (если Y ≥ 1 000 000, номер зоны вычисляется из Y,
 * иначе берётся зона текущего положения точки).
 */
function CoordEditor({ which }: { which: 'A' | 'Б' }) {
  const point = useRadioStore((s) => (which === 'A' ? s.pointA : s.pointB))
  const setPoint = useRadioStore((s) => (which === 'A' ? s.setPointA : s.setPointB))
  const sk = sk42Of(point)
  const yNoZone = Math.round(sk.y) - sk.zone * 1e6
  const [skInput, setSkInput] = useState<string>(() => `${Math.round(sk.x)} ${yNoZone}`)
  const [lastWgs, setLastWgs] = useState<string>(() => `${point.lat.toFixed(6)},${point.lon.toFixed(6)}`)
  const [skError, setSkError] = useState<string | null>(null)

  // Синхронизация поля, если точка изменилась извне (карта, загрузка истории)
  const wgsKey = `${point.lat.toFixed(6)},${point.lon.toFixed(6)}`
  if (wgsKey !== lastWgs) {
    setLastWgs(wgsKey)
    setSkInput(`${Math.round(sk.x)} ${Math.round(sk.y) - sk.zone * 1e6}`)
  }

  const applySk = () => {
    const parts = skInput.trim().split(/[\s,;:]+/).map(Number)
    if (parts.length !== 2 || parts.some((n) => !isFinite(n))) {
      setSkError('Формат: X Y в метрах, например 6182350 413070 (без номера зоны)')
      return
    }
    const [x, yRaw] = parts
    // Автоопределение зоны из введённых координат
    let zone: number
    let y: number
    if (yRaw >= 1e6) {
      zone = Math.floor(yRaw / 1e6)
      y = yRaw
    } else {
      zone = sk.zone
      y = yRaw + zone * 1e6
    }
    if (zone < 1 || zone > 60) {
      setSkError('Не удалось определить зону: укажите Y с номером зоны (например 7413070)')
      return
    }
    try {
      const wgs = wgsFromSk42({ zone, x, y })
      if (Math.abs(wgs.lat) > 90 || Math.abs(wgs.lon) > 180) throw new Error('вне диапазона')
      setSkError(null)
      setPoint(wgs)
    } catch {
      setSkError('Не удалось преобразовать СК-42 → WGS 84')
    }
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Широта (WGS 84), °</Label>
          <Input
            type="number"
            step="0.0001"
            value={point.lat}
            onChange={(e) => setPoint({ ...point, lat: Number(e.target.value) })}
          />
        </div>
        <div>
          <Label className="text-xs">Долгота (WGS 84), °</Label>
          <Input
            type="number"
            step="0.0001"
            value={point.lon}
            onChange={(e) => setPoint({ ...point, lon: Number(e.target.value) })}
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label className="text-xs">СК-42: зона (авто)</Label>
          <Input value={sk.zone} readOnly className="bg-muted" />
        </div>
        <div className="col-span-2">
          <Label className="text-xs">СК-42 Гаусс–Крюгер: X, Y (м, без номера зоны)</Label>
          <div className="flex gap-1">
            <Input
              value={skInput}
              onChange={(e) => setSkInput(e.target.value)}
              onBlur={applySk}
              onKeyDown={(e) => e.key === 'Enter' && applySk()}
            />
            <Button variant="outline" size="sm" onClick={applySk} className="shrink-0">
              →
            </Button>
          </div>
        </div>
      </div>
      {skError && <p className="text-xs text-destructive">{skError}</p>}
    </div>
  )
}

/** Форматирование длительности в ч/мин/с. */
function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.round(sec % 60)
  if (h > 0) return `${h} ч ${m} мин`
  if (m > 0) return `${m} мин ${s} с`
  return `${s} с`
}

export function InputPanel() {
  const s = useRadioStore()
  const dist = distanceM(s.pointA, s.pointB)

  // Справочные углы трассы
  const trackInfo = useMemo(() => {
    const az = bearingDeg(s.pointA, s.pointB)
    const revAz = bearingDeg(s.pointB, s.pointA)
    // Дирекционный угол — из проекции Гаусса–Крюгера (СК-42)
    const skA = sk42Of(s.pointA)
    const skB = sk42Of(s.pointB)
    const dx = skB.x - skA.x
    const dy = skB.y - skA.y
    const dirAngle = (Math.atan2(dy, dx) * (180 / Math.PI) + 360) % 360
    // Сближение меридианов = азимут − дирекционный угол
    const convergence = wrap180(az - dirAngle)
    // Угол места: наклон визира между антеннами с учётом рельефа
    const dem = s.hgtTiles.length > 0 ? createHgtDem(s.hgtTiles) : createSyntheticDem()
    const profile = buildProfile(s.pointA, s.pointB, dem)
    const elevA = (profile[0]?.elev ?? 0) + s.txHeightM
    const elevB = (profile[profile.length - 1]?.elev ?? 0) + s.rxHeightM
    const elevation = (Math.atan2(elevB - elevA, dist) * 180) / Math.PI
    // Расчётное время полёта по путевой скорости
    const speedMs = s.dynamicsParams.speedKmh / 3.6
    const flightTimeS = speedMs > 0 ? dist / speedMs : 0
    return { az, revAz, dirAngle, convergence, elevation, flightTimeS }
  }, [s.pointA, s.pointB, s.txHeightM, s.rxHeightM, s.hgtTiles, s.dynamicsParams.speedKmh, dist])

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Radio className="h-4 w-4 text-emerald-600" /> Трасса
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm font-medium text-emerald-700">Точка A (наземный Tx)</p>
            <CoordEditor which="A" />
          </div>
          <Separator />
          <div>
            <p className="text-sm font-medium text-amber-700">Точка Б (подвижный Rx — текущая позиция объекта)</p>
            <CoordEditor which="Б" />
          </div>
          <Separator />
          <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <Navigation className="h-3.5 w-3.5 text-emerald-600" /> Длина трассы:{' '}
              <span className="font-semibold">{(dist / 1000).toFixed(2)} км</span>
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                Азимут (истинный): <span className="font-medium text-foreground">{trackInfo.az.toFixed(1)}°</span>
              </span>
              <span>
                Обратный угол: <span className="font-medium text-foreground">{trackInfo.revAz.toFixed(1)}°</span>
              </span>
              <span>
                Дирекционный угол: <span className="font-medium text-foreground">{trackInfo.dirAngle.toFixed(1)}°</span>
              </span>
              <span>
                Сближение меридианов: <span className="font-medium text-foreground">{trackInfo.convergence.toFixed(2)}°</span>
              </span>
              <span>
                Угол места: <span className="font-medium text-foreground">{trackInfo.elevation.toFixed(2)}°</span>
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Время полёта: <span className="font-medium text-foreground">{fmtDuration(trackInfo.flightTimeS)}</span>
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Время полёта рассчитано по путевой скорости {s.dynamicsParams.speedKmh} км/ч
              (задаётся на вкладке «Динамика»).
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Условия распространения</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Частоты передатчиков станций */}
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2 rounded-lg border p-2.5">
              <p className="text-xs font-semibold text-emerald-700">Наземный (Tx) — прямая линия</p>
              {/* Режим частоты: одна / диапазон */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <span className={s.frequencyMode === 'single' ? 'font-medium' : 'text-muted-foreground'}>Одна частота</span>
                  <Switch
                    checked={s.frequencyMode === 'range'}
                    onCheckedChange={(v) => s.setField('frequencyMode', v ? 'range' : 'single')}
                    aria-label="Переключатель режима частоты"
                  />
                  <span className={s.frequencyMode === 'range' ? 'font-medium' : 'text-muted-foreground'}>
                    Диапазон
                  </span>
                </div>
                {s.frequencyMode === 'range' && (
                  <Badge variant="secondary" className="text-[10px]">до 12 точек</Badge>
                )}
              </div>

              {s.frequencyMode === 'single' ? (
                <div>
                  <Label className="text-xs">Частота передатчика, МГц ({LIMITS.frequencyMinMhz}–{LIMITS.frequencyMaxMhz})</Label>
                  <Input
                    type="number"
                    min={LIMITS.frequencyMinMhz}
                    max={LIMITS.frequencyMaxMhz}
                    value={s.frequencyMhz}
                    onChange={(e) => s.setField('frequencyMhz', Number(e.target.value))}
                  />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Частота от, МГц</Label>
                    <Input
                      type="number"
                      min={LIMITS.frequencyMinMhz}
                      max={LIMITS.frequencyMaxMhz}
                      value={s.freqFromMhz}
                      onChange={(e) => s.setField('freqFromMhz', Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Частота до, МГц</Label>
                    <Input
                      type="number"
                      min={LIMITS.frequencyMinMhz}
                      max={LIMITS.frequencyMaxMhz}
                      value={s.freqToMhz}
                      onChange={(e) => s.setField('freqToMhz', Number(e.target.value))}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2 rounded-lg border p-2.5">
              <p className="text-xs font-semibold text-amber-700">Подвижный (Tx) — обратная линия</p>
              <div>
                <Label className="text-xs">Частота передатчика, МГц ({LIMITS.frequencyMinMhz}–{LIMITS.frequencyMaxMhz})</Label>
                <Input
                  type="number"
                  min={LIMITS.frequencyMinMhz}
                  max={LIMITS.frequencyMaxMhz}
                  value={s.mobileFrequencyMhz}
                  onChange={(e) => s.setField('mobileFrequencyMhz', Number(e.target.value))}
                />
              </div>
              {s.frequencyMode === 'range' && (
                <p className="text-[11px] text-muted-foreground">
                  В режиме диапазона обратная линия не рассчитывается.
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Поляризация</Label>
              <Select
                value={s.polarization}
                onValueChange={(v) => s.setField('polarization', v as 'vertical' | 'horizontal' | 'circular')}
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
            <div>
              <Label className="text-xs">Климатическая зона (P.838)</Label>
              <Select value={s.climateZone} onValueChange={(v) => s.setField('climateZone', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLIMATE_ZONES.map((z) => (
                    <SelectItem key={z} value={z}>
                      {z}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Фактор рефракции k</Label>
              <Input
                type="number"
                min={0.5}
                max={10}
                step="0.05"
                value={Math.round(s.kFactor * 1000) / 1000}
                onChange={(e) => s.setField('kFactor', Number(e.target.value))}
              />
            </div>
          </div>

          <Separator />
          <p className="text-xs font-medium text-muted-foreground">Дополнительные потери</p>
          <div className="flex items-center justify-between">
            <Label className="text-sm">Дождь (P.837 + P.838), R₀.₀₁ мм/ч</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={150}
                className="w-20 h-8"
                value={s.atmosphere.rainRateMmH ?? 0}
                onChange={(e) => s.setAtmosphere({ rainRateMmH: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-sm">Атмосферные газы (P.676)</Label>
            <Switch checked={s.atmosphere.gases} onCheckedChange={(v) => s.setAtmosphere({ gases: v })} />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-sm">Растительность (P.833, нужны данные clutter)</Label>
            <Switch
              checked={s.atmosphere.vegetation}
              onCheckedChange={(v) => s.setAtmosphere({ vegetation: v })}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

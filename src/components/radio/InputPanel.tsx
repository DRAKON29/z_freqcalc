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
import { Checkbox } from '@/components/ui/checkbox'
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
function CoordEditor({ which }: { which: 'A' | 'Б' | 'C' }) {
  // ВАЖНО: селектор zustand не должен создавать новые объекты/функции
  // (useSyncExternalStore требует кэшируемый getSnapshot) — поэтому для 'C'
  // пишем через setField вне селектора, а не inline-стрелкой в селекторе.
  const point = useRadioStore((s) =>
    which === 'A' ? s.pointA : which === 'Б' ? s.pointB : s.interferenceSource,
  )
  const setStorePoint = useRadioStore((s) => (which === 'A' ? s.setPointA : which === 'Б' ? s.setPointB : null))
  const setField = useRadioStore((s) => s.setField)
  const setPoint = (p: { lat: number; lon: number }) =>
    which === 'C' ? setField('interferenceSource', p) : setStorePoint?.(p)
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
            {/* Поиск оптимальной позиции точки A в заданном радиусе */}
            <div className="mt-2 space-y-2 rounded-lg border p-2.5">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={s.searchEnabled}
                  onCheckedChange={(v) => s.setField('searchEnabled', v === true)}
                  aria-label="Поиск позиции"
                />
                Поиск позиции
              </label>
              {s.searchEnabled && (
                <>
                  <div>
                    <Label htmlFor="search-radius" className="text-xs">Радиус поиска, м (не более 5000)</Label>
                    <Input
                      id="search-radius"
                      aria-label="Радиус поиска, м"
                      type="number"
                      min={50}
                      max={5000}
                      step={100}
                      value={s.searchRadiusM}
                      onChange={(e) => s.setField('searchRadiusM', Number(e.target.value))}
                    />
                  </div>
                  {s.searchRadiusM > 5000 && (
                    <p className="text-[11px] text-destructive">Радиус ограничен 5000 м — будет использован 5000.</p>
                  )}
                </>
              )}
            </div>
          </div>
          <Separator />
          <div>
            <p className="text-sm font-medium text-amber-700">Точка Б (подвижный Rx — текущая позиция объекта)</p>
            <CoordEditor which="Б" />
          </div>
          <Separator />
          {/* Источник помехи (роадмап 2.3, C/I): жертвами являются Rx прямой
              линии (точка Б) и Rx обратной линии (точка A) */}
          <div className="rounded-lg border border-red-200 dark:border-red-900/50 p-2.5 space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={s.interferenceEnabled}
                onCheckedChange={(v) => s.setField('interferenceEnabled', v === true)}
                aria-label="Учитывать помеху"
              />
              <span className="font-medium text-red-700 dark:text-red-400">Источник помехи (C/I, P.452)</span>
            </label>
            {s.interferenceEnabled && (
              <div className="space-y-3">
                <CoordEditor which="C" />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Высота антенны помехи, м</Label>
                    <Input
                      type="number"
                      min={0.5}
                      max={5000}
                      step={0.5}
                      value={s.interferenceHeightM}
                      onChange={(e) => s.setField('interferenceHeightM', Number(e.target.value))}
                      aria-label="Высота антенны помехи, м"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Мощность, дБм</Label>
                    <Input
                      type="number"
                      step={1}
                      value={s.interferencePowerDbm}
                      onChange={(e) => s.setField('interferencePowerDbm', Number(e.target.value))}
                      aria-label="Мощность помехи, дБм"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Усиление, дБи</Label>
                    <Input
                      type="number"
                      step={0.1}
                      value={s.interferenceGainDbi}
                      onChange={(e) => s.setField('interferenceGainDbi', Number(e.target.value))}
                      aria-label="Усиление помехи, дБи"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Частота помехи, МГц</Label>
                    <Input
                      type="number"
                      min={LIMITS.frequencyMinMhz}
                      max={LIMITS.frequencyMaxMhz}
                      value={s.interferenceFrequencyMhz}
                      onChange={(e) => s.setField('interferenceFrequencyMhz', Number(e.target.value))}
                      aria-label="Частота помехи, МГц"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Радиоклиматическая зона (P.452)</Label>
                    <Select
                      value={String(s.interferenceZone)}
                      onValueChange={(v) => s.setField('interferenceZone', Number(v) as 1 | 2 | 3)}
                    >
                      <SelectTrigger aria-label="Радиоклиматическая зона помехи">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Прибрежная суша</SelectItem>
                        <SelectItem value="2">Суша</SelectItem>
                        <SelectItem value="3">Море</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Защитное отношение C/I_min, дБ</Label>
                    <Input
                      type="number"
                      step={0.5}
                      value={s.interferenceCiMinDb ?? ''}
                      placeholder={`по умолчанию ${(s.equipment.receiver.requiredEbN0Db ?? 9.6).toFixed(1)}`}
                      onChange={(e) =>
                        s.setField('interferenceCiMinDb', e.target.value === '' ? null : Number(e.target.value))
                      }
                      aria-label="Защитное отношение C/I min, дБ"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Путь помехи — ITU-R P.452-18 (python-сервис, карты N050/DN50); при недоступности —
                  медиана P.2001-lite. Помеха считается ко-канальной (полное спектральное перекрытие) и
                  складывается с шумом приёмника (N = kTB + NF + Fa). Жертвы: Rx прямой линии (точка Б)
                  и Rx обратной линии (точка A); разнос антенн жертвы — по ширине луча.
                </p>
              </div>
            )}
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
              {/* Режим частоты подвижного: одна / диапазон */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <span className={s.mobileFrequencyMode === 'single' ? 'font-medium' : 'text-muted-foreground'}>Одна частота</span>
                  <Switch
                    checked={s.mobileFrequencyMode === 'range'}
                    onCheckedChange={(v) => s.setField('mobileFrequencyMode', v ? 'range' : 'single')}
                    aria-label="Переключатель режима частоты подвижного"
                  />
                  <span className={s.mobileFrequencyMode === 'range' ? 'font-medium' : 'text-muted-foreground'}>
                    Диапазон
                  </span>
                </div>
                {s.mobileFrequencyMode === 'range' && (
                  <Badge variant="secondary" className="text-[10px]">до 12 точек</Badge>
                )}
              </div>

              {s.mobileFrequencyMode === 'single' ? (
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
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Частота от, МГц</Label>
                    <Input
                      type="number"
                      min={LIMITS.frequencyMinMhz}
                      max={LIMITS.frequencyMaxMhz}
                      value={s.mobileFreqFromMhz}
                      onChange={(e) => s.setField('mobileFreqFromMhz', Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Частота до, МГц</Label>
                    <Input
                      type="number"
                      min={LIMITS.frequencyMinMhz}
                      max={LIMITS.frequencyMaxMhz}
                      value={s.mobileFreqToMhz}
                      onChange={(e) => s.setField('mobileFreqToMhz', Number(e.target.value))}
                    />
                  </div>
                </div>
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

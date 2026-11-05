'use client'

/**
 * Ввод исходных данных — ТЗ 4.1: координаты A/Б (WGS 84 и СК-42),
 * частота 500–7000 МГц, поляризация, высоты антенн, k-фактор, атмосфера.
 */
import { useState } from 'react'
import { useRadioStore, sk42Of, wgsFromSk42 } from '@/store/radio-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { CLIMATE_ZONES, LIMITS } from '@/lib/radio/constants'
import { distanceM } from '@/lib/radio/coordinates'
import { Radio } from 'lucide-react'

function CoordEditor({ which }: { which: 'A' | 'Б' }) {
  const point = useRadioStore((s) => (which === 'A' ? s.pointA : s.pointB))
  const setPoint = useRadioStore((s) => (which === 'A' ? s.setPointA : s.setPointB))
  const sk = sk42Of(point)
  const [skInput, setSkInput] = useState<string>(
    () => `${sk.zone} ${Math.round(sk.x)} ${Math.round(sk.y)}`,
  )
  const [skError, setSkError] = useState<string | null>(null)

  const applySk = () => {
    const parts = skInput.trim().split(/[\s,;:]+/).map(Number)
    if (parts.length !== 3 || parts.some((n) => !isFinite(n))) {
      setSkError('Формат: зона X Y (например 7 6182350 7413070)')
      return
    }
    try {
      const wgs = wgsFromSk42({ zone: parts[0], x: parts[1], y: parts[2] })
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
          <Label className="text-xs">СК-42: зона</Label>
          <Input value={sk.zone} readOnly className="bg-muted" />
        </div>
        <div className="col-span-2">
          <Label className="text-xs">СК-42 Гаусс–Крюгер: X Y, м</Label>
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

export function InputPanel() {
  const s = useRadioStore()
  const dist = distanceM(s.pointA, s.pointB)

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
            <p className="text-sm font-medium text-emerald-700">Точка A (передатчик)</p>
            <CoordEditor which="A" />
          </div>
          <Separator />
          <div>
            <p className="text-sm font-medium text-amber-700">Точка Б (приёмник)</p>
            <CoordEditor which="Б" />
          </div>
          <p className="text-sm text-muted-foreground">
            Длина трассы: <span className="font-medium text-foreground">{(dist / 1000).toFixed(2)} км</span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Сигнал и условия</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Частота, МГц ({LIMITS.frequencyMinMhz}–{LIMITS.frequencyMaxMhz})</Label>
              <Input
                type="number"
                min={LIMITS.frequencyMinMhz}
                max={LIMITS.frequencyMaxMhz}
                value={s.frequencyMhz}
                onChange={(e) => s.setField('frequencyMhz', Number(e.target.value))}
              />
            </div>
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
              <Label className="text-xs">Высота антенны Tx, м</Label>
              <Input
                type="number"
                min={0.5}
                max={600}
                step="0.5"
                value={s.txHeightM}
                onChange={(e) => s.setField('txHeightM', Number(e.target.value))}
              />
            </div>
            <div>
              <Label className="text-xs">Высота антенны Rx, м</Label>
              <Input
                type="number"
                min={0.5}
                max={600}
                step="0.5"
                value={s.rxHeightM}
                onChange={(e) => s.setField('rxHeightM', Number(e.target.value))}
              />
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
          </div>

          <Separator />
          <p className="text-xs font-medium text-muted-foreground">Дополнительные потери (ТЗ 4.7)</p>
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
            <Label className="text-sm">Растительность (P.833, нужен clutter)</Label>
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

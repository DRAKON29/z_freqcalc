'use client'

/**
 * Карты и настройки — ТЗ 5.1 (карты ITU: .txt/.zip, лимиты 700 МБ/1 ГБ),
 * ТЗ 5.2 (SRTM .hgt, кэш IndexedDB), ТЗ 4.6 (clutter.geojson),
 * ТЗ 6.3 (переключение бэкенда), ТЗ 3.4 (валидация).
 */
import { useEffect, useState } from 'react'
import { useRadioStore } from '@/store/radio-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getDeviceId, putSrtmTile, listSrtmTiles, getSrtmTile } from '@/lib/radio/history'
import { validateClutter, type ClutterGeoJson, type HgtTile } from '@/lib/radio/terrain'
import { parseHgt } from '@/lib/radio/terrain'
import { apiUrl } from '@/lib/radio/models/api'
import { LIMITS } from '@/lib/radio/constants'
import { Map, Upload, Trash2, Mountain, TreePine, Waves } from 'lucide-react'

interface ItuMapInfo {
  name: string
  size: number
}

export function MapsPanel() {
  const backend = useRadioStore((s) => s.backend)
  const addHgtTile = useRadioStore((s) => s.addHgtTile)
  const hgtTiles = useRadioStore((s) => s.hgtTiles)
  const setHgtTiles = useRadioStore((s) => s.setHgtTiles)
  const setClutter = useRadioStore((s) => s.setClutter)
  const clutter = useRadioStore((s) => s.clutter)
  const demInfo = useRadioStore((s) => s.demInfo)

  const [maps, setMaps] = useState<ItuMapInfo[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [mapError, setMapError] = useState<string | null>(null)
  const [deviceId, setDeviceId] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDeviceId(getDeviceId()), 0)
    return () => clearTimeout(t)
  }, [])

  const refreshMaps = async () => {
    if (backend === 'http') {
      try {
        const res = await fetch(apiUrl('/maps/status'))
        const data = await res.json()
        setMaps((data.maps ?? []).map((m: { name: string; size: number }) => ({ name: m.name, size: m.size })))
      } catch {
        setMaps([])
      }
    }
  }

  useEffect(() => {
    void refreshMaps()
  }, [backend])

  // Загрузка SRTM тайлов из IndexedDB при старте
  useEffect(() => {
    void (async () => {
      try {
        const names = await listSrtmTiles()
        const tiles: HgtTile[] = []
        for (const n of names) {
          const buf = await getSrtmTile(n)
          if (buf) {
            try {
              tiles.push(parseHgt(buf, `${n}.hgt`))
            } catch {
              // повреждённый тайл пропускаем
            }
          }
        }
        if (tiles.length > 0) setHgtTiles(tiles)
      } catch {
        // IndexedDB недоступна — игнорируем
      }
    })()
  }, [])

  const uploadItuMap = async (file: File) => {
    setMapError(null)
    setMessage(null)
    const ext = file.name.toLowerCase().rsplit('.', 1)[1]
    if (ext !== 'txt' && ext !== 'zip') {
      setMapError('Допустимы только .txt и .zip (ТЗ 5.1)')
      return
    }
    const limit = ext === 'zip' ? LIMITS.ituMapMaxZipBytes : LIMITS.ituMapMaxFileBytes
    if (file.size > limit) {
      setMapError(`Размер ${file.size / 1e6} МБ превышает лимит ${limit / 1e6} МБ`)
      return
    }
    if (backend === 'http') {
      const fd = new FormData()
      fd.append('file', file)
      try {
        const res = await fetch(apiUrl('/maps/upload'), { method: 'POST', body: fd })
        if (res.status === 413) {
          setMapError('413 Payload Too Large: превышен лимит размера (ТЗ 5.1)')
          return
        }
        if (!res.ok) {
          const t = await res.text()
          setMapError(`Ошибка загрузки: ${t.slice(0, 200)}`)
          return
        }
        setMessage(`Карта ${file.name} загружена (${(file.size / 1e3).toFixed(0)} кБ)`)
        await refreshMaps()
      } catch (e) {
        setMapError(`Сервис недоступен: ${e instanceof Error ? e.message : e}`)
      }
    } else {
      // wasm-режим: карта в IndexedDB (ТЗ 6.2)
      const { putItuMap } = await import('@/lib/radio/history')
      await putItuMap(file.name, await file.text())
      setMessage(`Карта ${file.name} сохранена в браузере (IndexedDB, wasm-режим)`)
    }
  }

  const uploadSrtm = async (file: File) => {
    setMessage(null)
    try {
      const buf = await file.arrayBuffer()
      const err = addHgtTile(buf, file.name)
      if (err) {
        setMapError(err)
        return
      }
      await putSrtmTile(file.name.replace(/\.hgt$/i, ''), buf)
      setMessage(`Тайл ${file.name} загружен и закэширован в IndexedDB`)
    } catch (e) {
      setMapError(`Не удалось разобрать .hgt: ${e instanceof Error ? e.message : e}`)
    }
  }

  const uploadClutter = async (file: File) => {
    setMessage(null)
    setMapError(null)
    try {
      const json = JSON.parse(await file.text())
      const v = validateClutter(json)
      if (!v.ok) {
        setMapError(`clutter.geojson: ${v.error}`)
        return
      }
      setClutter(json as ClutterGeoJson)
      setMessage(`clutter.geojson принят: ${v.count} объектов (здания/растительность учтутся в профиле)`)
      // Дополнительно отправляем на сервер (http-режим)
      if (backend === 'http') {
        const fd = new FormData()
        fd.append('file', file)
        void fetch(apiUrl('/clutter'), { method: 'POST', body: fd }).catch(() => undefined)
      }
    } catch (e) {
      setMapError(`Некорректный JSON: ${e instanceof Error ? e.message : e}`)
    }
  }

  const deleteMap = async (name: string) => {
    try {
      await fetch(apiUrl(`/maps/${encodeURIComponent(name)}`), { method: 'DELETE' })
      await refreshMaps()
    } catch {
      setMapError('Не удалось удалить карту')
    }
  }

  return (
    <div className="space-y-4">
      {message && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-sm text-emerald-800 dark:text-emerald-300">
          {message}
        </div>
      )}
      {mapError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {mapError}
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Map className="h-4 w-4 text-emerald-600" /> Цифровые карты ITU (P.2001) — ТЗ 5.1
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Формат: .txt (один файл) или .zip (архив). Лимиты: 700 МБ на файл, 1 ГБ на zip.
            При превышении — 413 Payload Too Large. Валидация: расширение, размер, структура, версия.
            {backend === 'http'
              ? ' Загрузка на сервер (том ./data/itu_maps).'
              : ' wasm-режим: карты хранятся в браузере (IndexedDB).'}
          </p>
          <div className="flex items-center gap-2">
            <label className="inline-flex">
              <Input type="file" accept=".txt,.zip" className="hidden" onChange={(e) => e.target.files?.[0] && void uploadItuMap(e.target.files[0])} />
              <Button size="sm" variant="outline" asChild>
                <span><Upload className="h-4 w-4 mr-1" /> Загрузить карту ITU</span>
              </Button>
            </label>
          </div>
          {maps.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Карта</TableHead>
                  <TableHead className="text-right">Размер</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {maps.map((m) => (
                  <TableRow key={m.name}>
                    <TableCell className="text-sm font-mono">{m.name}</TableCell>
                    <TableCell className="text-right text-xs">{(m.size / 1e6).toFixed(1)} МБ</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => void deleteMap(m.name)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Mountain className="h-4 w-4 text-emerald-600" /> Рельеф (DEM) — ТЗ 4.3/5.2
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Активный источник: <Badge variant="secondary">{demInfo}</Badge>. Загрузите тайлы SRTM (.hgt) — они
              кэшируются в IndexedDB. Автозагрузка Copernicus GLO-30 через прокси: GET /api/dem (http-режим).
            </p>
            <label className="inline-flex">
              <Input type="file" accept=".hgt" multiple className="hidden" onChange={(e) => e.target.files && void Promise.all(Array.from(e.target.files).map(uploadSrtm))} />
              <Button size="sm" variant="outline" asChild>
                <span><Upload className="h-4 w-4 mr-1" /> Загрузить SRTM .hgt</span>
              </Button>
            </label>
            {hgtTiles.length > 0 && (
              <p className="text-xs">
                Тайлов в кэше: {hgtTiles.length} ({hgtTiles.map((t) => t.name).join(', ')})
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TreePine className="h-4 w-4 text-emerald-600" /> Здания и растительность (SXF/RSC) — ТЗ 4.6
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Загрузите clutter.geojson (результат офлайн-конвертации SXF + RSC через GDAL/OGR:
              <code className="mx-1 px-1 bg-muted rounded">scripts/sxf2geojson.py</code>).
              Поля: type (building / vegetation), height. Высоты учитываются в профиле трассы, кроме точек антенн.
            </p>
            <label className="inline-flex">
              <Input type="file" accept=".geojson,.json" className="hidden" onChange={(e) => e.target.files?.[0] && void uploadClutter(e.target.files[0])} />
              <Button size="sm" variant="outline" asChild>
                <span><Upload className="h-4 w-4 mr-1" /> Загрузить clutter.geojson</span>
              </Button>
            </label>
            {clutter && (
              <p className="text-xs">
                Активно объектов: {clutter.features.length}
                <Button size="sm" variant="ghost" onClick={() => setClutter(null)} className="ml-2">
                  <Waves className="h-3 w-3 mr-1" /> убрать
                </Button>
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Настройки и PWA</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Анонимный device_id: <code className="px-1 bg-muted rounded font-mono text-xs">{deviceId || '…'}</code>
          </p>
          <p className="text-xs text-muted-foreground">
            История привязана к device_id без авторизации (ТЗ 3.4). HTTPS обязателен для PWA-установки;
            Service Worker кэширует оболочку приложения и /api/* (stale-while-revalidate, TTL 1 ч).
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

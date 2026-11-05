'use client'

/**
 * Карты и настройки:
 *  • цифровые карты ITU (.txt/.zip, лимиты 700 МБ/1 ГБ);
 *  • рельеф (SRTM .hgt) — границы загруженных тайлов отображаются на карте;
 *  • здания и растительность: SXF/RSC с конвертацией в приложении
 *    (кэш IndexedDB, фильтр по квадратам, добавление к существующим данным)
 *    и готовый clutter.geojson;
 *  • настройки PWA.
 */
import { useEffect, useRef, useState } from 'react'
import type * as LType from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useRadioStore } from '@/store/radio-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getDeviceId, putSrtmTile, listSrtmTiles, getSrtmTile, getClutterCache, putClutterCache, clearClutterCache } from '@/lib/radio/history'
import { validateClutter, type ClutterGeoJson, type HgtTile, tileBounds, pointInTiles } from '@/lib/radio/terrain'
import { parseHgt } from '@/lib/radio/terrain'
import { parseSxf, parseRscNames, convertSxfToClutter, mergeClutter } from '@/lib/radio/sxf'
import { apiUrl } from '@/lib/radio/models/api'
import { LIMITS } from '@/lib/radio/constants'
import { Map as MapIcon, Upload, Trash2, Mountain, TreePine, Waves, FileBox, RefreshCw } from 'lucide-react'

interface ItuMapInfo {
  name: string
  size: number
}

/** Мини-карта: границы загруженных тайлов рельефа + трасса A–Б. */
function TileOverviewMap() {
  const divRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LType.Map | null>(null)
  const LRef = useRef<typeof LType | null>(null)
  const layerRef = useRef<LType.LayerGroup | null>(null)

  const hgtTiles = useRadioStore((s) => s.hgtTiles)
  const pointA = useRadioStore((s) => s.pointA)
  const pointB = useRadioStore((s) => s.pointB)

  useEffect(() => {
    let cancelled = false
    import('leaflet').then((mod) => {
      if (cancelled || !divRef.current || mapRef.current) return
      const leaflet = (mod.default ?? mod) as typeof LType
      LRef.current = leaflet
      const map = leaflet.map(divRef.current, { zoomControl: true }).setView([55.7, 37.6], 5)
      leaflet
        .tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap',
        })
        .addTo(map)
      layerRef.current = leaflet.layerGroup().addTo(map)
      mapRef.current = map
    })
    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const leaflet = LRef.current
    const map = mapRef.current
    const layer = layerRef.current
    if (!leaflet || !map || !layer) return
    layer.clearLayers()

    // Границы загруженных тайлов
    const boundsList: LType.LatLngBounds[] = []
    for (const t of hgtTiles) {
      const b = tileBounds(t)
      boundsList.push(leaflet.latLngBounds([b.minLat, b.minLon], [b.maxLat, b.maxLon]))
      leaflet
        .rectangle([leaflet.latLng(b.minLat, b.minLon), leaflet.latLng(b.maxLat, b.maxLon)], {
          color: '#0f766e',
          weight: 1.5,
          fillOpacity: 0.08,
          dashArray: '6 4',
        })
        .bindTooltip(`Тайл ${t.name} (${t.size}×${t.size})`, { sticky: true })
        .addTo(layer)
    }

    // Трасса A–Б
    const line = leaflet.polyline(
      [
        [pointA.lat, pointA.lon],
        [pointB.lat, pointB.lon],
      ],
      { color: '#d97706', weight: 2.5, dashArray: '4 4' },
    )
    line.addTo(layer)
    leaflet.marker([pointA.lat, pointA.lon], { opacity: 0 }).addTo(layer)
    const trackBounds = leaflet.latLngBounds([pointA.lat, pointA.lon], [pointB.lat, pointB.lon])
    const all = [...boundsList, trackBounds]
    if (all.length > 0) {
      let merged = all[0]
      for (const b of all.slice(1)) merged = merged.extend(b)
      map.fitBounds(merged.pad(0.15))
    }
  }, [hgtTiles, pointA, pointB])

  return <div ref={divRef} className="h-[300px] w-full rounded-lg border z-0" />
}

export function MapsPanel() {
  const backend = useRadioStore((s) => s.backend)
  const addHgtTile = useRadioStore((s) => s.addHgtTile)
  const hgtTiles = useRadioStore((s) => s.hgtTiles)
  const setHgtTiles = useRadioStore((s) => s.setHgtTiles)
  const setClutter = useRadioStore((s) => s.setClutter)
  const clutter = useRadioStore((s) => s.clutter)
  const demInfo = useRadioStore((s) => s.demInfo)
  const pointA = useRadioStore((s) => s.pointA)
  const pointB = useRadioStore((s) => s.pointB)

  const [maps, setMaps] = useState<ItuMapInfo[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [mapError, setMapError] = useState<string | null>(null)
  const [deviceId, setDeviceId] = useState('')

  // Состояние конвертации SXF/RSC
  const [sxfFile, setSxfFile] = useState<File | null>(null)
  const [rscFile, setRscFile] = useState<File | null>(null)
  const [squaresInput, setSquaresInput] = useState('')
  const [converting, setConverting] = useState(false)
  const [sxfError, setSxfError] = useState<string | null>(null)
  const [sxfStatus, setSxfStatus] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDeviceId(getDeviceId()), 0)
    return () => clearTimeout(t)
  }, [])

  // Загрузка кэша SXF-данных (clutter) из IndexedDB при старте
  useEffect(() => {
    void (async () => {
      try {
        const cached = await getClutterCache()
        if (cached) {
          const v = validateClutter(cached)
          if (v.ok) setClutter(cached as ClutterGeoJson)
        }
      } catch {
        // IndexedDB недоступна — игнорируем
      }
    })()
  }, [setClutter])

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
  }, [setHgtTiles])

  const uploadItuMap = async (file: File) => {
    setMapError(null)
    setMessage(null)
    const ext = file.name.toLowerCase().split('.').pop() ?? ''
    if (ext !== 'txt' && ext !== 'zip') {
      setMapError('Допустимы только файлы .txt и .zip')
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
          setMapError('Превышен лимит размера файла (HTTP 413 Payload Too Large)')
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
      // wasm-режим: карта в IndexedDB
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
      // Добавление к существующим данным (без перезаписи)
      const merged = mergeClutter(clutter, json as ClutterGeoJson)
      setClutter(merged)
      await putClutterCache(merged)
      setMessage(`clutter.geojson принят: ${v.count} объектов добавлено к существующим (всего ${merged.features.length})`)
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

  /** Конвертация SXF/RSC средствами приложения с фильтром по квадратам. */
  const convertSxf = async () => {
    setSxfError(null)
    setSxfStatus(null)
    if (!sxfFile) {
      setSxfError('Выберите файл .sxf')
      return
    }
    setConverting(true)
    try {
      const buf = await sxfFile.arrayBuffer()
      const parsed = parseSxf(buf)
      const rscNames = rscFile ? parseRscNames(await rscFile.arrayBuffer()) : undefined
      const res = convertSxfToClutter(parsed, { squares: squaresInput, rscNames })
      if (res.keptObjects === 0) {
        setSxfError(
          `Площадных объектов по выбранным квадратам не найдено. В файле: ${res.totalObjects} площадных объектов, зона ${res.zone}. ` +
            (squaresInput.trim() ? 'Проверьте список квадратов (формат X-Y, напр. 6183-413).' : ''),
        )
        setConverting(false)
        return
      }
      const v = validateClutter(res.geojson)
      if (!v.ok) {
        setSxfError(`Результат конвертации не прошёл проверку: ${v.error}`)
        setConverting(false)
        return
      }
      // Добавление к существующим данным без перезаписи
      const merged = mergeClutter(clutter, res.geojson)
      setClutter(merged)
      await putClutterCache(merged)
      setSxfStatus(
        `Готово: в файле ${res.totalObjects} площадных объектов, по квадратам отобрано ${res.keptObjects}, ` +
          `добавлено к существующим (всего ${merged.features.length}). Зона СК-42: ${res.zone || '—'}. Данные закэшированы в браузере.`,
      )
    } catch (e) {
      setSxfError(e instanceof Error ? e.message : String(e))
    } finally {
      setConverting(false)
    }
  }

  const clearSxfData = async () => {
    setClutter(null)
    try {
      await clearClutterCache()
    } catch {
      // кэш недоступен — не критично
    }
    setSxfStatus(null)
    setMessage('Данные зданий/растительности очищены (включая кэш браузера)')
  }

  const deleteMap = async (name: string) => {
    try {
      await fetch(apiUrl(`/maps/${encodeURIComponent(name)}`), { method: 'DELETE' })
      await refreshMaps()
    } catch {
      setMapError('Не удалось удалить карту')
    }
  }

  // Живая проверка: попадает ли трасса в покрытие тайлов
  const trackInside =
    hgtTiles.length === 0
      ? null
      : pointInTiles(pointA.lat, pointA.lon, hgtTiles) && pointInTiles(pointB.lat, pointB.lon, hgtTiles)

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
            <Mountain className="h-4 w-4 text-emerald-600" /> Рельеф (DEM) — границы загруженных тайлов
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-muted-foreground flex-1 min-w-[220px]">
              Активный источник: <Badge variant="secondary">{demInfo}</Badge>. Загрузите тайлы SRTM (.hgt) — они
              кэшируются в IndexedDB. Границы тайлов показаны на карте ниже; трасса A–Б — оранжевым пунктиром.
              Автозагрузка Copernicus GLO-30 через прокси: GET /api/dem (http-режим).
            </p>
            <label className="inline-flex">
              <Input type="file" accept=".hgt" multiple className="hidden" onChange={(e) => e.target.files && void Promise.all(Array.from(e.target.files).map(uploadSrtm))} />
              <Button size="sm" variant="outline" asChild>
                <span><Upload className="h-4 w-4 mr-1" /> Загрузить SRTM .hgt</span>
              </Button>
            </label>
          </div>

          {hgtTiles.length > 0 && (
            <div className="text-sm">
              Загружено тайлов: <span className="font-semibold">{hgtTiles.length}</span>
              {trackInside === false && (
                <Badge variant="destructive" className="ml-2">
                  Трасса выходит за пределы тайлов — загрузите соседние тайлы
                </Badge>
              )}
              {trackInside === true && (
                <Badge className="ml-2 bg-emerald-600">Трасса внутри покрытия тайлов</Badge>
              )}
            </div>
          )}

          <TileOverviewMap />

          {hgtTiles.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Тайлы не загружены — карта пуста. После загрузки .hgt здесь появятся прямоугольники покрытия.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TreePine className="h-4 w-4 text-emerald-600" /> Здания и растительность (SXF/RSC)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Загрузите «голые» файлы SXF (+ при желании классификатор RSC) — приложение конвертирует их само,
            без внешних инструментов. Координаты метрики СК-42 преобразуются в WGS 84, площадные объекты
            (застройка, растительность) фильтруются по квадратам километровой сетки, высоты учитываются в профиле
            трассы. Конвертированные данные кэшируются в браузере и <b>добавляются</b> к уже загруженным квадратам,
            а не перезаписывают их.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Файл SXF (.sxf)</Label>
              <Input
                type="file"
                accept=".sxf"
                onChange={(e) => setSxfFile(e.target.files?.[0] ?? null)}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs">Классификатор RSC (.rsc, необязательно)</Label>
              <Input
                type="file"
                accept=".rsc"
                onChange={(e) => setRscFile(e.target.files?.[0] ?? null)}
                className="h-9"
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">
                Квадраты километровой сетки (X–Y, через запятую; пусто — весь файл)
              </Label>
              <Input
                value={squaresInput}
                onChange={(e) => setSquaresInput(e.target.value)}
                placeholder="6183-413, 6183-414, 6184-413"
                className="font-mono"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Формат квадрата: северное направление X – восточное Y в километрах (X–Y), например 6183-413.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void convertSxf()} disabled={converting || !sxfFile}>
              <FileBox className="h-4 w-4 mr-1" />
              {converting ? 'Конвертация…' : 'Конвертировать и добавить'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void clearSxfData()} disabled={!clutter}>
              <RefreshCw className="h-4 w-4 mr-1" /> Очистить данные
            </Button>
          </div>

          {sxfError && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {sxfError}
            </div>
          )}
          {sxfStatus && (
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-sm text-emerald-800 dark:text-emerald-300">
              {sxfStatus}
            </div>
          )}

          <div className="border-t pt-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              Альтернатива: готовый clutter.geojson (результат офлайн-конвертации SXF + RSC:
              <code className="mx-1 px-1 bg-muted rounded">scripts/sxf2geojson.py</code>). Поля: type (building /
              vegetation), height. Новые объекты также добавляются к существующим.
            </p>
            <div className="flex items-center gap-2">
              <label className="inline-flex">
                <Input type="file" accept=".geojson,.json" className="hidden" onChange={(e) => e.target.files?.[0] && void uploadClutter(e.target.files[0])} />
                <Button size="sm" variant="outline" asChild>
                  <span><Upload className="h-4 w-4 mr-1" /> Загрузить clutter.geojson</span>
                </Button>
              </label>
              {clutter && (
                <p className="text-xs">
                  Активно объектов: <b>{clutter.features.length}</b>
                  <Button size="sm" variant="ghost" onClick={() => void clearSxfData()} className="ml-1">
                    <Waves className="h-3 w-3 mr-1" /> убрать все
                  </Button>
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <MapIcon className="h-4 w-4 text-emerald-600" /> Цифровые карты ITU (P.2001)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Формат: .txt (один файл) или .zip (архив). Лимиты: 700 МБ на файл, 1 ГБ на zip.
            При превышении — ошибка 413 Payload Too Large. Валидация: расширение, размер, структура, версия.
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

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Настройки и PWA</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Анонимный device_id: <code className="px-1 bg-muted rounded font-mono text-xs">{deviceId || '…'}</code>
          </p>
          <p className="text-xs text-muted-foreground">
            История привязана к device_id без авторизации. HTTPS обязателен для PWA-установки;
            Service Worker кэширует оболочку приложения и /api/* (stale-while-revalidate, TTL 1 ч).
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

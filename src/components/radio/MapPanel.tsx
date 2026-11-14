'use client'

/**
 * Интерактивная карта (Leaflet):
 * точки A/Б, линия трассы, маркеры антенн, зона связи, границы загруженных
 * тайлов рельефа, траектория объекта, переключение типа карты
 * (схема / спутник / гибрид), анимация при ≥ 24 FPS с измерением FPS.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as LType from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useRadioStore } from '@/store/radio-store'
import { zoneRadiusM, trajectoryPoints } from '@/lib/radio/doppler'
import { routeStateAt, routeDurationS } from '@/lib/radio/route'
import { tileBounds } from '@/lib/radio/terrain'
import { auditClearance } from '@/lib/radio/clearance'
import { FPS_THRESHOLD } from '@/lib/radio/constants'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Maximize2, Minimize2 } from 'lucide-react'

type MapStyle = 'scheme' | 'satellite' | 'hybrid'

const BASE_LAYERS: Record<MapStyle, { url: string; attribution: string; maxZoom: number; overlayUrl?: string }> = {
  scheme: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19,
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
  },
  hybrid: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
    overlayUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  },
}

export function MapPanel() {
  const mapDivRef = useRef<HTMLDivElement | null>(null)
  const LRef = useRef<typeof LType | null>(null)
  const mapRef = useRef<LType.Map | null>(null)
  const markerARef = useRef<LType.Marker | null>(null)
  const markerBRef = useRef<LType.Marker | null>(null)
  const markerCRef = useRef<LType.Marker | null>(null)
  const lineRef = useRef<LType.Polyline | null>(null)
  const zoneRef = useRef<LType.Circle | null>(null)
  const trajRef = useRef<LType.Polyline | null>(null)
  const animMarkerRef = useRef<LType.Marker | null>(null)
  const rafRef = useRef<number | null>(null)
  const baseLayerRef = useRef<LType.TileLayer | null>(null)
  const overlayLayerRef = useRef<LType.TileLayer | null>(null)
  const tilesLayerRef = useRef<LType.LayerGroup | null>(null)
  /** Вид карты на момент переключения полноэкранного режима — для восстановления */
  const viewRef = useRef<{ center: LType.LatLng; zoom: number } | null>(null)
  const fsBtnRef = useRef<HTMLButtonElement | null>(null)

  const [clickMode, setClickMode] = useState<'A' | 'Б' | 'C'>('Б')
  const [mapStyle, setMapStyle] = useState<MapStyle>('scheme')
  const [showTiles, setShowTiles] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [L, setL] = useState<typeof LType | null>(null)

  const pointA = useRadioStore((s) => s.pointA)
  const pointB = useRadioStore((s) => s.pointB)
  const setPointA = useRadioStore((s) => s.setPointA)
  const setPointB = useRadioStore((s) => s.setPointB)
  const budget = useRadioStore((s) => s.budget)
  const result = useRadioStore((s) => s.result)
  const equipment = useRadioStore((s) => s.equipment)
  const frequencyMhz = useRadioStore((s) => s.frequencyMhz)
  const dynamics = useRadioStore((s) => s.dynamics)
  const dynamicsParams = useRadioStore((s) => s.dynamicsParams)
  const route = useRadioStore((s) => s.route)
  const hgtTiles = useRadioStore((s) => s.hgtTiles)
  const animationAllowed = useRadioStore((s) => s.animationAllowed)
  const fpsMeasured = useRadioStore((s) => s.fpsMeasured)
  const lastInput = useRadioStore((s) => s.lastInput)
  const interferenceEnabled = useRadioStore((s) => s.interferenceEnabled)
  const interferenceSource = useRadioStore((s) => s.interferenceSource)
  const setField = useRadioStore((s) => s.setField)

  // Класс трассы (clearance-аудит): бейдж light/heavy в тулбаре карты
  const routeClass = useMemo(() => (lastInput ? auditClearance(lastInput).routeClass : null), [lastInput])

  // Инициализация карты
  useEffect(() => {
    let cancelled = false
    import('leaflet').then((mod) => {
      if (cancelled || !mapDivRef.current || mapRef.current) return
      const leaflet = (mod.default ?? mod) as typeof LType
      setL(leaflet)
      LRef.current = leaflet
      const map = leaflet.map(mapDivRef.current, { zoomControl: true }).setView([55.79, 37.73], 10)
      const scheme = BASE_LAYERS.scheme
      baseLayerRef.current = leaflet
        .tileLayer(scheme.url, { maxZoom: scheme.maxZoom, attribution: scheme.attribution })
        .addTo(map)
      tilesLayerRef.current = leaflet.layerGroup().addTo(map)
      map.on('click', (e: LType.LeafletMouseEvent) => {
        const p = { lat: e.latlng.lat, lon: e.latlng.lng }
        if (clickModeRef.current === 'A') setPointA(p)
        else if (clickModeRef.current === 'C') setField('interferenceSource', p)
        else setPointB(p)
      })
      mapRef.current = map
    })
    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  const clickModeRef = useRef(clickMode)
  clickModeRef.current = clickMode

  // Полноэкранный режим карты (этап UX.5): контейнер fixed поверх страницы,
  // кнопка управления — ВНУТРИ контейнера карты (внешняя кнопка перекрывалась
  // полноэкранным слоем и становилась недостижимой). После смены класса
  // пересчитываем размер Leaflet и детерминированно восстанавливаем вид
  // (центр/зум на момент переключения) — иначе вид «улетает». Escape закрывает.
  const toggleFullscreen = useCallback(() => {
    const map = mapRef.current
    if (map) viewRef.current = { center: map.getCenter(), zoom: map.getZoom() }
    setFullscreen((v) => !v)
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const t = setTimeout(() => {
      // Двойной пересчёт: после фиксации CSS и после перерисовки тайлов
      map.invalidateSize({ animate: false, pan: false })
      const v = viewRef.current
      if (v) map.setView(v.center, v.zoom, { animate: false })
      map.invalidateSize({ animate: false, pan: false })
    }, 80)
    if (!fullscreen) {
      return () => clearTimeout(t)
    }
    // Скролл страницы под оверлеем блокируем (overflow на html — каноничный
    // лок вьюпорта) и запоминаем позицию: без этого страница прокручивается
    // за полноэкранной картой, и после сворачивания пользователь остаётся
    // «проехавшим» вниз — шапка и вкладки уезжают за край
    const savedScrollY = window.scrollY
    const scrollbarW = window.innerWidth - document.documentElement.clientWidth
    document.documentElement.style.overflow = 'hidden'
    if (scrollbarW > 0) document.body.style.paddingRight = `${scrollbarW}px`
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') toggleFullscreen()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onKey)
      document.documentElement.style.overflow = ''
      document.body.style.paddingRight = ''
      // Точная позиция страницы на момент разворота — вид целиком предсказуем
      window.scrollTo(0, savedScrollY)
    }
  }, [fullscreen])

  // Кнопка полноэкранного режима лежит внутри контейнера Leaflet: клики по ней
  // не должны ставить точку A/Б/C и крутить зум — отключаем всплытие событий
  useEffect(() => {
    const el = fsBtnRef.current
    const leaflet = LRef.current
    if (!el || !leaflet) return
    leaflet.DomEvent.disableClickPropagation(el)
    leaflet.DomEvent.disableScrollPropagation(el)
  }, [L, fullscreen])

  // Переключение типа карты (схема / спутник / гибрид)
  useEffect(() => {
    const leaflet = LRef.current
    const map = mapRef.current
    if (!leaflet || !map) return
    const conf = BASE_LAYERS[mapStyle]
    baseLayerRef.current?.remove()
    overlayLayerRef.current?.remove()
    baseLayerRef.current = leaflet.tileLayer(conf.url, { maxZoom: conf.maxZoom, attribution: conf.attribution }).addTo(map)
    if (conf.overlayUrl) {
      overlayLayerRef.current = leaflet
        .tileLayer(conf.overlayUrl, { maxZoom: conf.maxZoom, opacity: 0.9 })
        .addTo(map)
    }
  }, [mapStyle, L])

  // Границы загруженных тайлов рельефа на карте
  useEffect(() => {
    const leaflet = LRef.current
    const layer = tilesLayerRef.current
    if (!leaflet || !layer) return
    layer.clearLayers()
    if (!showTiles) return
    for (const t of hgtTiles) {
      const b = tileBounds(t)
      leaflet
        .rectangle([leaflet.latLng(b.minLat, b.minLon), leaflet.latLng(b.maxLat, b.maxLon)], {
          color: '#0f766e',
          weight: 1.5,
          fillOpacity: 0.06,
          dashArray: '6 4',
        })
        .bindTooltip(`Тайл ${t.name}`, { sticky: true })
        .addTo(layer)
    }
  }, [hgtTiles, showTiles, L])

  // Точки и трасса. Маркеры — персистентные инстансы (этап UX.4): создаются
  // один раз с dragend → setPointA/setPointB, при изменении точек переносится
  // только позиция (setLatLng), а не пересоздание. Автопересчёта при переносе
  // нет — расчёт по кнопке «Рассчитать» (конвенция проекта).
  useEffect(() => {
    const leaflet = LRef.current
    const map = mapRef.current
    if (!leaflet || !map) return

    const icon = (color: string, label: string) =>
      leaflet.divIcon({
        html: `<div style="background:${color};color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">${label}</div>`,
        className: '',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      })

    if (!markerARef.current) {
      markerARef.current = leaflet
        .marker([pointA.lat, pointA.lon], { icon: icon('#059669', 'A'), draggable: true, autoPan: true })
        .addTo(map)
      markerARef.current.on('dragend', () => {
        const ll = markerARef.current!.getLatLng()
        setPointA({ lat: ll.lat, lon: ll.lng })
      })
    } else {
      markerARef.current.setLatLng([pointA.lat, pointA.lon])
    }
    if (!markerBRef.current) {
      markerBRef.current = leaflet
        .marker([pointB.lat, pointB.lon], { icon: icon('#d97706', 'Б'), draggable: true, autoPan: true })
        .addTo(map)
      markerBRef.current.on('dragend', () => {
        const ll = markerBRef.current!.getLatLng()
        setPointB({ lat: ll.lat, lon: ll.lng })
      })
    } else {
      markerBRef.current.setLatLng([pointB.lat, pointB.lon])
    }

    if (!lineRef.current) {
      lineRef.current = leaflet
        .polyline(
          [
            [pointA.lat, pointA.lon],
            [pointB.lat, pointB.lon],
          ],
          { color: '#0f766e', weight: 3, dashArray: '8 6' },
        )
        .addTo(map)
    } else {
      lineRef.current.setLatLngs([
        [pointA.lat, pointA.lon],
        [pointB.lat, pointB.lon],
      ])
    }

    // Обе точки всегда в кадре при изменении трассы (загрузка из истории,
    // ввод координат, клик по карте). Зум карты не фиксируется: maxZoom
    // ограничивает только автоподгонку, дальше карта зумится свободно.
    // animate: false — иначе отложенная zoom-анимация перебивает последующий
    // fitBounds траектории (эффект ниже) при перемонтировании вкладки.
    map.fitBounds(lineRef.current.getBounds(), { padding: [50, 50], maxZoom: 15, animate: false })
  }, [pointA, pointB, L, setPointA, setPointB])

  // Маркер источника помехи (роадмап 2.3): персистентный, перетаскиваемый
  useEffect(() => {
    const leaflet = LRef.current
    const map = mapRef.current
    if (!leaflet || !map) return
    if (!interferenceEnabled) {
      markerCRef.current?.remove()
      markerCRef.current = null
      return
    }
    const iconC = leaflet.divIcon({
      html: `<div style="background:#dc2626;color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">C</div>`,
      className: '',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    })
    if (!markerCRef.current) {
      markerCRef.current = leaflet
        .marker([interferenceSource.lat, interferenceSource.lon], { icon: iconC, draggable: true, autoPan: true })
        .addTo(map)
      markerCRef.current.on('dragend', () => {
        const ll = markerCRef.current!.getLatLng()
        setField('interferenceSource', { lat: ll.lat, lon: ll.lng })
      })
    } else {
      markerCRef.current.setLatLng([interferenceSource.lat, interferenceSource.lon])
    }
  }, [interferenceEnabled, interferenceSource, L, setField])

  // Зона связи
  useEffect(() => {
    const leaflet = LRef.current
    const map = mapRef.current
    if (!leaflet || !map) return
    zoneRef.current?.remove()
    if (!result || !budget) return
    const r = zoneRadiusM({
      powerDbm: equipment.transmitter.powerDbm,
      txGainDbi: equipment.tx.gainDbi,
      rxGainDbi: equipment.rx.gainDbi,
      sensitivityDbm: equipment.receiver.sensitivityDbm,
      frequencyMhz,
      marginDb: 0,
    })
    zoneRef.current = leaflet.circle([pointA.lat, pointA.lon], {
      radius: Math.min(r, 2_000_000),
      color: '#0f766e',
      weight: 1,
      fillOpacity: 0.05,
      dashArray: '4 4',
    }).addTo(map)
  }, [result, budget, equipment, frequencyMhz, pointA, L])

  // Траектория объекта: полилиния маршрута из файла либо линия по азимуту
  useEffect(() => {
    const leaflet = LRef.current
    const map = mapRef.current
    if (!leaflet || !map) return
    trajRef.current?.remove()
    if (!dynamics) return
    const pts = trajectoryPoints(pointA, dynamicsParams, route).map((p) => [p.lat, p.lon] as [number, number])
    trajRef.current = leaflet.polyline(pts, { color: '#dc2626', weight: 2 }).addTo(map)
    map.fitBounds(trajRef.current.getBounds().extend(lineRef.current!.getBounds()), { padding: [30, 30], animate: false })
  }, [dynamics, dynamicsParams, pointA, route, L])

  // Анимация траектории с измерением FPS
  useEffect(() => {
    const leaflet = LRef.current
    const map = mapRef.current
    if (!leaflet || !map) return

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    animMarkerRef.current?.remove()
    animMarkerRef.current = null

    if (!dynamics || animationAllowed !== true) return

    const speedMs = dynamicsParams.speedKmh / 3.6
    const az = dynamicsParams.trajectoryAzimuthDeg
    const duration = route ? routeDurationS(route) : dynamicsParams.durationS
    const frames: number[] = []
    let lastT = performance.now()
    const start = performance.now()

    const tick = (now: number) => {
      const dt = (now - lastT) / 1000
      lastT = now
      // FPS за первые 1.5 с
      const elapsed = (now - start) / 1000
      if (elapsed < 1.5) {
        if (dt > 0) frames.push(1 / dt)
      } else if (frames.length > 0 && useRadioStore.getState().fpsMeasured === null) {
        const fps = frames.reduce((a, b) => a + b, 0) / frames.length
        setField('fpsMeasured', Math.round(fps))
        if (fps < FPS_THRESHOLD) {
          // < 24 FPS → графики вместо анимации
          setField('animationAllowed', false)
          animMarkerRef.current?.remove()
          animMarkerRef.current = null
          return
        }
      }

      let lat: number
      let lon: number
      if (route) {
        // Позиция вдоль ломаной маршрута в момент времени цикла
        const st = routeStateAt(route, (now / 1000) % duration)
        lat = st.pos.lat
        lon = st.pos.lon
      } else {
        const t = ((now / 1000) % duration)
        const d = speedMs * t
        const rad = (az * Math.PI) / 180
        const dLat = (d * Math.cos(rad)) / 111_320
        const dLon = (d * Math.sin(rad)) / (111_320 * Math.cos((pointA.lat * Math.PI) / 180))
        lat = pointA.lat + dLat
        lon = pointA.lon + dLon
      }
      if (!animMarkerRef.current) {
        animMarkerRef.current = leaflet
          .marker([lat, lon], {
            icon: leaflet.divIcon({
              html: '<div style="font-size:20px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))">✈</div>',
              className: '',
              iconSize: [20, 20],
              iconAnchor: [10, 10],
            }),
          })
          .addTo(map)
      } else {
        animMarkerRef.current.setLatLng([lat, lon])
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [dynamics, animationAllowed, dynamicsParams, pointA, route, L, setField])

  const styleBtn = (id: MapStyle, label: string) => (
    <Button
      key={id}
      size="sm"
      variant={mapStyle === id ? 'default' : 'outline'}
      onClick={() => setMapStyle(id)}
    >
      {label}
    </Button>
  )

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={clickMode === 'A' ? 'default' : 'outline'}
          onClick={() => setClickMode('A')}
        >
          Клик → точка A
        </Button>
        <Button
          size="sm"
          variant={clickMode === 'Б' ? 'default' : 'outline'}
          onClick={() => setClickMode('Б')}
        >
          Клик → точка Б
        </Button>
        <Button
          size="sm"
          variant={clickMode === 'C' ? 'default' : 'outline'}
          className={clickMode === 'C' ? 'bg-red-600 hover:bg-red-700' : ''}
          onClick={() => setClickMode('C')}
        >
          Клик → помеха
        </Button>
        <div className="flex items-center gap-1.5 ml-1 pl-2 border-l">
          <span className="text-xs text-muted-foreground mr-1">Тип карты:</span>
          {styleBtn('scheme', 'Схема')}
          {styleBtn('satellite', 'Спутник')}
          {styleBtn('hybrid', 'Гибрид')}
        </div>
        {routeClass && (
          <Badge
            variant="outline"
            className={`ml-1 ${routeClass === 'light' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}
          >
            {routeClass === 'light' ? 'лёгкая трасса' : 'тяжёлая трасса'}
          </Badge>
        )}
        {hgtTiles.length > 0 && (
          <Button
            size="sm"
            variant={showTiles ? 'default' : 'outline'}
            onClick={() => setShowTiles((v) => !v)}
          >
            Границы тайлов рельефа
          </Button>
        )}
        {dynamics && animationAllowed === true && (
          <Badge className="bg-emerald-600">Анимация: FPS {fpsMeasured ?? '…'} ≥ {FPS_THRESHOLD}</Badge>
        )}
        {dynamics && animationAllowed === false && (
          <Badge variant="destructive">
            Анимация отключена: FPS {fpsMeasured ?? '<24'} &lt; {FPS_THRESHOLD} — используйте графики
          </Badge>
        )}
      </div>
      <div
        ref={mapDivRef}
        className="h-[380px] w-full rounded-lg border z-0"
        data-fullscreen={fullscreen ? 'true' : undefined}
        style={
          // Геометрия контейнера — инлайн-стилями, БЕЗ опоры на leaflet.css:
          // в собранном чанке у .leaflet-container нет position (панели
          // position:absolute якорятся к вьюпорту → тайлы «улетают» за 380px
          // контейнер и перекрывают страницу). Инлайн сильнее любых классов.
          fullscreen
            ? {
                position: 'fixed',
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                zIndex: 1000,
                width: '100vw',
                height: '100vh',
                overflow: 'hidden',
                borderRadius: 0,
                borderWidth: 0,
              }
            : { position: 'relative', overflow: 'hidden', borderRadius: '8px' }
        }
      >
        {/* Кнопка полноэкранного режима — внутри карты: во весь экран карту
            разворачивает слой, перекрывающий внешние элементы тулбара */}
        <button
          ref={fsBtnRef}
          type="button"
          onClick={toggleFullscreen}
          className="absolute top-2.5 right-2.5 z-[900] inline-flex items-center gap-1.5 rounded-md border border-input bg-background/90 px-2.5 py-1.5 text-xs font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
          title={fullscreen ? 'Свернуть карту (Esc)' : 'Развернуть карту на весь экран'}
        >
          {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          {fullscreen ? 'Свернуть' : 'Во весь экран'}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Клик по карте ставит выбранную точку (или источник помехи в режиме «помеха»), маркеры A, Б и C
        можно перетаскивать (позиция переносится в форму). Зона связи показывается после расчёта, траектория —
        после расчёта динамики, границы загруженных тайлов рельефа — бирюзовым пунктиром.
      </p>
    </div>
  )
}

'use client'

/**
 * Интерактивная карта (Leaflet):
 * точки A/Б, линия трассы, маркеры антенн, зона связи, границы загруженных
 * тайлов рельефа, траектория объекта, переключение типа карты
 * (схема / спутник / гибрид), анимация при ≥ 24 FPS с измерением FPS.
 */
import { useEffect, useRef, useState } from 'react'
import type * as LType from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useRadioStore } from '@/store/radio-store'
import { zoneRadiusM, trajectoryPoints } from '@/lib/radio/doppler'
import { tileBounds } from '@/lib/radio/terrain'
import { FPS_THRESHOLD } from '@/lib/radio/constants'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

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
  const lineRef = useRef<LType.Polyline | null>(null)
  const zoneRef = useRef<LType.Circle | null>(null)
  const trajRef = useRef<LType.Polyline | null>(null)
  const animMarkerRef = useRef<LType.Marker | null>(null)
  const rafRef = useRef<number | null>(null)
  const baseLayerRef = useRef<LType.TileLayer | null>(null)
  const overlayLayerRef = useRef<LType.TileLayer | null>(null)
  const tilesLayerRef = useRef<LType.LayerGroup | null>(null)

  const [clickMode, setClickMode] = useState<'A' | 'Б'>('Б')
  const [mapStyle, setMapStyle] = useState<MapStyle>('scheme')
  const [showTiles, setShowTiles] = useState(true)
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
  const hgtTiles = useRadioStore((s) => s.hgtTiles)
  const animationAllowed = useRadioStore((s) => s.animationAllowed)
  const fpsMeasured = useRadioStore((s) => s.fpsMeasured)
  const setField = useRadioStore((s) => s.setField)

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

  // Точки и трасса
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

    markerARef.current?.remove()
    markerBRef.current?.remove()
    markerARef.current = leaflet.marker([pointA.lat, pointA.lon], { icon: icon('#059669', 'A') }).addTo(map)
    markerBRef.current = leaflet.marker([pointB.lat, pointB.lon], { icon: icon('#d97706', 'Б') }).addTo(map)

    lineRef.current?.remove()
    lineRef.current = leaflet
      .polyline(
        [
          [pointA.lat, pointA.lon],
          [pointB.lat, pointB.lon],
        ],
        { color: '#0f766e', weight: 3, dashArray: '8 6' },
      )
      .addTo(map)
  }, [pointA, pointB, L])

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

  // Траектория объекта
  useEffect(() => {
    const leaflet = LRef.current
    const map = mapRef.current
    if (!leaflet || !map) return
    trajRef.current?.remove()
    if (!dynamics) return
    const pts = trajectoryPoints(pointA, dynamicsParams).map((p) => [p.lat, p.lon] as [number, number])
    trajRef.current = leaflet.polyline(pts, { color: '#dc2626', weight: 2 }).addTo(map)
    map.fitBounds(trajRef.current.getBounds().extend(lineRef.current!.getBounds()), { padding: [30, 30] })
  }, [dynamics, dynamicsParams, pointA, L])

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
    const duration = dynamicsParams.durationS
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

      const t = ((now / 1000) % duration)
      const d = speedMs * t
      const rad = (az * Math.PI) / 180
      const dLat = (d * Math.cos(rad)) / 111_320
      const dLon = (d * Math.sin(rad)) / (111_320 * Math.cos((pointA.lat * Math.PI) / 180))
      if (!animMarkerRef.current) {
        animMarkerRef.current = leaflet
          .marker([pointA.lat + dLat, pointA.lon + dLon], {
            icon: leaflet.divIcon({
              html: '<div style="font-size:20px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))">✈</div>',
              className: '',
              iconSize: [20, 20],
              iconAnchor: [10, 10],
            }),
          })
          .addTo(map)
      } else {
        animMarkerRef.current.setLatLng([pointA.lat + dLat, pointA.lon + dLon])
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [dynamics, animationAllowed, dynamicsParams, pointA, L, setField])

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
        <div className="flex items-center gap-1.5 ml-1 pl-2 border-l">
          <span className="text-xs text-muted-foreground mr-1">Тип карты:</span>
          {styleBtn('scheme', 'Схема')}
          {styleBtn('satellite', 'Спутник')}
          {styleBtn('hybrid', 'Гибрид')}
        </div>
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
      <div ref={mapDivRef} className="h-[380px] w-full rounded-lg border z-0" />
      <p className="text-xs text-muted-foreground">
        Клик по карте ставит выбранную точку. Зона связи показывается после расчёта, траектория — после расчёта
        динамики, границы загруженных тайлов рельефа — бирюзовым пунктиром.
      </p>
    </div>
  )
}

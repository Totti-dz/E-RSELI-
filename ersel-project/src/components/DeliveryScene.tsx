import { useEffect, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MAP_CENTER, ROUTING_ENABLED } from '../lib/geo/config'
import { MAP_ATTRIBUTION, MAP_STYLE_URL, supportsWebGL } from '../lib/geo/map3d'
import { fetchDrivingRoute, formatDistance, formatDuration } from '../lib/geo/routing'
import type { LatLng } from '../lib/geo/config'

type Props = {
  pickup: LatLng | null
  dropoff: LatLng | null
  livePosition?: LatLng | null
  liveAvailable?: boolean
  statusLabel: string
}

type Mode = '3d' | '2d' | 'unsupported'

export default function DeliveryScene({ pickup, dropoff, livePosition = null, liveAvailable = false, statusLabel }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [mode, setMode] = useState<Mode>(() => (supportsWebGL() ? '3d' : 'unsupported'))
  const [routeInfo, setRouteInfo] = useState<{ distanceM: number; durationS: number } | null>(null)
  const [routeError, setRouteError] = useState('')
  const [mapError, setMapError] = useState('')
  const routeCoords = useRef<[number, number][]>([])
  const [previewing, setPreviewing] = useState(false)
  const vehicleMarker = useRef<maplibregl.Marker | null>(null)
  const previewTimer = useRef<number | null>(null)

  useEffect(() => {
    if (mode === 'unsupported') return
    const node = containerRef.current
    if (!node) return

    const map = new maplibregl.Map({
      container: node,
      style: MAP_STYLE_URL,
      center: [MAP_CENTER.lng, MAP_CENTER.lat],
      zoom: 14,
      pitch: mode === '3d' ? 58 : 0,
      bearing: mode === '3d' ? -18 : 0,
      attributionControl: false,
      maxPitch: 70
    })
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left')
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left')
    mapRef.current = map

    map.on('error', event => {
      const message = event.error?.message || ''
      if (/failed to fetch|webgl|style/i.test(message)) {
        setMapError('تعذّر تحميل المشهد ثلاثي الأبعاد. يمكنك التبديل إلى العرض المسطح.')
      }
    })

    map.on('load', () => {
      if (!map.getSource('ersel-route')) {
        map.addSource('ersel-route', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        })
        map.addLayer({
          id: 'ersel-route-line',
          type: 'line',
          source: 'ersel-route',
          paint: { 'line-color': '#1e5bb8', 'line-width': 5, 'line-opacity': 0.9 }
        })
      }
    })

    return () => {
      if (previewTimer.current) window.clearTimeout(previewTimer.current)
      vehicleMarker.current?.remove()
      vehicleMarker.current = null
      map.remove()
      mapRef.current = null
    }
  }, [mode])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const markers: maplibregl.Marker[] = []
    const liveMap = map
    function pin(point: LatLng, className: string, label: string) {
      const el = document.createElement('div')
      el.className = className
      el.title = label
      markers.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([point.lng, point.lat]).addTo(liveMap))
    }
    if (pickup) pin(pickup, 'scene-pin scene-pin-pickup', 'الاستلام')
    if (dropoff) pin(dropoff, 'scene-pin scene-pin-dropoff', 'التسليم')
    if (liveAvailable && livePosition) pin(livePosition, 'scene-pin scene-pin-live', 'الموقع الحالي')

    return () => { markers.forEach(marker => marker.remove()) }
  }, [pickup, dropoff, livePosition, liveAvailable, mode])

  useEffect(() => {
    let cancelled = false
    setRouteInfo(null)
    setRouteError('')
    if (!pickup || !dropoff) return
    if (!ROUTING_ENABLED) {
      setRouteError('حساب مسار القيادة غير مفعّل. لا نرسم مساراً تقديرياً.')
      routeCoords.current = []
      return
    }

    void fetchDrivingRoute(pickup, dropoff).then(result => {
      if (cancelled) return
      const map = mapRef.current
      const applyEmpty = () => {
        const source = map?.getSource('ersel-route') as GeoJSONSource | undefined
        source?.setData({ type: 'FeatureCollection', features: [] })
      }
      if (!result.ok) {
        setRouteError(result.error)
        routeCoords.current = []
        applyEmpty()
        return
      }
      routeCoords.current = result.geometry
      setRouteInfo({ distanceM: result.distanceM, durationS: result.durationS })
      const data = {
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'LineString' as const, coordinates: result.geometry }
      }
      if (map?.isStyleLoaded()) {
        const source = map.getSource('ersel-route') as GeoJSONSource | undefined
        source?.setData(data)
      } else {
        map?.once('load', () => {
          const source = map.getSource('ersel-route') as GeoJSONSource | undefined
          source?.setData(data)
        })
      }
      const bounds = result.geometry.reduce(
        (box, coord) => box.extend(coord as [number, number]),
        new maplibregl.LngLatBounds(result.geometry[0], result.geometry[0])
      )
      map?.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 800, pitch: mode === '3d' ? 55 : 0 })
    })

    return () => { cancelled = true }
  }, [pickup, dropoff, mode])

  if (mode === 'unsupported') {
    return (
      <div className="scene-fallback">
        <p>هذا الجهاز لا يدعم WebGL، لذلك عرض المباني ثلاثي الأبعاد غير متاح.</p>
        <p className="muted">حدد النقاط على الخريطة المسطحة في صفحة الطلب. لا نعرض موقعاً متحركاً وهمياً.</p>
      </div>
    )
  }

  return (
    <div className="delivery-scene">
      <div className="scene-toolbar">
        <button type="button" className={mode === '3d' ? 'scene-mode active' : 'scene-mode'} onClick={() => setMode('3d')}>عرض 3D</button>
        <button type="button" className={mode === '2d' ? 'scene-mode active' : 'scene-mode'} onClick={() => setMode('2d')}>عرض مسطح</button>
        <button
          type="button"
          className="scene-mode"
          disabled={previewing || !routeInfo}
          onClick={() => {
            const map = mapRef.current
            const coords = routeCoords.current
            if (!map || coords.length < 2) return
            if (previewTimer.current) window.clearTimeout(previewTimer.current)
            setPreviewing(true)
            const el = document.createElement('div')
            el.className = 'scene-vehicle'
            el.title = 'معاينة المركبة على المسار المخطط — ليست موقعاً مباشراً'
            el.innerHTML = '<span class="scene-vehicle-body"></span>'
            vehicleMarker.current?.remove()
            vehicleMarker.current = new maplibregl.Marker({ element: el, anchor: 'center' })
              .setLngLat(coords[0])
              .addTo(map)
            const step = Math.max(1, Math.ceil(coords.length / 24))
            const samples = coords.filter((_, index) => index % step === 0 || index === coords.length - 1)
            let i = 0
            const run = () => {
              const point = samples[i]
              const currentMap = mapRef.current
              if (!point || !currentMap) {
                setPreviewing(false)
                return
              }
              const next = samples[i + 1]
              const bearing = next
                ? Math.atan2(next[0] - point[0], next[1] - point[1]) * 180 / Math.PI
                : currentMap.getBearing()
              vehicleMarker.current?.setLngLat(point)
              currentMap.easeTo({ center: point, duration: 900, pitch: mode === '3d' ? 58 : 0, bearing, zoom: 16 })
              i += 1
              if (i < samples.length) {
                previewTimer.current = window.setTimeout(run, 920)
              } else {
                previewTimer.current = window.setTimeout(() => {
                  setPreviewing(false)
                  vehicleMarker.current?.remove()
                  vehicleMarker.current = null
                }, 900)
              }
            }
            run()
          }}
        >
          {previewing ? 'معاينة المسار…' : 'معاينة المسار المخطط'}
        </button>
        <span className="scene-status">{statusLabel}</span>
      </div>
      <div ref={containerRef} className="scene-canvas" />
      <div className="scene-meta">
        {routeInfo ? (
          <span>مسار قيادة فعلي · {formatDistance(routeInfo.distanceM)} · نحو {formatDuration(routeInfo.durationS)}</span>
        ) : (
          <span>{routeError || (ROUTING_ENABLED ? 'يُحسب مسار القيادة من بيانات الطريق المتاحة، وليس خطاً مستقيماً.' : 'حساب مسار القيادة غير مفعّل. لا نرسم خطاً تقديرياً.')}</span>
        )}
        {liveAvailable
          ? <span>الموقع المباشر للموصّل متاح.</span>
          : <span>الموقع المباشر غير متاح — لا نعرض حركة وهمية للمركبة.</span>}
        <span dangerouslySetInnerHTML={{ __html: MAP_ATTRIBUTION }} />
      </div>
      {mapError && <p className="field-error">{mapError}</p>}
    </div>
  )
}

import { useEffect, useState } from 'react'
import L from 'leaflet'
import { MapContainer, TileLayer, Marker, Circle, Polyline, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { ACTIVE_TILE_PROVIDER, MAP_CENTER, SERVICE_AREA, type LatLng } from '../lib/geo/config'

export type MapTarget = 'pickup' | 'dropoff'

type Props = {
  pickup: LatLng | null
  dropoff: LatLng | null
  active: MapTarget
  onPick: (point: LatLng, target: MapTarget) => void
  onTileError?: () => void
  variant?: 'card' | 'full'
  sheetPadding?: boolean
}

const pickupIcon = L.divIcon({
  className: 'ersel-marker',
  html: '<span class="ersel-pin pin-pickup"><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5Z"/></svg></span>',
  iconSize: [36, 44],
  iconAnchor: [18, 42]
})

const dropoffIcon = L.divIcon({
  className: 'ersel-marker',
  html: '<span class="ersel-pin pin-dropoff"><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5Z"/></svg></span>',
  iconSize: [36, 44],
  iconAnchor: [18, 42]
})

function ClickHandler({ onPick, active }: { onPick: Props['onPick']; active: MapTarget }) {
  useMapEvents({
    click(event) {
      onPick({ lat: event.latlng.lat, lng: event.latlng.lng }, active)
    }
  })
  return null
}

function FitPoints({
  pickup,
  dropoff,
  sheetPadding
}: {
  pickup: LatLng | null
  dropoff: LatLng | null
  sheetPadding: boolean
}) {
  const map = useMap()

  useEffect(() => {
    const bottom = sheetPadding ? 320 : 46
    if (pickup && dropoff) {
      map.fitBounds(
        L.latLngBounds([pickup.lat, pickup.lng], [dropoff.lat, dropoff.lng]),
        { paddingTopLeft: [36, 88], paddingBottomRight: [36, bottom], maxZoom: 16 }
      )
      return
    }
    if (pickup) map.setView([pickup.lat, pickup.lng], 16, { animate: true })
    else if (dropoff) map.setView([dropoff.lat, dropoff.lng], 16, { animate: true })
  }, [map, pickup, dropoff, sheetPadding])

  return null
}

function KeepSized() {
  const map = useMap()
  useEffect(() => {
    const container = map.getContainer()
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(container)
    const timer = setTimeout(() => map.invalidateSize(), 240)
    return () => {
      observer.disconnect()
      clearTimeout(timer)
    }
  }, [map])
  return null
}

export default function OrderMap({
  pickup,
  dropoff,
  active,
  onPick,
  onTileError,
  variant = 'card',
  sheetPadding = false
}: Props) {
  const [ready, setReady] = useState(false)

  return (
    <div className={variant === 'full' ? 'order-map order-map-full' : 'order-map'}>
      <MapContainer
        center={[MAP_CENTER.lat, MAP_CENTER.lng]}
        zoom={14}
        minZoom={11}
        maxZoom={18}
        scrollWheelZoom
        className="order-map-canvas"
        whenReady={() => setReady(true)}
      >
        <TileLayer
          url={ACTIVE_TILE_PROVIDER.url}
          attribution={ACTIVE_TILE_PROVIDER.attribution}
          maxZoom={ACTIVE_TILE_PROVIDER.maxZoom}
          eventHandlers={{ tileerror: () => onTileError?.() }}
        />
        <Circle
          center={[SERVICE_AREA.center.lat, SERVICE_AREA.center.lng]}
          radius={SERVICE_AREA.radiusM}
          pathOptions={{ color: '#1e5bb8', weight: 1.5, opacity: 0.55, fillColor: '#1e5bb8', fillOpacity: 0.06 }}
        />
        {pickup && dropoff && (
          <Polyline
            positions={[[pickup.lat, pickup.lng], [dropoff.lat, dropoff.lng]]}
            pathOptions={{ color: '#1e5bb8', weight: 3, opacity: 0.55, dashArray: '8 10' }}
          />
        )}
        <ClickHandler onPick={onPick} active={active} />
        <FitPoints pickup={pickup} dropoff={dropoff} sheetPadding={sheetPadding || variant === 'full'} />
        <KeepSized />
        {pickup && (
          <Marker
            position={[pickup.lat, pickup.lng]}
            icon={pickupIcon}
            draggable
            eventHandlers={{
              dragend(event) {
                const point = (event.target as L.Marker).getLatLng()
                onPick({ lat: point.lat, lng: point.lng }, 'pickup')
              }
            }}
          />
        )}
        {dropoff && (
          <Marker
            position={[dropoff.lat, dropoff.lng]}
            icon={dropoffIcon}
            draggable
            eventHandlers={{
              dragend(event) {
                const point = (event.target as L.Marker).getLatLng()
                onPick({ lat: point.lat, lng: point.lng }, 'dropoff')
              }
            }}
          />
        )}
      </MapContainer>
      {!ready && <div className="map-loading">جارٍ تحميل الخريطة…</div>}
      {variant !== 'full' && (
        <div className="map-hint">
          انقر على الخريطة لتحديد نقطة <b>{active === 'pickup' ? 'الانطلاق' : 'الوصول'}</b>، أو اسحب العلامة لتصحيحها.
        </div>
      )}
    </div>
  )
}

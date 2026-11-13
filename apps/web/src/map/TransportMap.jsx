import { useEffect, useMemo } from 'react'
import { CircleMarker, MapContainer, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { BATKEN_REGION } from '../data/mockData.js'
import { getGpsStatus } from '../models/gpsStatus.js'
import { useLocale } from '../localization/LocaleContext.jsx'

function FitEndpoints({ stops }) {
  const map = useMap()
  useEffect(() => {
    // Room for the marker rings; endpoint labels are placed towards the inside of the map (see below).
    if (stops?.length) map.fitBounds(stops.map((stop) => stop.position), { padding: [48, 48], maxZoom: 13, animate: false })
  }, [map, stops])
  return null
}

export default function TransportMap({ route, buses, selectedBusId, onSelectBus }) {
  const { t, localize } = useLocale()
  const markers = useMemo(() => buses.map((bus) => ({
    ...bus,
    gpsStatus: getGpsStatus(bus.lastUpdateAgeSeconds),
    // Direction of the bus itself (bus.directionId), never the direction chosen in the passenger switcher.
    direction: route?.directions.find((item) => item.id === bus.directionId) ?? null,
  })), [buses, route])
  const westLng = Math.min(...(route?.stops ?? []).map((stop) => stop.position[1]))

  return (
    <MapContainer center={BATKEN_REGION.center} zoom={11} className="transport-map" scrollWheelZoom aria-label={t('mapTitle')}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitEndpoints stops={route?.stops} />
      {route?.stops.map((stop) => {
        // The western endpoint gets its label to the right and the eastern one to the left, so a label always
        // extends towards the inside of the map and is never cut by the map edge.
        const isWest = stop.position[1] === westLng
        return (
          // Radius 20: the ring stays visible around a bus (radius <= 15) that is parked on the endpoint.
          <CircleMarker key={stop.id} center={stop.position} radius={20} pathOptions={{ color: route.color, fillColor: '#fff', fillOpacity: 1, weight: 4 }}>
            <Tooltip permanent direction={isWest ? 'right' : 'left'} offset={[isWest ? 26 : -26, 0]}>{localize(stop.name)}</Tooltip>
            <Popup><strong>{localize(stop.name)}</strong><br />{t('confirmedEndpoint')}</Popup>
          </CircleMarker>
        )
      })}
      {markers.map((bus) => {
        const selected = selectedBusId === bus.id
        const color = bus.gpsStatus === 'offline' ? '#56625e' : bus.gpsStatus === 'stale' ? '#983622' : route.color
        return (
          <CircleMarker
            key={bus.id}
            center={bus.position}
            radius={selected ? 15 : 12}
            pathOptions={{ color: '#fff', fillColor: color, fillOpacity: 1, weight: selected ? 5 : 4 }}
            eventHandlers={{ click: () => onSelectBus(bus.id) }}
          >
            <Tooltip direction="top" offset={[0, -16]}>{bus.publicId}</Tooltip>
            <Popup><strong>{bus.publicId}</strong><br />{t(bus.gpsStatus)} · {t('demoCoordinates')}<br />{bus.direction ? localize(bus.direction.name) : t('directionUnknown')}</Popup>
          </CircleMarker>
        )
      })}
    </MapContainer>
  )
}

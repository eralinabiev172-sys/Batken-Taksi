import { useEffect, useMemo, useState } from 'react'
import DemoBanner from '../components/DemoBanner.jsx'
import RouteSearch from '../components/RouteSearch.jsx'
import BusCard from '../components/BusCard.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import Icon from '../components/Icon.jsx'
import TransportMap from '../map/TransportMap.jsx'
import { useLocale } from '../localization/LocaleContext.jsx'
import { getGpsStatus } from '../models/gpsStatus.js'
import { transportService } from '../services/transportService.js'

export default function PassengerPage() {
  const { t, localize } = useLocale()
  const [routes, setRoutes] = useState([])
  const [buses, setBuses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [selectedRouteId, setSelectedRouteId] = useState('route-1')
  const [selectedDirectionId, setSelectedDirectionId] = useState('direction-school-to-batken')
  const [selectedBusId, setSelectedBusId] = useState(null)

  useEffect(() => {
    let active = true
    Promise.all([transportService.getRoutes(), transportService.getPublicVehicles('route-1')])
      .then(([routeData, busData]) => {
        if (!active) return
        setRoutes(routeData)
        setBuses(busData)
        setSelectedBusId(busData[0]?.id ?? null)
      })
      .catch(() => active && setError(t('mapError')))
      .finally(() => active && setLoading(false))
    const disconnect = transportService.connectLiveUpdates((vehicles) => {
      if (!active) return
      const publicRouteVehicles = vehicles.filter((bus) => bus.routeId === selectedRouteId)
      setBuses(publicRouteVehicles)
      setSelectedBusId((current) => publicRouteVehicles.some((bus) => bus.id === current) ? current : publicRouteVehicles[0]?.id ?? null)
    })
    return () => { active = false; disconnect() }
  }, [selectedRouteId, t])

  const route = routes.find((item) => item.id === selectedRouteId)
  const direction = route?.directions.find((item) => item.id === selectedDirectionId) ?? route?.directions[0]
  const routeBuses = useMemo(() => buses.filter((bus) => bus.routeId === selectedRouteId), [buses, selectedRouteId])
  const selectedBus = routeBuses.find((bus) => bus.id === selectedBusId)

  function selectRoute(routeId) {
    const nextRoute = routes.find((item) => item.id === routeId)
    setSelectedRouteId(routeId)
    setSelectedDirectionId(nextRoute?.directions[0]?.id ?? '')
    setSelectedBusId(buses.find((bus) => bus.routeId === routeId)?.id ?? null)
  }

  return (
    <div className="passenger-page">
      <section className="passenger-hero page-pad">
        <div>
          <span className="eyebrow"><span className="eyebrow__pulse" />{t('batkenRegion')}</span>
          <h1>{t('mapTitle')}</h1>
          <p>{t('mapSubtitle')}</p>
        </div>
        <DemoBanner />
      </section>

      <div className="passenger-workspace page-pad">
        <aside className="passenger-sidebar">
          <RouteSearch routes={routes} query={query} onQueryChange={setQuery} selectedRouteId={selectedRouteId} onSelect={selectRoute} />
          {route && (
            <section className="route-summary">
              <div className="route-summary__heading">
                <span className="route-number" style={{ '--route-color': route.color }}>{route.number}</span>
                <div><small>{t('route')}</small><strong>{localize(route.name)}</strong></div>
              </div>
              <div className="direction-switcher" role="group" aria-label={t('direction')}>
                {route.directions.map((item) => <button type="button" key={item.id} className={item.id === direction?.id ? 'active' : ''} aria-pressed={item.id === direction?.id} onClick={() => setSelectedDirectionId(item.id)}>{localize(item.name)}</button>)}
              </div>
              <p className="direction-note">{t('directionAllBusesNote')}</p>
              <div className="route-pending" role="status"><Icon name="warning" size={17} /><div><strong>{t('routePending')}</strong><span>{t('routePendingDetail')}</span></div></div>
              <p><Icon name="pin" size={17} />{route.stops.length} {t('confirmedEndpoints').toLowerCase()}</p>
            </section>
          )}
          <section className="bus-list" aria-labelledby="bus-list-title">
            <div className="section-title-row"><h2 id="bus-list-title">{t('publicBuses')}</h2><span>{routeBuses.length}/3</span></div>
            {routeBuses.map((bus) => {
              const busDirection = route?.directions.find((item) => item.id === bus.directionId)
              return <BusCard key={bus.id} bus={bus} route={route} direction={busDirection} selected={bus.id === selectedBusId} onClick={() => setSelectedBusId(bus.id)} />
            })}
            {!loading && !routeBuses.length && <div className="empty-state"><Icon name="bus" size={30} /><p>{t('noPublicBuses')}</p></div>}
          </section>
        </aside>

        <section className="map-panel" aria-label={t('mapTitle')}>
          <div className="map-panel__topbar">
            <div className="map-legend"><strong>{t('gpsLegend')}</strong>{['live', 'delayed', 'stale', 'offline'].map((status) => <StatusBadge key={status} status={status} />)}</div>
            <span className="map-source"><span className="demo-dot" />{t('demoCoordinates')}</span>
          </div>
          <div className="map-stage">
            {loading && <div className="map-state"><span className="spinner" /><p>{t('loadingMap')}</p></div>}
            {error && <div className="map-state map-state--error"><Icon name="warning" size={34} /><p>{error}</p></div>}
            {!loading && !error && route && <TransportMap route={route} buses={routeBuses} selectedBusId={selectedBusId} onSelectBus={setSelectedBusId} />}
          </div>
          {/* The selected-bus card lives below the map, never on top of it, so it cannot cover markers or labels. */}
          {selectedBus && route && (
            <div className="selected-bus-card">
              <BusCard bus={selectedBus} route={route} direction={route.directions.find((item) => item.id === selectedBus.directionId)} detailed />
              <div className="selected-bus-card__footer"><span><Icon name="signal" size={17} />{t('lastUpdate')}</span><strong>{t(getGpsStatus(selectedBus.lastUpdateAgeSeconds))}</strong></div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

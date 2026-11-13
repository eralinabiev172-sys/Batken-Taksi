import { useEffect, useMemo, useState } from 'react'
import DemoBanner from '../components/DemoBanner.jsx'
import Icon from '../components/Icon.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import { useLocale } from '../localization/LocaleContext.jsx'
import { formatAge, getGpsStatus } from '../models/gpsStatus.js'
import { formatRemaining, remainingSeconds } from '../models/publicVisibility.js'
import { transportService } from '../services/transportService.js'

export default function DriverPage() {
  const { t, locale, localize } = useLocale()
  const [loggedIn, setLoggedIn] = useState(false)
  const [dashboard, setDashboard] = useState(null)
  const [cutoffTime, setCutoffTime] = useState('20:00')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [clock, setClock] = useState(() => new Date())

  const visibilityActive = useMemo(() => dashboard?.visibility?.enabled && remainingSeconds(dashboard.visibility, clock) > 0, [dashboard, clock])
  const gpsStatus = dashboard ? getGpsStatus(dashboard.tracker.lastUpdateAgeSeconds) : 'offline'

  useEffect(() => {
    if (!visibilityActive) return undefined
    const timer = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(timer)
  }, [visibilityActive])

  useEffect(() => {
    if (dashboard?.visibility?.enabled && !visibilityActive) refreshDashboard()
  }, [visibilityActive]) // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshDashboard() {
    setDashboard(await transportService.getDriverDashboard())
  }

  async function handleLogin(event) {
    event.preventDefault()
    await transportService.loginDriver()
    await refreshDashboard()
    setLoggedIn(true)
  }

  async function enableVisibility() {
    setError('')
    try {
      await transportService.enablePublicVisibility({ driverId: dashboard.driver.id, busId: dashboard.bus.id, cutoffTime })
      await refreshDashboard()
      setClock(new Date())
      setNotice(t('demoVisibilityEnabled'))
    } catch (caught) {
      setError(t(caught.message === 'CUTOFF_MUST_BE_FUTURE' ? 'cutoffMustBeFuture' : 'visibilityActionError'))
    }
  }

  async function disableVisibility() {
    await transportService.disablePublicVisibility({ driverId: dashboard.driver.id, busId: dashboard.bus.id })
    await refreshDashboard()
    setNotice(t('demoVisibilityDisabled'))
  }

  async function changeTrip(state) {
    setDashboard(await transportService.setTripState({ driverId: dashboard.driver.id, state }))
    setNotice(t('tripDoesNotChangeVisibility'))
  }

  if (!loggedIn) {
    return (
      <div className="auth-page page-pad">
        <div className="auth-visual">
          <span className="eyebrow"><span className="eyebrow__pulse" />{t('demo')}</span>
          <h1>{t('driver')}</h1>
          <p>{t('phoneGpsDetail')}</p>
          <div className="hardware-note"><Icon name="signal" size={24} /><div><strong>{t('phoneGpsDisabled')}</strong><span>{t('phoneGpsDetail')}</span></div></div>
        </div>
        <form className="auth-card" onSubmit={handleLogin}>
          <DemoBanner />
          <div><span className="auth-card__icon"><Icon name="wheel" size={25} /></span><h2>{t('demoLogin')}</h2><p>{t('loginDescription')}</p></div>
          <label>{t('email')}<input name="login" defaultValue="demo-driver-1" autoComplete="username" required /></label>
          <label>{t('password')}<input name="password" type="password" defaultValue="demo" autoComplete="current-password" required /></label>
          <button className="primary-button" type="submit">{t('signIn')}<Icon name="chevron" size={18} /></button>
        </form>
      </div>
    )
  }

  if (!dashboard) return <div className="map-state"><span className="spinner" /></div>
  const { driver, bus, route, tracker, tripState } = dashboard
  const direction = route.directions.find((item) => item.id === bus.directionId)
  const tripLabel = tripState === 'active' ? t('tripActive') : tripState === 'completed' ? t('tripCompleted') : t('tripNotStarted')

  return (
    <div className="dashboard-page page-pad">
      <header className="dashboard-heading">
        <div><span className="eyebrow"><span className="eyebrow__pulse" />{t('demo')}</span><h1>{t('driver')}</h1><p>{driver.name}</p></div>
        <button type="button" className="ghost-button" onClick={() => setLoggedIn(false)}><Icon name="logout" size={18} />{t('signOut')}</button>
      </header>
      <DemoBanner />

      <div className="driver-grid">
        <section className="driver-assignment panel">
          <div className="panel-heading"><div><span className="panel-kicker">{t('assignedBus')}</span><h2>{bus.publicId}</h2></div><span className="large-route-number" style={{ '--route-color': route.color }}>{route.number}</span></div>
          <dl className="detail-list">
            <div><dt>{t('plate')}</dt><dd>{t('notSpecified')}</dd></div>
            <div><dt>{t('assignedRoute')}</dt><dd>{localize(route.name)}</dd></div>
            <div><dt>{t('direction')}</dt><dd>{localize(direction.name)}</dd></div>
          </dl>
          <div className="hardware-note hardware-note--green"><Icon name="signal" size={23} /><div><strong>{t('phoneGpsDisabled')}</strong><span>{t('phoneGpsDetail')}</span></div></div>
        </section>

        <section className="tracker-panel panel">
          <div className="panel-heading"><div><span className="panel-kicker">{t('trackerStatus')}</span><h2>{tracker.label}</h2></div><StatusBadge status={gpsStatus} /></div>
          <div className="tracker-signal"><span className={`signal-orbit signal-orbit--${gpsStatus}`}><Icon name="signal" size={32} /></span><div><strong>{t(`${gpsStatus}Hint`)}</strong><span>{t('lastUpdate')}: {formatAge(tracker.lastUpdateAgeSeconds, locale)}</span></div></div>
          {(gpsStatus === 'stale' || gpsStatus === 'offline') && <div className="alert alert--warning"><Icon name="warning" size={19} /><span>{t('staleWarning')}</span></div>}
        </section>

        <section className="visibility-panel panel">
          <div className="panel-heading"><div><span className="panel-kicker">{t('publicVisibility')}</span><h2>{visibilityActive ? t('visibilityOn') : t('visibilityOff')}</h2></div><span className={`trip-state ${visibilityActive ? 'trip-state--active' : ''}`}><span />{visibilityActive ? t('on') : t('off')}</span></div>
          <p className="panel-description">{t('visibilityDemoWarning')}</p>
          {!visibilityActive ? (
            <div className="visibility-controls">
              <label>{t('cutoffTime')}<input type="time" value={cutoffTime} onChange={(event) => setCutoffTime(event.target.value)} required /></label>
              <button type="button" className="primary-button" onClick={enableVisibility}><Icon name="signal" size={19} />{t('enableVisibility')}</button>
            </div>
          ) : (
            <div className="visibility-active">
              <div><strong>{formatRemaining(remainingSeconds(dashboard.visibility, clock), locale)}</strong><span>{t('cutoffAt')}: {new Intl.DateTimeFormat(locale === 'ky' ? 'ky-KG' : 'ru-RU', { timeZone: 'Asia/Bishkek', hour: '2-digit', minute: '2-digit' }).format(new Date(dashboard.visibility.expiresAt))}</span></div>
              <button type="button" className="danger-button" onClick={disableVisibility}>{t('disableVisibility')}</button>
            </div>
          )}
          {error && <div className="alert alert--warning" role="alert">{error}</div>}
          {notice && <p className="local-notice" role="status">{notice}</p>}
        </section>

        <section className="trip-control panel">
          <div className="panel-heading"><div><span className="panel-kicker">{t('tripControl')}</span><h2>{tripLabel}</h2></div><span className={`trip-state trip-state--${tripState}`}><span />{tripLabel}</span></div>
          <p className="panel-description">{t('tripVisibilityIndependent')}</p>
          <div className="trip-actions">
            <button type="button" className="primary-button" disabled={tripState === 'active'} onClick={() => changeTrip('active')}><Icon name="route" size={19} />{t('startTrip')}</button>
            <button type="button" className="danger-button" disabled={tripState !== 'active'} onClick={() => changeTrip('completed')}><Icon name="check" size={19} />{t('endTrip')}</button>
          </div>
        </section>

        <section className="stops-panel panel">
          <div className="panel-heading"><div><span className="panel-kicker">{t('route')} {route.number}</span><h2>{t('confirmedEndpoints')}</h2></div><span className="count-badge">2</span></div>
          <div className="route-pending"><Icon name="warning" size={17} /><div><strong>{t('routePending')}</strong><span>{t('noIntermediateStops')}</span></div></div>
          <ol className="stop-timeline">{route.stops.map((stop, index) => <li key={stop.id}><span>{index + 1}</span><strong>{localize(stop.name)}</strong></li>)}</ol>
        </section>
      </div>
    </div>
  )
}

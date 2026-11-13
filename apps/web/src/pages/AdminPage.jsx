import { useEffect, useMemo, useState } from 'react'
import DemoBanner from '../components/DemoBanner.jsx'
import Icon from '../components/Icon.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import AdminRecordDialog from '../components/AdminRecordDialog.jsx'
import { useLocale } from '../localization/LocaleContext.jsx'
import { formatAge, getGpsStatus } from '../models/gpsStatus.js'
import { isVisibilityActive } from '../models/publicVisibility.js'
import { transportService } from '../services/transportService.js'

export default function AdminPage() {
  const { t, locale, localize } = useLocale()
  const [tab, setTab] = useState('overview')
  const [snapshot, setSnapshot] = useState({ buses: [], drivers: [], routes: [], trackers: [], visibilityHistory: [] })
  const [dialog, setDialog] = useState(null)
  const [notice, setNotice] = useState('')

  async function refresh() {
    setSnapshot(await transportService.getAdminSnapshot())
  }

  useEffect(() => { refresh() }, [])

  const { buses, drivers, routes, trackers, visibilityHistory } = snapshot
  const activeTrips = buses.filter((bus) => bus.activeTrip)
  const onlineCount = trackers.filter((tracker) => getGpsStatus(tracker.lastUpdateAgeSeconds) !== 'offline').length
  const datasets = useMemo(() => ({ buses, drivers, routes, trackers }), [buses, drivers, routes, trackers])
  const tabs = [
    ['overview', 'overview', 'grid'], ['buses', 'fleet', 'bus'], ['drivers', 'drivers', 'users'],
    ['routes', 'routes', 'route'], ['trackers', 'trackers', 'signal'], ['history', 'visibilityHistory', 'clock'],
  ]

  async function saveRecord(data) {
    const { type, record } = dialog
    const id = record?.id ?? `${type.slice(0, -1)}-demo-${Date.now()}`
    const next = { ...(record ?? defaultRecord(type, id)), ...data }
    // Keep the existing { ru, ky } pair when the shown text was not changed; otherwise use the typed text for both languages.
    const keepOrReplace = (existing, typed) => (existing && localize(existing) === typed ? existing : { ru: typed, ky: typed })
    if (type === 'routes') next.name = keepOrReplace(record?.name, data.displayName)
    if (type === 'trackers') next.model = keepOrReplace(record?.model, data.model)
    delete next.displayName
    await transportService.saveAdminRecord(type, next)
    await refresh()
    setDialog(null)
    setNotice(t('savedLocally'))
  }

  async function assignDriver(event) {
    event.preventDefault()
    const data = Object.fromEntries(new FormData(event.currentTarget))
    await transportService.assignDriver(data.driverId, data.busId)
    await refresh()
    setNotice(t('savedLocally'))
  }

  async function assignTracker(event) {
    event.preventDefault()
    const data = Object.fromEntries(new FormData(event.currentTarget))
    await transportService.assignTracker(data.trackerId, data.busId)
    await refresh()
    setNotice(t('savedLocally'))
  }

  return (
    <div className="admin-page page-pad">
      <header className="dashboard-heading">
        <div><span className="eyebrow"><span className="eyebrow__pulse" />{t('demo')}</span><h1>{t('adminTitle')}</h1><p>{t('adminSubtitle')}</p></div>
      </header>
      <DemoBanner />
      <div className="admin-layout">
        <aside className="admin-tabs" aria-label={t('adminTitle')}>
          {tabs.map(([id, label, icon]) => <button type="button" key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon name={icon} size={19} />{t(label)}{id !== 'overview' && <span>{id === 'history' ? visibilityHistory.length : datasets[id]?.length}</span>}</button>)}
          <div className="admin-source"><small>{t('dataSource')}</small><strong><span />{t('localFixtures')}</strong></div>
        </aside>
        <div className="admin-content">
          {notice && <div className="local-notice local-notice--success" role="status"><Icon name="check" size={18} />{notice}</div>}
          {tab === 'overview' && <Overview t={t} buses={buses} routes={routes} drivers={drivers} trackers={trackers} activeTrips={activeTrips} onlineCount={onlineCount} locale={locale} localize={localize} />}
          {['buses', 'drivers', 'routes', 'trackers'].includes(tab) && <RecordsTable type={tab} records={datasets[tab]} buses={buses} routes={routes} t={t} locale={locale} localize={localize} onAdd={() => setDialog({ type: tab, record: null })} onEdit={(record) => setDialog({ type: tab, record })} />}
          {tab === 'history' && <VisibilityHistory records={visibilityHistory} buses={buses} t={t} locale={locale} />}
          {tab === 'overview' && <section className="assignment-grid"><AssignmentForm title={t('driverAssignment')} itemLabel={t('chooseDriver')} name="driverId" items={drivers} itemText={(item) => item.name} buses={buses} onSubmit={assignDriver} t={t} /><AssignmentForm title={t('trackerAssignment')} itemLabel={t('chooseTracker')} name="trackerId" items={trackers} itemText={(item) => item.label} buses={buses} onSubmit={assignTracker} t={t} /></section>}
        </div>
      </div>
      {dialog && <AdminRecordDialog open type={dialog.type} record={dialog.record} onClose={() => setDialog(null)} onSave={saveRecord} />}
    </div>
  )
}

function defaultRecord(type, id) {
  if (type === 'buses') return { id, publicId: id, routeId: 'route-1', plate: null, directionId: 'direction-school-to-batken', position: [39.94157, 70.93038], lastUpdateAgeSeconds: 90, speedKph: 0, activeTrip: false, isDemo: true }
  if (type === 'drivers') return { id, busId: null, status: 'offDuty', isDemo: true }
  if (type === 'routes') return { id, number: '1', color: '#176b4b', geometryStatus: 'pendingConfirmation', directions: [], stops: [], isDemo: true }
  return { id, busId: null, lastUpdateAgeSeconds: 90, status: 'enabled', isDemo: true }
}

function Overview({ t, buses, routes, drivers, trackers, activeTrips, onlineCount, locale, localize }) {
  const publicCount = buses.filter((bus) => isVisibilityActive(bus.visibility)).length
  const stats = [[t('totalBuses'), buses.length, 'bus'], [t('onlineTrackers'), `${onlineCount}/${trackers.length}`, 'signal'], [t('publicNow'), publicCount, 'map'], [t('activeDrivers'), drivers.filter((driver) => driver.status === 'onTrip').length, 'users']]
  return <><section className="stats-grid">{stats.map(([label, value, icon]) => <article key={label}><span><Icon name={icon} size={21} /></span><div><strong>{value}</strong><small>{label}</small></div></article>)}</section><section className="panel admin-live"><div className="panel-heading"><div><span className="panel-kicker">{t('adminServiceAccess')}</span><h2>{t('allBusLocations')}</h2></div><span className="count-badge">{buses.length}</span></div><BusVisibilityTable buses={buses} routes={routes} t={t} locale={locale} localize={localize} /></section><section className="panel admin-live admin-live--secondary"><div className="panel-heading"><div><span className="panel-kicker">{t('tripControl')}</span><h2>{t('activeTrips')}</h2></div><span className="count-badge">{activeTrips.length}</span></div><TripsTable buses={activeTrips} routes={routes} t={t} locale={locale} localize={localize} /></section></>
}

function BusVisibilityTable({ buses, routes, t, locale, localize }) {
  return <div className="table-wrap"><table><thead><tr><th>{t('bus')}</th><th>{t('routeAndDirection')}</th><th>{t('gpsState')}</th><th>{t('publicVisibility')}</th><th>{t('cutoffTime')}</th></tr></thead><tbody>{buses.map((bus) => { const route = routes.find((item) => item.id === bus.routeId); const direction = route?.directions.find((item) => item.id === bus.directionId); const active = isVisibilityActive(bus.visibility); return <tr key={bus.id}><td><strong>{bus.publicId}</strong><small>{t('serviceLocationAvailable')}</small></td><td><span className="mini-route" style={{ '--route-color': route?.color }}>{route?.number}</span>{localize(direction?.name)}</td><td><StatusBadge status={getGpsStatus(bus.lastUpdateAgeSeconds)} /><small>{formatAge(bus.lastUpdateAgeSeconds, locale)}</small></td><td><span className={`text-status ${active ? '' : 'text-status--off'}`}>{active ? t('visibilityOn') : t('visibilityOff')}</span></td><td>{bus.visibility?.expiresAt ? formatDate(bus.visibility.expiresAt, locale) : '—'}</td></tr> })}</tbody></table></div>
}

function RecordsTable({ type, records, buses, routes, t, locale, localize, onAdd, onEdit }) {
  if (type === 'trackers') return <TrackerTable records={records} buses={buses} t={t} locale={locale} localize={localize} onAdd={onAdd} onEdit={onEdit} />
  return <section className="panel records-panel"><TableHeading title={t(type === 'buses' ? 'fleet' : type)} t={t} onAdd={onAdd} /><div className="table-wrap"><table><thead><tr><th>{t(type === 'drivers' ? 'fullName' : type === 'routes' ? 'route' : 'identifier')}</th><th>{type === 'routes' ? t('direction') : t('assignment')}</th><th>{t('status')}</th><th><span className="sr-only">{t('actions')}</span></th></tr></thead><tbody>{records.map((record) => { const status = type === 'buses' ? getGpsStatus(record.lastUpdateAgeSeconds) : record.status ?? 'ready'; return <tr key={record.id}><td><strong>{recordLabel(type, record, localize)}</strong><small>{type === 'buses' ? t('notSpecified') : type === 'drivers' ? t('noPersonalData') : `№ ${record.number}`}</small></td><td>{assignmentLabel(type, record, buses, routes, localize)}</td><td>{['live','delayed','stale','offline'].includes(status) ? <StatusBadge status={status} /> : <span className="text-status">{t(status)}</span>}</td><td><button type="button" className="table-action" onClick={() => onEdit(record)}><Icon name="edit" size={16} />{t('edit')}</button></td></tr> })}</tbody></table></div></section>
}

function TrackerTable({ records, buses, t, locale, localize, onAdd, onEdit }) {
  return <section className="panel records-panel"><TableHeading title={t('trackers')} t={t} onAdd={onAdd} /><div className="table-wrap"><table><thead><tr><th>{t('identifier')}</th><th>{t('model')}</th><th>{t('assignment')}</th><th>{t('gpsState')}</th><th><span className="sr-only">{t('actions')}</span></th></tr></thead><tbody>{records.map((tracker) => <tr key={tracker.id}><td><strong>{tracker.label}</strong><small>{formatAge(tracker.lastUpdateAgeSeconds, locale)}</small></td><td>{localize(tracker.model)}</td><td>{assignmentLabel('trackers', tracker, buses, [], localize)}</td><td><StatusBadge status={getGpsStatus(tracker.lastUpdateAgeSeconds)} /></td><td><button type="button" className="table-action" onClick={() => onEdit(tracker)}><Icon name="edit" size={16} />{t('edit')}</button></td></tr>)}</tbody></table></div></section>
}

function TableHeading({ title, t, onAdd }) {
  return <div className="panel-heading"><div><span className="panel-kicker">{t('demo')}</span><h2>{title}</h2></div><button type="button" className="primary-button primary-button--small" onClick={onAdd}><Icon name="plus" size={17} />{t('addRecord')}</button></div>
}

function recordLabel(type, record, localize) {
  if (type === 'buses') return record.publicId
  if (type === 'drivers') return record.name
  if (type === 'routes') return `${record.number} · ${localize(record.name)}`
  return record.label
}

function assignmentLabel(type, record, buses, routes, localize) {
  if (type === 'routes') return record.directions?.map((direction) => localize(direction.name)).join(' / ') || '—'
  if (type === 'buses') return localize(routes.find((route) => route.id === record.routeId)?.name) || '—'
  const bus = buses.find((item) => item.id === record.busId)
  return bus?.publicId ?? '—'
}

function TripsTable({ buses, routes, t, locale, localize }) {
  return <div className="table-wrap"><table><thead><tr><th>{t('bus')}</th><th>{t('route')}</th><th>{t('lastUpdate')}</th><th>{t('status')}</th></tr></thead><tbody>{buses.map((bus) => { const route = routes.find((item) => item.id === bus.routeId); return <tr key={bus.id}><td><strong>{bus.publicId}</strong></td><td><span className="mini-route" style={{ '--route-color': route?.color }}>{route?.number}</span>{localize(route?.name)}</td><td>{formatAge(bus.lastUpdateAgeSeconds, locale)}</td><td><StatusBadge status={getGpsStatus(bus.lastUpdateAgeSeconds)} /></td></tr> })}</tbody></table>{!buses.length && <div className="empty-state">{t('noData')}</div>}</div>
}

function VisibilityHistory({ records, buses, t, locale }) {
  return <section className="panel records-panel"><div className="panel-heading"><div><span className="panel-kicker">{t('demo')}</span><h2>{t('visibilityHistory')}</h2></div><span className="count-badge">{records.length}</span></div><div className="table-wrap"><table><thead><tr><th>{t('bus')}</th><th>{t('action')}</th><th>{t('time')}</th><th>{t('cutoffTime')}</th></tr></thead><tbody>{records.map((record, index) => <tr key={`${record.at}-${index}`}><td>{buses.find((bus) => bus.id === record.busId)?.publicId ?? record.busId}</td><td><span className="text-status">{t(record.action === 'enabled' ? 'enabledAction' : record.action === 'disabled' ? 'disabled' : 'expired')}</span></td><td>{formatDate(record.at, locale)}</td><td>{record.expiresAt ? formatDate(record.expiresAt, locale) : '—'}</td></tr>)}</tbody></table>{!records.length && <div className="empty-state">{t('noVisibilityHistory')}</div>}</div></section>
}

function AssignmentForm({ title, itemLabel, name, items, itemText, buses, onSubmit, t }) {
  return <form className="panel assignment-form" onSubmit={onSubmit}><div className="panel-heading"><div><span className="panel-kicker">{t('demo')}</span><h2>{title}</h2></div><Icon name="route" size={22} /></div><label>{itemLabel}<select name={name} required defaultValue=""><option value="" disabled>—</option>{items.map((item) => <option key={item.id} value={item.id}>{itemText(item)}</option>)}</select></label><label>{t('chooseBus')}<select name="busId" required defaultValue=""><option value="" disabled>—</option>{buses.map((bus) => <option key={bus.id} value={bus.id}>{bus.publicId}</option>)}</select></label><button className="secondary-button" type="submit">{t('applyAssignment')}</button></form>
}

function formatDate(value, locale) {
  return new Intl.DateTimeFormat(locale === 'ky' ? 'ky-KG' : 'ru-RU', { timeZone: 'Asia/Bishkek', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

import { BATKEN_REGION, buses as fixturesBuses, driverDemo, drivers as fixturesDrivers, routes as fixturesRoutes, trackers as fixturesTrackers } from '../data/mockData.js'
import { bishkekCutoffToIso, endOfCurrentBishkekDay, isVisibilityActive } from '../models/publicVisibility.js'

const clone = (value) => structuredClone(value)

export function createDemoTransportService({ now = () => new Date() } = {}) {
  let buses = clone(fixturesBuses)
  let drivers = clone(fixturesDrivers)
  let routes = clone(fixturesRoutes)
  let trackers = clone(fixturesTrackers)
  const listeners = new Set()
  const timers = new Map()
  const visibility = {
    'demo-bus-1': { busId: 'demo-bus-1', driverId: 'demo-driver-1', enabled: false, expiresAt: null, disabledReason: 'notEnabled' },
    'demo-bus-2': { busId: 'demo-bus-2', driverId: 'demo-driver-2', enabled: true, enabledAt: now().toISOString(), expiresAt: endOfCurrentBishkekDay(now()), disabledReason: null, source: 'demoFixture' },
    'demo-bus-3': { busId: 'demo-bus-3', driverId: 'demo-driver-3', enabled: false, expiresAt: null, disabledReason: 'notEnabled' },
  }
  const tripStates = { 'demo-driver-1': 'idle', 'demo-driver-2': 'active', 'demo-driver-3': 'idle' }
  const visibilityHistory = []

  function expireDueGrants() {
    let changed = false
    Object.values(visibility).forEach((grant) => {
      if (grant.enabled && !isVisibilityActive(grant, now())) {
        grant.enabled = false
        grant.disabledAt = now().toISOString()
        grant.disabledReason = 'expired'
        visibilityHistory.unshift({ ...clone(grant), action: 'expired', at: grant.disabledAt })
        changed = true
      }
    })
    return changed
  }

  function publicVehicles(routeId) {
    expireDueGrants()
    return buses.filter((bus) => (!routeId || bus.routeId === routeId) && isVisibilityActive(visibility[bus.id], now()))
      .map((bus) => ({ ...bus, visibility: clone(visibility[bus.id]) }))
  }

  function notify() {
    const snapshot = clone(publicVehicles())
    listeners.forEach((listener) => listener(snapshot))
  }

  function scheduleExpiry(busId) {
    clearTimeout(timers.get(busId))
    const grant = visibility[busId]
    if (!isVisibilityActive(grant, now())) return
    const delay = Math.min(new Date(grant.expiresAt).getTime() - now().getTime(), 2_147_000_000)
    const timer = setTimeout(() => {
      expireDueGrants()
      notify()
    }, delay)
    timer.unref?.()
    timers.set(busId, timer)
  }

  function assignmentFor(driverId) {
    const driver = drivers.find((item) => item.id === driverId)
    if (!driver) throw new Error('DRIVER_NOT_FOUND')
    const bus = buses.find((item) => item.id === driver.busId)
    if (!bus) throw new Error('BUS_NOT_ASSIGNED')
    return { driver, bus }
  }

  return {
    mode: 'demo',
    region: clone(BATKEN_REGION),
    async getRoutes() { return clone(routes) },
    async getLiveVehicles(routeId) { return clone(publicVehicles(routeId)) },
    async getPublicVehicles(routeId) { return clone(publicVehicles(routeId)) },
    async loginDriver() { return { driverId: driverDemo.id, mode: 'demo' } },
    async getDriverDashboard(driverId = driverDemo.id) {
      const { driver, bus } = assignmentFor(driverId)
      return clone({
        driver, bus,
        route: routes.find((item) => item.id === bus.routeId),
        tracker: trackers.find((item) => item.busId === bus.id),
        visibility: visibility[bus.id],
        tripState: tripStates[driverId],
      })
    },
    async enablePublicVisibility({ driverId = driverDemo.id, busId, cutoffTime }) {
      const assignment = assignmentFor(driverId)
      if (busId && assignment.bus.id !== busId) throw new Error('FORBIDDEN_BUS')
      const expiresAt = bishkekCutoffToIso(cutoffTime, now())
      const grant = { busId: assignment.bus.id, driverId, enabled: true, enabledAt: now().toISOString(), expiresAt, disabledAt: null, disabledReason: null, source: 'demoAction' }
      visibility[assignment.bus.id] = grant
      visibilityHistory.unshift({ ...clone(grant), action: 'enabled', at: grant.enabledAt })
      scheduleExpiry(assignment.bus.id)
      notify()
      return clone(grant)
    },
    async disablePublicVisibility({ driverId = driverDemo.id, busId, reason = 'manual' }) {
      const assignment = assignmentFor(driverId)
      if (busId && assignment.bus.id !== busId) throw new Error('FORBIDDEN_BUS')
      const grant = visibility[assignment.bus.id]
      grant.enabled = false
      grant.disabledAt = now().toISOString()
      grant.disabledReason = reason
      clearTimeout(timers.get(assignment.bus.id))
      visibilityHistory.unshift({ ...clone(grant), action: reason === 'expired' ? 'expired' : 'disabled', at: grant.disabledAt })
      notify()
      return clone(grant)
    },
    async setTripState({ driverId = driverDemo.id, state }) {
      assignmentFor(driverId)
      tripStates[driverId] = state
      return this.getDriverDashboard(driverId)
    },
    async getAdminSnapshot() {
      expireDueGrants()
      return clone({ buses: buses.map((bus) => ({ ...bus, visibility: visibility[bus.id] })), drivers, routes, trackers, visibilityHistory })
    },
    async saveAdminRecord(type, record) {
      const collections = { buses, drivers, routes, trackers }
      const collection = collections[type]
      if (!collection) throw new Error('UNKNOWN_RECORD_TYPE')
      const index = collection.findIndex((item) => item.id === record.id)
      if (index >= 0) collection[index] = clone(record)
      else collection.push(clone(record))
      return this.getAdminSnapshot()
    },
    async assignDriver(driverId, busId) {
      drivers = drivers.map((driver) => driver.id === driverId ? { ...driver, busId, status: 'ready' } : driver)
      return this.getAdminSnapshot()
    },
    async assignTracker(trackerId, busId) {
      trackers = trackers.map((tracker) => tracker.id === trackerId ? { ...tracker, busId } : tracker)
      return this.getAdminSnapshot()
    },
    async simulateGpsUpdate(busId, patch) {
      buses = buses.map((bus) => bus.id === busId ? { ...bus, ...clone(patch) } : bus)
      notify()
      return clone(publicVehicles())
    },
    connectLiveUpdates(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    destroy() {
      timers.forEach(clearTimeout)
      timers.clear()
      listeners.clear()
    },
  }
}

export const transportService = createDemoTransportService()

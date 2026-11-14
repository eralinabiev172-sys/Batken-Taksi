import { BATKEN_REGION } from '../data/mockData.js'

// Passenger-map service backed by the real BusWay API (REST snapshot + WebSocket live feed).
// Only the PUBLIC map methods are real. Driver/admin screens still use the demo service until the
// authenticated flows are connected; their data is not mixed with real GPS.
// Opt-in: VITE_USE_REAL_API=true. The demo service stays the default (tests, offline demo).

const label = (publicId) => `№ ${String(publicId).replace(/^[a-z]+_/, '').slice(0, 4).toUpperCase()}`

function defaultApiBase() {
  return (import.meta.env?.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')
}

function defaultWsUrl() {
  if (import.meta.env?.VITE_WS_URL) return import.meta.env.VITE_WS_URL
  const scheme = globalThis.location?.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${globalThis.location?.host}/ws/v1/live`
}

export function createRealTransportService({
  demo,
  fetchImpl = (...args) => globalThis.fetch(...args),
  WebSocketImpl = globalThis.WebSocket,
  apiBase = defaultApiBase(),
  wsUrl = defaultWsUrl,
  now = () => Date.now(),
  tickMs = 5000,
  reconnectMs = { min: 1000, max: 10000 },
} = {}) {
  let routesCache = null

  async function getJson(path) {
    const res = await fetchImpl(`${apiBase}${path}`, { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP_${res.status}`)
    return res.json()
  }

  // A vehicle's route comes from its active trip when there is one; otherwise it belongs to the
  // region's only route (D-125). The age keeps growing locally between server messages.
  function toBus(entry) {
    const { vehicle: v, receivedAt } = entry
    const routeId = v.routeId ?? routesCache?.[0]?.id ?? null
    return {
      id: v.vehiclePublicId,
      publicId: label(v.vehiclePublicId),
      routeId,
      directionId: v.directionId ?? null,
      plate: null,
      position: [v.latitude, v.longitude],
      lastUpdateAgeSeconds: v.ageSeconds + Math.max(0, (now() - receivedAt) / 1000),
      speedKph: Math.round((v.speedMps ?? 0) * 3.6),
      activeTrip: v.routeId != null,
      isDemo: false,
    }
  }

  const toBuses = (entries) => [...entries.values()].map(toBus)

  return {
    ...demo,
    mode: 'real',
    region: structuredClone(BATKEN_REGION),

    async getRoutes() {
      const { routes } = await getJson('/routes')
      routesCache = routes
      return structuredClone(routes)
    },

    async getPublicVehicles(routeId) {
      if (!routesCache) await this.getRoutes()
      const { vehicles } = await getJson('/vehicles/live')
      const at = now()
      const entries = new Map(vehicles.map((v) => [v.vehiclePublicId, { vehicle: v, receivedAt: at }]))
      return toBuses(entries).filter((bus) => !routeId || bus.routeId === routeId)
    },

    async getLiveVehicles(routeId) { return this.getPublicVehicles(routeId) },

    /** Live feed: snapshot on every (re)connect, then vehicle.position / vehicle.removed. */
    connectLiveUpdates(listener) {
      const entries = new Map()
      let socket = null
      let stopped = false
      let attempt = 0
      let retryTimer = null
      const emit = () => listener(toBuses(entries))
      const ticker = setInterval(emit, tickMs)

      function onMessage(event) {
        let message
        try { message = JSON.parse(event.data) } catch { return }
        const at = now()
        if (message.type === 'snapshot' && Array.isArray(message.vehicles)) {
          entries.clear()
          for (const v of message.vehicles) entries.set(v.vehiclePublicId, { vehicle: v, receivedAt: at })
        } else if (message.type === 'vehicle.position' && message.vehicle) {
          entries.set(message.vehicle.vehiclePublicId, { vehicle: message.vehicle, receivedAt: at })
        } else if (message.type === 'vehicle.removed') {
          entries.delete(message.vehiclePublicId)
        } else {
          return
        }
        emit()
      }

      function open() {
        if (stopped) return
        const url = typeof wsUrl === 'function' ? wsUrl() : wsUrl
        socket = new WebSocketImpl(url)
        socket.onopen = () => { attempt = 0 }
        socket.onmessage = onMessage
        socket.onerror = () => { try { socket.close() } catch { /* already closed */ } }
        socket.onclose = () => {
          if (stopped) return
          const delay = Math.min(reconnectMs.max, reconnectMs.min * 2 ** attempt)
          attempt += 1
          retryTimer = setTimeout(open, delay)
        }
      }
      open()

      return () => {
        stopped = true
        clearTimeout(retryTimer)
        clearInterval(ticker)
        try { socket?.close() } catch { /* already closed */ }
      }
    },
  }
}

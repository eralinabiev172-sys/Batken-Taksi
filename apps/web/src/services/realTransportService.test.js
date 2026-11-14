import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRealTransportService } from './realTransportService.js'

const demo = { destroy: vi.fn(), marker: 'demo-method' }
const route = { id: 'route_AAAA', number: '1', color: '#176b4b', name: { ru: 'Р', ky: 'Р' }, stops: [], directions: [] }
const vehicle = (overrides = {}) => ({
  vehiclePublicId: 'bus_Ab3dEfGhIjKlMnOpQrStUv', latitude: 40.001, longitude: 70.002, measuredAt: '2026-11-14T10:00:00Z',
  ageSeconds: 4, freshness: 'live', speedMps: 10, headingDeg: 90, routeId: null, directionId: null, ...overrides,
})

class FakeSocket {
  static instances = []
  constructor(url) { this.url = url; this.closed = false; FakeSocket.instances.push(this) }
  close() { this.closed = true; this.onclose?.() }
  push(message) { this.onmessage?.({ data: typeof message === 'string' ? message : JSON.stringify(message) }) }
}

function fetchReturning(map) {
  return vi.fn(async (url) => {
    const key = Object.keys(map).find((k) => url.endsWith(k))
    const entry = map[key]
    if (!entry) return { ok: false, status: 404, json: async () => ({}) }
    return entry.ok === false ? { ok: false, status: entry.status, json: async () => ({}) } : { ok: true, status: 200, json: async () => entry }
  })
}

let clock
const make = (extra = {}) => createRealTransportService({
  demo, apiBase: '/api/v1', wsUrl: 'ws://test/ws/v1/live', WebSocketImpl: FakeSocket, now: () => clock, tickMs: 5000,
  reconnectMs: { min: 1000, max: 4000 }, ...extra,
})

beforeEach(() => { vi.useFakeTimers(); clock = 1_000_000; FakeSocket.instances = [] })
afterEach(() => { vi.useRealTimers() })

describe('real transport service: REST', () => {
  it('is marked real and keeps non-public (driver/admin) methods from the demo service', () => {
    const service = make({ fetchImpl: fetchReturning({}) })
    expect(service.mode).toBe('real')
    expect(service.marker).toBe('demo-method')
  })

  it('loads routes from /routes', async () => {
    const fetchImpl = fetchReturning({ '/routes': { routes: [route] } })
    const routes = await make({ fetchImpl }).getRoutes()
    expect(routes).toEqual([route])
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/v1/routes')
  })

  it('maps a public vehicle to the shape the map expects, using the only route when no trip is active', async () => {
    const service = make({ fetchImpl: fetchReturning({ '/routes': { routes: [route] }, '/vehicles/live': { vehicles: [vehicle()] } }) })
    const [bus] = await service.getPublicVehicles()
    expect(bus).toMatchObject({ id: 'bus_Ab3dEfGhIjKlMnOpQrStUv', routeId: 'route_AAAA', position: [40.001, 70.002], speedKph: 36, isDemo: false, activeTrip: false })
    expect(bus.publicId).toBe('№ AB3D')
    expect(bus.lastUpdateAgeSeconds).toBe(4)
  })

  it('uses the trip route when present and filters by the requested route', async () => {
    const service = make({ fetchImpl: fetchReturning({ '/routes': { routes: [route] }, '/vehicles/live': { vehicles: [vehicle({ routeId: 'route_OTHER', directionId: 'dir_1' }), vehicle({ vehiclePublicId: 'bus_second', routeId: null })] } }) })
    expect(await service.getPublicVehicles('route_OTHER')).toHaveLength(1)
    expect((await service.getPublicVehicles('route_AAAA')).map((b) => b.id)).toEqual(['bus_second'])
  })

  it('rejects when the API fails, so the page can show its error state', async () => {
    const service = make({ fetchImpl: fetchReturning({ '/routes': { routes: [route] }, '/vehicles/live': { ok: false, status: 503 } }) })
    await expect(service.getPublicVehicles()).rejects.toThrow('HTTP_503')
  })

  it('never exposes anything beyond the public fields', async () => {
    const service = make({ fetchImpl: fetchReturning({ '/routes': { routes: [route] }, '/vehicles/live': { vehicles: [vehicle()] } }) })
    const [bus] = await service.getPublicVehicles()
    expect(Object.keys(bus).sort()).toEqual(['activeTrip', 'directionId', 'id', 'isDemo', 'lastUpdateAgeSeconds', 'plate', 'position', 'publicId', 'routeId', 'speedKph'])
  })
})

describe('real transport service: live WebSocket feed', () => {
  function connect() {
    const service = make({ fetchImpl: fetchReturning({ '/routes': { routes: [route] } }) })
    const listener = vi.fn()
    const disconnect = service.connectLiveUpdates(listener)
    return { listener, disconnect, socket: () => FakeSocket.instances.at(-1) }
  }
  const last = (listener) => listener.mock.calls.at(-1)[0]

  it('replaces everything with each snapshot, upserts positions and drops removed vehicles', () => {
    const { listener, socket } = connect()
    expect(socket().url).toBe('ws://test/ws/v1/live')
    socket().push({ type: 'snapshot', vehicles: [vehicle({ vehiclePublicId: 'bus_a' }), vehicle({ vehiclePublicId: 'bus_b' })] })
    expect(last(listener).map((b) => b.id).sort()).toEqual(['bus_a', 'bus_b'])
    socket().push({ type: 'vehicle.position', vehicle: vehicle({ vehiclePublicId: 'bus_a', latitude: 40.5 }) })
    expect(last(listener).find((b) => b.id === 'bus_a').position[0]).toBe(40.5)
    socket().push({ type: 'vehicle.removed', vehiclePublicId: 'bus_a' })
    expect(last(listener).map((b) => b.id)).toEqual(['bus_b'])
    socket().push({ type: 'snapshot', vehicles: [] })
    expect(last(listener)).toEqual([])
  })

  it('ignores malformed and unknown messages', () => {
    const { listener, socket } = connect()
    socket().push('not json')
    socket().push({ type: 'pong' })
    socket().push({ type: 'vehicle.position' })
    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps ageing a vehicle between messages, so an old fix degrades to stale/offline', () => {
    const { listener, socket } = connect()
    socket().push({ type: 'snapshot', vehicles: [vehicle({ vehiclePublicId: 'bus_a', ageSeconds: 2 })] })
    expect(last(listener)[0].lastUpdateAgeSeconds).toBe(2)
    clock += 70_000
    vi.advanceTimersByTime(5000)
    expect(last(listener)[0].lastUpdateAgeSeconds).toBeCloseTo(72, 0)
  })

  it('reconnects with backoff and a fresh snapshot removes a bus hidden while disconnected', () => {
    const { listener, socket } = connect()
    socket().push({ type: 'snapshot', vehicles: [vehicle({ vehiclePublicId: 'bus_a' })] })
    socket().onclose()
    expect(FakeSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(999)
    expect(FakeSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.instances).toHaveLength(2)
    socket().onclose()
    vi.advanceTimersByTime(1999)
    expect(FakeSocket.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.instances).toHaveLength(3)
    socket().push({ type: 'snapshot', vehicles: [] })
    expect(last(listener)).toEqual([])
  })

  it('stops reconnecting and ticking after disconnect', () => {
    const { listener, disconnect, socket } = connect()
    socket().push({ type: 'snapshot', vehicles: [vehicle()] })
    const calls = listener.mock.calls.length
    disconnect()
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances).toHaveLength(1)
    expect(listener.mock.calls.length).toBe(calls)
  })
})

import { describe, expect, it } from 'vitest'
import { createDemoTransportService } from './transportService.js'

describe('demo transport visibility service', () => {
  it('supports manual enable/disable without coupling it to trip state', async () => {
    let current = new Date('2026-11-13T02:00:00.000Z')
    const service = createDemoTransportService({ now: () => current })
    await service.enablePublicVisibility({ driverId: 'demo-driver-1', busId: 'demo-bus-1', cutoffTime: '20:00' })
    expect((await service.getPublicVehicles()).map((bus) => bus.id)).toContain('demo-bus-1')
    await service.setTripState({ driverId: 'demo-driver-1', state: 'completed' })
    expect((await service.getPublicVehicles()).map((bus) => bus.id)).toContain('demo-bus-1')
    await service.disablePublicVisibility({ driverId: 'demo-driver-1', busId: 'demo-bus-1' })
    expect((await service.getPublicVehicles()).map((bus) => bus.id)).not.toContain('demo-bus-1')
    expect((await service.getAdminSnapshot()).buses.find((bus) => bus.id === 'demo-bus-1')).toBeDefined()
    service.destroy()
  })

  it('expires a grant and delayed GPS cannot republish it', async () => {
    let current = new Date('2026-11-13T02:00:00.000Z')
    const service = createDemoTransportService({ now: () => current })
    await service.enablePublicVisibility({ driverId: 'demo-driver-1', cutoffTime: '08:01' })
    current = new Date('2026-11-13T02:01:00.000Z')
    expect((await service.getPublicVehicles()).map((bus) => bus.id)).not.toContain('demo-bus-1')
    await service.simulateGpsUpdate('demo-bus-1', { lastUpdateAgeSeconds: 0, position: [40, 70.9] })
    expect((await service.getPublicVehicles()).map((bus) => bus.id)).not.toContain('demo-bus-1')
    expect((await service.getAdminSnapshot()).visibilityHistory[0].action).toBe('expired')
    service.destroy()
  })

  it('keeps the bus public on arrival at the terminal, while standing, and on the return trip', async () => {
    const now = () => new Date('2026-11-13T02:00:00.000Z')
    const service = createDemoTransportService({ now })
    const ids = async () => (await service.getPublicVehicles('route-1')).map((bus) => bus.id)
    await service.enablePublicVisibility({ driverId: 'demo-driver-1', cutoffTime: '20:00' })
    // arrival at the Batken bus station: position equals the terminal, speed 0, trip completed
    await service.simulateGpsUpdate('demo-bus-1', { position: [40.057595, 70.825903], speedKph: 0, lastUpdateAgeSeconds: 1, directionId: 'direction-school-to-batken' })
    await service.setTripState({ driverId: 'demo-driver-1', state: 'completed' })
    expect(await ids()).toContain('demo-bus-1')
    expect((await service.getPublicVehicles('route-1')).find((bus) => bus.id === 'demo-bus-1').position).toEqual([40.057595, 70.825903])
    // standing for a while, then the return trip (new direction, moving)
    await service.simulateGpsUpdate('demo-bus-1', { speedKph: 0, lastUpdateAgeSeconds: 2 })
    expect(await ids()).toContain('demo-bus-1')
    await service.simulateGpsUpdate('demo-bus-1', { position: [40.03, 70.85], speedKph: 48, lastUpdateAgeSeconds: 1, directionId: 'direction-batken-to-school' })
    await service.setTripState({ driverId: 'demo-driver-1', state: 'active' })
    const moving = (await service.getPublicVehicles('route-1')).find((bus) => bus.id === 'demo-bus-1')
    expect(moving).toMatchObject({ directionId: 'direction-batken-to-school', speedKph: 48 })
    // the grant itself was never changed by any of this
    expect((await service.getDriverDashboard('demo-driver-1')).visibility).toMatchObject({ enabled: true, disabledReason: null })
    expect((await service.getAdminSnapshot()).visibilityHistory.map((row) => row.action)).toEqual(['enabled'])
    service.destroy()
  })

  it('rejects control of another driver bus', async () => {
    const now = () => new Date('2026-11-13T02:00:00.000Z')
    const service = createDemoTransportService({ now })
    await expect(service.enablePublicVisibility({ driverId: 'demo-driver-1', busId: 'demo-bus-2', cutoffTime: '20:00' })).rejects.toThrow('FORBIDDEN_BUS')
    await expect(service.disablePublicVisibility({ driverId: 'demo-driver-1', busId: 'demo-bus-2' })).rejects.toThrow('FORBIDDEN_BUS')
    // the rejected attempts must not have touched the other driver's grant
    expect((await service.getPublicVehicles()).map((bus) => bus.id)).toContain('demo-bus-2')
    service.destroy()
  })

  // LIMITATION (Stage 2): this adapter keeps everything in memory, so a new instance simply starts from the
  // documented fixture. It does NOT prove that a server restores an unexpired grant or refuses an expired
  // one — that is Stage 3 backend behaviour (D-129) and is not tested here.
  it('local demo only: a fresh in-memory instance does not inherit grants of a previous instance', async () => {
    const now = () => new Date('2026-11-13T02:00:00.000Z')
    const first = createDemoTransportService({ now })
    await first.enablePublicVisibility({ driverId: 'demo-driver-1', cutoffTime: '20:00' })
    const fresh = createDemoTransportService({ now })
    expect((await fresh.getDriverDashboard('demo-driver-1')).visibility.enabled).toBe(false)
    expect((await fresh.getPublicVehicles()).map((bus) => bus.id)).toEqual(['demo-bus-2']) // fixture only
    first.destroy()
    fresh.destroy()
  })
})

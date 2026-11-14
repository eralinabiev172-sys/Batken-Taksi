import { describe, expect, it } from 'vitest'
import { traccarPositionToBusway, traccarPayloadToBusway } from '../../src/lib/traccar-adapter.js'

const sample = {
  id: 12345, deviceId: 7, type: 'position', protocol: 'teltonika',
  serverTime: '2026-11-15T10:00:00.000Z', deviceTime: '2026-11-15T09:59:59.500Z', fixTime: '2026-11-15T09:59:59.500Z',
  valid: true, latitude: 40.5, longitude: 72.8, altitude: 1200, speed: 10, course: 90, accuracy: 5,
  attributes: { battery: 95 },
}

describe('traccar adapter', () => {
  it('converts a valid position without trusting the device id as an external id', () => {
    const out = traccarPositionToBusway(sample)
    expect(out.gatewayPositionId).toBe('tc7-' + Date.parse('2026-11-15T09:59:59.500Z'))
    expect(out.traccarDeviceId).toBe('7')
    expect(out).not.toHaveProperty('deviceExternalId')
    expect(out.measuredAt).toBe('2026-11-15T09:59:59.500Z')
    expect(out.position).toEqual({ latitude: 40.5, longitude: 72.8 })
    expect(out.speedMps).toBeCloseTo(10 * 0.514444, 5)
    expect(out.headingDeg).toBe(90)
    expect(out.accuracyM).toBe(5)
  })
  it('never emits fields the strict ingest schema would reject', () => {
    const allowed = ['gatewayPositionId', 'traccarDeviceId', 'measuredAt', 'receivedAt', 'position', 'speedMps', 'headingDeg', 'accuracyM']
    expect(Object.keys(traccarPositionToBusway(sample)).every((k) => allowed.includes(k))).toBe(true)
  })
  it('omits optional fields instead of emitting undefined', () => {
    const out = traccarPositionToBusway({ id: 1, deviceId: 7, fixTime: sample.fixTime, latitude: 1, longitude: 2 })
    expect(Object.keys(out).sort()).toEqual(['gatewayPositionId', 'measuredAt', 'position', 'traccarDeviceId'])
  })
  it('converts speed knots to m/s', () => {
    expect(traccarPositionToBusway({ ...sample, speed: 0 }).speedMps).toBe(0)
  })
  it('rejects missing or malformed ids', () => {
    expect(traccarPositionToBusway({ ...sample, deviceId: undefined })).toBeNull()
    for (const bad of ['abc', '0', '-5', '1.5', '1e3', '99999999999999999999']) {
      expect(traccarPositionToBusway({ ...sample, deviceId: bad })).toBeNull()
    }
  })
  it('rejects invalid coordinates and missing time', () => {
    expect(traccarPositionToBusway({ ...sample, latitude: 200 })).toBeNull()
    expect(traccarPositionToBusway({ ...sample, longitude: 300 })).toBeNull()
    const rest = { ...sample }
    delete rest.fixTime; delete rest.deviceTime; delete rest.serverTime
    expect(traccarPositionToBusway(rest)).toBeNull()
  })
  it('rejects non-object input', () => {
    expect(traccarPositionToBusway(null)).toBeNull()
    expect(traccarPositionToBusway('x')).toBeNull()
  })
  it('dedupe key ignores Traccar position.id (always 0 at forward time) and is stable per fix', () => {
    const a = traccarPositionToBusway({ ...sample, id: 0 })
    const b = traccarPositionToBusway({ ...sample, id: 0 })
    const later = traccarPositionToBusway({ ...sample, id: 0, fixTime: '2026-11-15T10:00:01.500Z' })
    expect(a.gatewayPositionId).toBe(b.gatewayPositionId)
    expect(later.gatewayPositionId).not.toBe(a.gatewayPositionId)
    expect(traccarPositionToBusway({ ...sample, deviceId: 8 }).gatewayPositionId).not.toBe(a.gatewayPositionId)
  })
  it('rejects an unparsable fix time', () => {
    expect(traccarPositionToBusway({ ...sample, fixTime: 'not-a-date' })).toBeNull()
  })
  it('unwraps the { position, device } envelope Traccar 6.6 actually sends', () => {
    expect(traccarPayloadToBusway({ position: sample, device: { id: 7, uniqueId: 'x' } })).toHaveLength(1)
    expect(traccarPayloadToBusway([{ position: sample, device: {} }, { position: sample, device: {} }])).toHaveLength(2)
  })
  it('converts arrays and single objects, dropping invalid items', () => {
    expect(traccarPayloadToBusway([sample, { ...sample, id: 999, latitude: 999 }])).toHaveLength(1)
    expect(traccarPayloadToBusway(sample)).toHaveLength(1)
    expect(traccarPayloadToBusway(null)).toEqual([])
    expect(traccarPayloadToBusway({})).toEqual([])
  })
})

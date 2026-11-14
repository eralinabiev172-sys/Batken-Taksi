import { describe, expect, it } from 'vitest'
import { traccarPositionToBusway, traccarPayloadToBusway } from '../../src/lib/traccar-adapter.js'

const sample = {
  id: 12345,
  deviceId: 7,
  type: 'position',
  protocol: 'teltonika',
  serverTime: '2026-11-15T10:00:00.000Z',
  deviceTime: '2026-11-15T09:59:59.500Z',
  fixTime: '2026-11-15T09:59:59.500Z',
  valid: true,
  latitude: 40.5,
  longitude: 72.8,
  altitude: 1200,
  speed: 10,        // knots
  course: 90,
  accuracy: 5,
  attributes: { battery: 95 },
}

describe('traccar adapter', () => {
  it('converts a valid position', () => {
    const out = traccarPositionToBusway(sample, 'tracker-7')
    expect(out).not.toBeNull()
    expect(out.gatewayPositionId).toBe('12345')
    expect(out.deviceExternalId).toBe('tracker-7')
    expect(out.measuredAt).toBe('2026-11-15T09:59:59.500Z')
    expect(out.position).toEqual({ latitude: 40.5, longitude: 72.8 })
    expect(out.speedMps).toBeCloseTo(10 * 0.514444, 5)
    expect(out.headingDeg).toBe(90)
    expect(out.accuracyM).toBe(5)
  })
  it('converts speed knots to m/s', () => {
    const out = traccarPositionToBusway({ ...sample, speed: 0 }, 't')
    expect(out.speedMps).toBe(0)
  })
  it('returns null for missing id', () => {
    expect(traccarPositionToBusway({ ...sample, id: undefined, positionId: undefined }, 't')).toBeNull()
  })
  it('returns null for missing device external id', () => {
    expect(traccarPositionToBusway({ ...sample, deviceId: undefined }, undefined)).toBeNull()
  })
  it('returns null for invalid coordinates', () => {
    expect(traccarPositionToBusway({ ...sample, latitude: 200 }, 't')).toBeNull()
    expect(traccarPositionToBusway({ ...sample, longitude: 300 }, 't')).toBeNull()
  })
  it('returns null for missing measuredAt', () => {
    const rest = { ...sample }
    delete rest.fixTime; delete rest.deviceTime; delete rest.serverTime
    expect(traccarPositionToBusway(rest, 't')).toBeNull()
  })
  it('returns null for non-object input', () => {
    expect(traccarPositionToBusway(null, 't')).toBeNull()
    expect(traccarPositionToBusway('x', 't')).toBeNull()
  })
  it('converts array payload via deviceMap', () => {
    const out = traccarPayloadToBusway([sample, { ...sample, id: 999, latitude: 999 }], { 7: 'tracker-7' })
    expect(out).toHaveLength(1)
    expect(out[0].gatewayPositionId).toBe('12345')
  })
  it('converts single object payload', () => {
    const out = traccarPayloadToBusway(sample, { 7: 'tracker-7' })
    expect(out).toHaveLength(1)
  })
  it('returns empty array for invalid payload', () => {
    expect(traccarPayloadToBusway(null)).toEqual([])
    expect(traccarPayloadToBusway({})).toEqual([])
  })
})
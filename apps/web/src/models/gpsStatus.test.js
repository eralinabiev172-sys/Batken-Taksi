import { describe, expect, it } from 'vitest'
import { formatAge, getGpsStatus, isPubliclyCurrent } from './gpsStatus.js'

describe('GPS freshness model', () => {
  it.each([
    [0, 'live'], [6, 'live'], [7, 'delayed'], [20, 'delayed'],
    [21, 'stale'], [60, 'stale'], [61, 'offline'], [999, 'offline'],
  ])('maps age %s to %s', (age, expected) => {
    expect(getGpsStatus(age)).toBe(expected)
  })

  it('treats invalid and negative ages as offline', () => {
    expect(getGpsStatus(-1)).toBe('offline')
    expect(getGpsStatus('invalid')).toBe('offline')
  })

  it('only treats live and delayed states as publicly current', () => {
    expect(isPubliclyCurrent('live')).toBe(true)
    expect(isPubliclyCurrent('delayed')).toBe(true)
    expect(isPubliclyCurrent('stale')).toBe(false)
    expect(isPubliclyCurrent('offline')).toBe(false)
  })

  it('formats age in both supported languages', () => {
    expect(formatAge(12, 'ru')).toBe('12 сек. назад')
    expect(formatAge(75, 'ky')).toBe('1 мүн. мурун')
  })
})

import { describe, expect, it } from 'vitest'
import { getOffsetMs, isSameLocalDay, localDateString, localDayBounds } from '../../src/lib/time.js'

const HOUR = 3_600_000

describe('Asia/Bishkek calendar day (D-128)', () => {
  it('uses the tz database offset of +6 h', () => {
    expect(getOffsetMs(new Date('2026-11-14T05:18:41Z'))).toBe(6 * HOUR)
    expect(getOffsetMs(new Date('2026-07-01T00:00:00Z'))).toBe(6 * HOUR)
  })

  it('local date can differ from the UTC date', () => {
    expect(localDateString(new Date('2026-11-13T18:00:00Z'))).toBe('2026-11-14')
    expect(localDateString(new Date('2026-11-13T17:59:59Z'))).toBe('2026-11-13')
  })

  it('day bounds are [local midnight, next local midnight)', () => {
    const { start, end } = localDayBounds(new Date('2026-11-14T05:18:41Z'))
    expect(start.toISOString()).toBe('2026-11-13T18:00:00.000Z')
    expect(end.toISOString()).toBe('2026-11-14T18:00:00.000Z')
  })

  it('last millisecond belongs to the day, the next one to the next day', () => {
    const { end } = localDayBounds(new Date('2026-11-14T05:18:41Z'))
    const lastMs = new Date(end.getTime() - 1)
    expect(isSameLocalDay(lastMs, new Date('2026-11-14T05:18:41Z'))).toBe(true)
    expect(isSameLocalDay(end, new Date('2026-11-14T05:18:41Z'))).toBe(false)
  })

  it('works across month and year boundaries', () => {
    expect(localDayBounds(new Date('2026-12-31T20:00:00Z')).start.toISOString()).toBe('2026-12-31T18:00:00.000Z')
    expect(localDayBounds(new Date('2026-12-31T20:00:00Z')).end.toISOString()).toBe('2027-01-01T18:00:00.000Z')
    expect(localDayBounds(new Date('2028-02-28T20:00:00Z')).end.toISOString()).toBe('2028-02-29T18:00:00.000Z')
  })

  it('handles a zone with daylight saving correctly (generic, not Bishkek-specific)', () => {
    const { start, end } = localDayBounds(new Date('2026-03-29T12:00:00Z'), 'Europe/Berlin')
    expect(start.toISOString()).toBe('2026-03-28T23:00:00.000Z')
    expect(end.toISOString()).toBe('2026-03-29T22:00:00.000Z')
    expect((end - start) / HOUR).toBe(23)
  })
})

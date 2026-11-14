import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DRIVER_STATUSES } from '../../src/lib/driver-profile-status.js'

const raw = readFileSync(new URL('../../../../migrations/0003_complete_m1_schema.sql', import.meta.url), 'utf8')
const [up, down] = raw.split('-- Down Migration').map((s) => s.replace(/--[^\n]*/g, ''))
const countryList = up.match(/country_code IN\s*\(([\s\S]*?)\)\s*\)/)[1]
const codes = [...countryList.matchAll(/'([A-Z]{2})'/g)].map((m) => m[1])

describe('0003 static migration checks (not SQL execution)', () => {
  it('matches the pinned ISO snapshot, not just a two-letter pattern', () => {
    // Debian iso-codes d055275324963c9bce5882eaaa93024cf2bf7ed0,
    // data/iso_3166-1.json, independently fetched/hashed during implementation.
    expect(codes).toHaveLength(249)
    expect(new Set(codes).size).toBe(249)
    expect(createHash('sha256').update([...codes].sort().join(' ')).digest('hex'))
      .toBe('e1c950d24ceb933ac49eaa44de8d1a7ffb6bf40bfe519a5a99d791cb50332197')
    expect(codes).toContain('KG')
    for (const invalid of ['ZZ', 'UK', 'XK', 'SU', 'kg']) expect(codes).not.toContain(invalid)
  })

  it('uses the same status vocabulary and derivation as the pure state helper', () => {
    const statuses = [...up.match(/CHECK \(status IN \(([^)]+)\)\)/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(statuses).toEqual(DRIVER_STATUSES)
    expect(up).toContain("ADD COLUMN status text NOT NULL DEFAULT 'pending'")
    expect(up).toContain('ALTER COLUMN is_active SET DEFAULT false')
    expect(up).toContain("CHECK (is_active = (status = 'active'))")
    expect(up).toContain('NEW.status IS NOT DISTINCT FROM OLD.status')
    expect(up).toContain('NEW.is_active IS DISTINCT FROM OLD.is_active')
    expect(up).toContain("NEW.is_active := (NEW.status = 'active')")
    expect(up).toMatch(/BEFORE INSERT OR UPDATE ON driver_profiles/)
  })

  it('only backfills the approved legacy boolean, not audit/users/country data', () => {
    const updates = [...up.matchAll(/^UPDATE\s+[^;]+;/gm)].map((m) => m[0])
    expect(updates).toEqual(['UPDATE driver_profiles SET is_active = false;'])
    expect(up).not.toMatch(/\b(?:DELETE FROM|TRUNCATE|DISABLE TRIGGER|GRANT|REVOKE|DROP)\b/i)
  })

  it('uses nullable polygon/4326 and validates shape and coordinate ranges', () => {
    expect(up).toContain('ADD COLUMN bounds geometry(Polygon,4326),')
    for (const rule of ['bounds IS NULL', 'ST_IsValid(bounds)', 'NOT ST_IsEmpty(bounds)', 'ST_NDims(bounds) = 2',
      'ST_XMin(Box3D(bounds)) >= -180', 'ST_XMax(Box3D(bounds)) <= 180',
      'ST_YMin(Box3D(bounds)) >= -90', 'ST_YMax(Box3D(bounds)) <= 90']) expect(up).toContain(rule)
    expect(up).not.toMatch(/ALTER TABLE (?:routes|route_directions)/)
  })

  it('retains unknown old audit values and timestamps, with server time on inserts only', () => {
    for (const [name, type] of Object.entries({ ip: 'inet', user_agent: 'text', result: 'text', before_data: 'jsonb', after_data: 'jsonb', correlation_id: 'text', created_at: 'timestamptz' })) {
      expect(up).toContain(`ADD COLUMN ${name} ${type},`)
    }
    expect(up.indexOf('ADD COLUMN created_at timestamptz,')).toBeLessThan(up.indexOf('ALTER COLUMN created_at SET DEFAULT'))
    expect(up).toContain('NEW.created_at := clock_timestamp()')
    expect(up).toMatch(/BEFORE INSERT ON audit_logs/)
    expect(up).not.toMatch(/NEW\.(?:occurred_at|request_id|correlation_id)\s*:=/)
    expect(up).not.toMatch(/UPDATE\s+audit_logs/i)
  })

  it('restricts host IPs, results and both snapshots with an initially empty allowlist', () => {
    expect(up).toContain('masklen(ip) = CASE family(ip) WHEN 4 THEN 32 WHEN 6 THEN 128 END')
    expect(up).toContain("result IN ('success', 'failure', 'denied')")
    for (const column of ['before_data', 'after_data']) {
      expect(up).toContain(`${column} IS NULL OR (jsonb_typeof(${column}) = 'object' AND ${column} = '{}'::jsonb)`)
    }
  })

  it('refuses down without destructive SQL', () => {
    expect(down).toContain("ERRCODE = '0A000'")
    expect(down).toContain('Automatic rollback of 0003 is disabled')
    expect(down).not.toMatch(/\b(?:ALTER|UPDATE|DELETE|DROP|TRUNCATE|INSERT)\b/i)
  })
})

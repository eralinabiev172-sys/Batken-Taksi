import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readRepo = (path) => readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8')
const sql = readRepo('migrations/0002_add_documented_text_fields.sql')
const normative = readRepo('docs/DATABASE.md')
const withoutComments = (text) => text.replace(/--[^\n]*/g, '').trim()
const [up, down] = sql.split('-- Down Migration').map(withoutComments)

// Static checks only: they neither import pg nor execute SQL. These assertions
// cover this intentionally small additive migration, not a general SQL parser.
const additions = [
  ['users', ['display_name']],
  ['driver_profiles', ['internal_number', 'phone', 'admin_note']],
  ['cities', ['country_code']],
]

describe('documented text fields: additive migration 0002', () => {
  it('has one up and one down section', () => {
    expect(sql.match(/^-- Up Migration$/gm)).toHaveLength(1)
    expect(sql.match(/^-- Down Migration$/gm)).toHaveLength(1)
  })

  it.each(additions)('adds only the documented text fields in %s', (table, fields) => {
    const docLine = normative.split('\n').find((line) => line.startsWith(`- \`${table}\`:`))
    expect(docLine).toBeDefined()
    const statement = up.split(';').find((part) => new RegExp(`ALTER TABLE ${table}\\b`).test(part))
    expect(statement).toBeDefined()
    for (const field of fields) {
      expect(docLine).toContain(field)
      expect(statement).toMatch(new RegExp(`ADD COLUMN ${field} text\\s*(?:,|$)`))
    }
    const added = [...statement.matchAll(/ADD COLUMN (\w+) text/g)].map((match) => match[1])
    expect(added).toEqual(fields)
  })

  it('contains exactly the three reviewed additive statements', () => {
    const statements = up.split(';').map((part) => part.trim()).filter(Boolean)
    const expected = additions.map(([table, fields]) =>
      `ALTER TABLE ${table} ${fields.map((field) => `ADD COLUMN ${field} text`).join(', ')}`)
    expect(statements.map((part) => part.replace(/\s+/g, ' '))).toEqual(expected)
  })

  it('preserves data and does not invent defaults, mandatory values or uniqueness', () => {
    expect(up).not.toMatch(/\b(?:UPDATE|INSERT|DELETE|DROP|TRUNCATE|RENAME|NOT NULL|DEFAULT|UNIQUE|CHECK)\b/i)
  })

  it('does not change privileges, audit triggers or the audit table', () => {
    expect(up).not.toMatch(/\b(?:GRANT|REVOKE|TRIGGER|FUNCTION|audit_logs|user_roles|sessions)\b/i)
  })

  it('does not silently choose representations for unresolved fields', () => {
    expect(up).not.toMatch(/\b(?:status|bounds|ip|ip_address|user_agent|result|before|after|correlation_id|created_at)\b/i)
    expect(up).not.toMatch(/\b(?:full_name|is_active|request_id|occurred_at)\b/i)
  })

  it('blocks automatic destructive rollback instead of dropping populated columns', () => {
    expect(down).toMatch(/RAISE EXCEPTION/)
    expect(down).toMatch(/ERRCODE\s*=\s*'0A000'/)
    expect(down).not.toMatch(/\b(?:ALTER|DROP|DELETE|UPDATE|TRUNCATE)\b/i)
  })
})

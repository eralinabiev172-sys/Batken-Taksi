import { randomBytes, createHash } from 'node:crypto'

const TOKEN_BYTES = 32
const ABSOLUTE_MS = 8 * 60 * 60 * 1000
const IDLE_MS = 30 * 60 * 1000

export const SESSION_ABSOLUTE_MS = ABSOLUTE_MS
export const SESSION_IDLE_MS = IDLE_MS

export function generateToken() {
  const token = randomBytes(TOKEN_BYTES).toString('base64url')
  const hash = createHash('sha256').update(token).digest()
  return { token, hash }
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest()
}

export function sessionExpiry(now = new Date()) {
  const created = now
  return {
    created_at: created,
    absolute_expires_at: new Date(created.getTime() + ABSOLUTE_MS),
    idle_expires_at: new Date(created.getTime() + IDLE_MS),
  }
}

export function isSessionValid(row, now = new Date()) {
  if (!row) return false
  if (row.revoked_at) return false
  const t = now.getTime()
  if (new Date(row.absolute_expires_at).getTime() <= t) return false
  if (new Date(row.idle_expires_at).getTime() <= t) return false
  return true
}

export function touchIdle(row, now = new Date()) {
  return new Date(Math.min(new Date(row.absolute_expires_at).getTime(), now.getTime() + IDLE_MS))
}
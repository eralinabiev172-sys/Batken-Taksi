import { hashToken, isSessionValid, touchIdle } from '../lib/session.js'

function parseCookies(header) {
  const out = {}
  if (typeof header !== 'string') return out
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (k) try { out[k] = decodeURIComponent(v) } catch { out[k] = v }
  }
  return out
}

const IS_PROD = process.env.NODE_ENV === 'production'
const SESSION_COOKIE = IS_PROD ? '__Host-session' : 'session'
const CSRF_COOKIE = IS_PROD ? '__Host-csrf' : 'csrf'

export function registerAuth(app) {
  app.decorate('resolveSession', async (token) => {
    if (typeof token !== 'string' || token.length === 0) return null
    const hash = hashToken(token)
    const { rows } = await app.db.query(
      `select s.id, s.user_id, s.absolute_expires_at, s.idle_expires_at, s.revoked_at,
              u.status as user_status
         from sessions s join users u on u.id = s.user_id
        where s.token_hash = $1`,
      [hash],
    )
    const row = rows[0]
    if (!row || row.user_status !== 'active') return null
    if (!isSessionValid(row)) return null
    // touch idle expiry
    const newIdle = touchIdle(row)
    await app.db.query('update sessions set last_seen_at = now(), idle_expires_at = $1 where id = $2', [newIdle, row.id])
    // roles + permissions
    const { rows: roleRows } = await app.db.query('select role from user_roles where user_id = $1', [row.user_id])
    const { rows: permRows } = await app.db.query('select permission from admin_permissions where user_id = $1', [row.user_id])
    return {
      sessionId: row.id,
      userId: row.user_id,
      roles: roleRows.map((r) => r.role),
      permissions: permRows.map((p) => p.permission),
    }
  })

  app.decorate('requireAuth', (handler) => async (request, reply) => {
    const token = parseCookies(request.headers?.cookie)[SESSION_COOKIE]
    const session = await app.resolveSession(token)
    if (!session) {
      reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: request.id } })
      return
    }
    request.session = session
    return handler(request, reply)
  })

  app.decorate('requireRole', (role, handler) => async (request, reply) => {
    const token = parseCookies(request.headers?.cookie)[SESSION_COOKIE]
    const session = await app.resolveSession(token)
    if (!session) {
      reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: request.id } })
      return
    }
    if (!session.roles.includes(role)) {
      reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden', requestId: request.id } })
      return
    }
    request.session = session
    return handler(request, reply)
  })

  app.decorate('requirePermission', (permission, handler) => async (request, reply) => {
    const token = parseCookies(request.headers?.cookie)[SESSION_COOKIE]
    const session = await app.resolveSession(token)
    if (!session) {
      reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: request.id } })
      return
    }
    if (!session.permissions.includes(permission)) {
      reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden', requestId: request.id } })
      return
    }
    request.session = session
    return handler(request, reply)
  })
}

export { SESSION_COOKIE, CSRF_COOKIE }
import Typebox from 'typebox'
import { Value } from 'typebox/value'
import { verifyPassword } from '../lib/password.js'
import { generateToken, sessionExpiry, hashToken } from '../lib/session.js'
import { SESSION_COOKIE, CSRF_COOKIE } from '../plugins/auth.js'

const LoginBody = Typebox.Object({ email: Typebox.String({ minLength: 1 }), password: Typebox.String({ minLength: 1 }) }, { additionalProperties: false })

function parseCookies(header) {
  const out = {}
  if (typeof header !== 'string') return out
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (k) out[k] = decodeURIComponent(v)
  }
  return out
}

const IS_PROD = process.env.NODE_ENV === 'production'

// simple in-memory rate limiter for login
const loginAttempts = new Map()
function rateLimitLogin(key) {
  const now = Date.now()
  const windowMs = 15 * 60 * 1000
  const entry = loginAttempts.get(key) || { count: 0, reset: now + windowMs }
  if (now > entry.reset) { entry.count = 0; entry.reset = now + windowMs }
  entry.count += 1
  loginAttempts.set(key, entry)
  return entry.count > 5
}

export default async function authRoutes(app) {
  app.post('/auth/login', async (request, reply) => {
    const body = request.body
    // validate
    const errors = Value.Errors(LoginBody, body)
    if ([...errors].length > 0) {
      reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', requestId: request.id } })
      return
    }
    const { email, password } = body
    const ip = request.ip || 'unknown'
    if (rateLimitLogin(`${ip}|${email}`)) {
      reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many requests', requestId: request.id } })
      return
    }
    const { rows } = await app.db.query('select id, password_hash, status from users where lower(email) = lower($1)', [email])
    const user = rows[0]
    const ok = user && user.status === 'active' && (await verifyPassword(password, user.password_hash))
    if (!ok) {
      reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: request.id } })
      return
    }
    // roles
    const { rows: roleRows } = await app.db.query('select role from user_roles where user_id = $1', [user.id])
    // create session
    const { token, hash } = generateToken()
    const exp = sessionExpiry()
    await app.db.query(
      `insert into sessions (user_id, token_hash, absolute_expires_at, idle_expires_at) values ($1,$2,$3,$4)`,
      [user.id, hash, exp.absolute_expires_at, exp.idle_expires_at],
    )
    const csrf = (await import('node:crypto')).randomBytes(32).toString('base64url')
    const maxAge = Math.floor((exp.absolute_expires_at.getTime() - Date.now()) / 1000)
    const cookies = []
    const pushCookie = (name, value, ma) => {
      const attrs = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${ma}`]
      if (IS_PROD) attrs.push('Secure')
      cookies.push(attrs.join('; '))
    }
    pushCookie(SESSION_COOKIE, token, maxAge)
    pushCookie(CSRF_COOKIE, csrf, maxAge)
    reply.header('set-cookie', cookies)
    reply.send({ user: { id: user.id, roles: roleRows.map((r) => r.role) } })
  })

  app.post('/auth/logout', async (request, reply) => {
    const cookies = parseCookies(request.headers.cookie)
    const token = cookies['__Host-session']
    if (token) {
      const hash = hashToken(token)
      await app.db.query('update sessions set revoked_at = now(), revoked_reason = $1 where token_hash = $2 and revoked_at is null', ['logout', hash])
    }
    // clear cookies
    reply.header('set-cookie', [`${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`, `${CSRF_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`])
    reply.code(204).send()
  })

  app.get('/auth/me', async (request, reply) => {
    const cookies = parseCookies(request.headers.cookie)
    const session = await app.resolveSession(cookies[SESSION_COOKIE])
    if (!session) {
      reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: request.id } })
      return
    }
    const { rows } = await app.db.query('select id, email, status from users where id = $1', [session.userId])
    reply.send({ user: rows[0], roles: session.roles, permissions: session.permissions })
  })

  app.post('/auth/csrf-token', async (request, reply) => {
    const cookies = parseCookies(request.headers.cookie)
    const session = await app.resolveSession(cookies[SESSION_COOKIE])
    if (!session) {
      reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: request.id } })
      return
    }
    const csrf = (await import('node:crypto')).randomBytes(32).toString('base64url')
    const maxAge = 30 * 60
    reply.header('set-cookie', `${CSRF_COOKIE}=${encodeURIComponent(csrf)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`)
    reply.send({ csrfToken: csrf })
  })
}
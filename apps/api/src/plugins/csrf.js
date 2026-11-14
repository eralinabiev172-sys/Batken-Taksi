const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

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
const SESSION_COOKIE = '__Host-session'
const CSRF_COOKIE = '__Host-csrf'

export function registerCsrf(app) {
  app.addHook('onRequest', async (request, reply) => {
    if (SAFE_METHODS.has(request.method)) return
    const cookies = parseCookies(request.headers.cookie)
    // Origin check (only when Origin header present)
    const origin = request.headers.origin
    const host = request.headers.host
    if (origin) {
      let originHost
      try { originHost = new URL(origin).host } catch { originHost = null }
      if (!originHost || originHost !== host) {
        reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden', requestId: request.id } })
        return
      }
    }
    // CSRF double-submit only for authenticated sessions.
    const sessionCookie = cookies[SESSION_COOKIE]
    if (!sessionCookie) return
    const cookieToken = cookies[CSRF_COOKIE]
    const headerToken = request.headers['x-csrf-token']
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden', requestId: request.id } })
      return
    }
  })
}

export { SESSION_COOKIE, CSRF_COOKIE }
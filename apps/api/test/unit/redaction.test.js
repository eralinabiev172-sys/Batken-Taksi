import { Writable } from 'node:stream'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.js'
import { REDACT_PATHS } from '../../src/plugins/logging.js'

const config = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 3001,
  logLevel: 'info',
  databaseUrl: 'postgres://u:p@127.0.0.1:1/none',
  dbPoolMax: 1,
}

function capture() {
  const chunks = []
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString())
      callback()
    },
  })
  return { stream, output: () => chunks.join('') }
}

describe('redaction paths (independent of Fastify serializers)', () => {
  it('censors secrets in raw req/res header objects', () => {
    const { stream, output } = capture()
    const log = pino({ redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } }, stream)
    log.info({
      req: { headers: { cookie: 'sid=RAW-COOKIE', authorization: 'Bearer RAW-BEARER', 'x-csrf-token': 'RAW-CSRF', 'x-internal-secret': 'RAW-INTERNAL', accept: 'application/json' } },
      res: { headers: { 'set-cookie': 'sid=RAW-SETCOOKIE' } },
    })
    const text = output()
    for (const leak of ['RAW-COOKIE', 'RAW-BEARER', 'RAW-CSRF', 'RAW-INTERNAL', 'RAW-SETCOOKIE']) {
      expect(text, leak).not.toContain(leak)
    }
    expect(text).toContain('application/json')
  })
})

describe('log redaction', () => {
  it('does not write cookies, tokens, passwords or connection strings to the log', async () => {
    const { stream, output } = capture()
    const app = await buildApp({ config, loggerStream: stream })
    app.get('/log', async (request) => {
      request.log.info({ req: { headers: request.headers } }, 'incoming request')
      request.log.info({ headers: request.headers, password: 'PW-LEAK', token: 'TOKEN-LEAK' }, 'direct')
      request.log.info({ user: { passwordHash: 'HASH-LEAK', secret: 'SECRET-LEAK' }, databaseUrl: 'postgres://u:URL-LEAK@h/db' }, 'nested')
      return { ok: true }
    })
    await app.inject({
      url: '/log',
      headers: { cookie: 'sid=COOKIE-LEAK', authorization: 'Bearer BEARER-LEAK', 'x-csrf-token': 'CSRF-LEAK', 'x-internal-secret': 'INTERNAL-LEAK' },
    })
    await app.close()

    const log = output()
    expect(log).toContain('incoming request')
    for (const leak of ['COOKIE-LEAK', 'BEARER-LEAK', 'CSRF-LEAK', 'INTERNAL-LEAK', 'PW-LEAK', 'TOKEN-LEAK', 'HASH-LEAK', 'SECRET-LEAK', 'URL-LEAK']) {
      expect(log, leak).not.toContain(leak)
    }
    // The production logger drops non-allowlisted fields altogether.
    expect(log).not.toContain('headers')
  })
})

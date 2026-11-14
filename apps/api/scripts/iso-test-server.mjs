// TEST-ONLY server for browser end-to-end checks. Connects exclusively to the disposable
// container busway-test-postgres-iso (verified through docker inspect) and listens on loopback.
// It never reads DATABASE_URL and refuses to start if the container identity does not match.
import { execFileSync } from 'node:child_process'
import pg from 'pg'
import { buildApp } from '../src/app.js'

const CONTAINER = 'busway-test-postgres-iso'
const PORT = 55433

const bindings = JSON.parse(execFileSync('docker', ['inspect', CONTAINER, '--format', '{{json .HostConfig.PortBindings}}'], { encoding: 'utf8' }))
const binding = bindings['5432/tcp']?.[0]
if (!binding || binding.HostIp !== '127.0.0.1' || binding.HostPort !== String(PORT)) {
  console.error('isolated container identity check failed; not starting')
  process.exit(1)
}

process.env.INTERNAL_GPS_SECRET = process.env.INTERNAL_GPS_SECRET || 'browser-e2e-gateway-secret'
const pool = new pg.Pool({ host: '127.0.0.1', port: PORT, database: 'busway_test', user: 'busway_app', password: 'iso-app-pw', ssl: false, max: 5 })
const app = await buildApp({
  config: { nodeEnv: 'test', host: '127.0.0.1', port: 3001, logLevel: 'silent', databaseUrl: 'postgres://x:y@127.0.0.1:5432/busway', dbPoolMax: 1, wsExpiryCheckMs: 500 },
  pool,
})
await app.listen({ host: '127.0.0.1', port: 3001 })
console.log('iso test server listening on 127.0.0.1:3001')
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); await pool.end(); process.exit(0) })

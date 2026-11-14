import { EventEmitter } from 'node:events'
import { Writable } from 'node:stream'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { buildApp } from '../../src/app.js'
import { buildLoggerOptions, createSafeLogger } from '../../src/plugins/logging.js'
import { logSafeException, serializeException, sanitizeLogLine } from '../../src/lib/safe-diagnostics.js'
import { createServerLogContext, trustedLogFields } from '../../src/lib/log-context.js'

const REQUEST_ID = 'c754115a-3817-4c94-8e6f-c13ad23d3b40'
const CORRELATION_ID = '671a825c-4927-44c5-b30c-6fc0688a0973'
const SECRETS = [
  'fixture-password-M2', 'fixture-token-M2', 'fixture-api-key-M2',
  'fixture-cookie-M2', 'fixture-stack-M2', 'fixture-cause-M2',
]
const URL_SECRET = 'postgres://u:fixture-password-M2@127.0.0.1:5432/busway'

function capture() {
  const chunks = []
  const stream = new Writable({ write(chunk, _encoding, callback) { chunks.push(chunk.toString()); callback() } })
  return {
    stream,
    text: () => chunks.join(''),
    records: () => chunks.join('').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)),
  }
}

function hostileError() {
  const cause = new Error('fixture-cause-M2')
  cause.secret = SECRETS[2]
  const error = new Error(`${URL_SECRET} Bearer fixture-token-M2 Cookie: fixture-cookie-M2`, { cause })
  error.stack = `fixture-stack-M2 ${URL_SECRET}`
  error.code = '28P01'
  error.detail = { apiKey: SECRETS[2], nested: { token: SECRETS[1] } }
  error.toJSON = () => ({ leaked: SECRETS })
  return error
}

function expectNoLeaks(output) {
  for (const secret of [...SECRETS, URL_SECRET, 'Bearer fixture-token-M2']) expect(output, 'synthetic secret must not reach output').not.toContain(secret)
  for (const forbidden of ['"stack":','"cause":','"password":','"authorization":','"cookie":','"body":']) expect(output).not.toContain(forbidden)
}

describe('exception allowlist', () => {
  it('keeps an approved code but neither message, stack, cause nor custom fields', () => {
    expect(serializeException(hostileError())).toEqual({ type:'Error', code:'28P01', hasCause:true })
  })

  it.each([undefined,null,'fixture-token-M2',42,{ code:'fixture-api-key-M2', message:URL_SECRET }])(
    'uses UNKNOWN_ERROR for a nonstandard thrown value %#', (value) => {
      expect(serializeException(value)).toEqual({type:'UnknownError',code:'UNKNOWN_ERROR'})
    },
  )

  it('does not invoke exception getters or toJSON', () => {
    const getter = vi.fn(() => { throw new Error(SECRETS[0]) })
    const value = Object.create(null)
    for (const key of ['message','stack','cause','code','statusCode']) Object.defineProperty(value,key,{get:getter})
    value.toJSON = getter
    expect(serializeException(value)).toEqual({type:'UnknownError',code:'UNKNOWN_ERROR'})
    expect(getter).not.toHaveBeenCalled()
  })

  it('handles revoked proxies without exposing an exception', () => {
    const {proxy,revoke} = Proxy.revocable({}, {})
    revoke()
    expect(serializeException(proxy)).toEqual({type:'UnknownError',code:'UNKNOWN_ERROR'})
  })

  it('does not traverse cyclic or aggregate causes', () => {
    const error = new AggregateError([hostileError()], SECRETS[0])
    error.cause = error
    expect(serializeException(error)).toEqual({type:'AggregateError',code:'UNKNOWN_ERROR',hasCause:true})
  })
})

describe('final Pino output, not just helper return values', () => {
  it('protects Error-first, err, error, nested objects, strings, printf arguments and child bindings', () => {
    const sink = capture()
    const log = pino(buildLoggerOptions({logLevel:'info'}),sink.stream)
    const error = hostileError()
    log.error(error)
    log.error({err:error},'unhandled error')
    log.error({error, body:{token:SECRETS[1]}, headers:{authorization:`Bearer ${SECRETS[1]}`}}, URL_SECRET)
    log.error({unexpected:{error, cause:error}}, 'message %s', SECRETS[2])
    log.error(URL_SECRET)
    log.error('unhandled error', error)
    log.child({secret:SECRETS[0],nested:{cause:error},reqId:REQUEST_ID}).error({err:error},'unhandled error')
    expectNoLeaks(sink.text())
    expect(sink.records()).toHaveLength(7)
    expect(sink.records().some((r)=>r.err?.code==='28P01')).toBe(true)
    expect(sink.records().at(-1).request_id).toBeUndefined()
  })

  it('preserves server-owned request and correlation UUIDs with known diagnostic codes', () => {
    const sink = capture()
    const log = createSafeLogger({logLevel:'info'},sink.stream)
    const context = createServerLogContext()
    logSafeException(log,Object.assign(hostileError(),{code:'ECONNREFUSED'}),'database_unavailable',context)
    expect(sink.records()[0]).toMatchObject({
      ...trustedLogFields(context),
      err:{type:'Error',code:'ECONNREFUSED',hasCause:true},msg:'database readiness check failed',
    })
    expectNoLeaks(sink.text())
  })

  it('drops unvalidated identifiers, unknown codes and attacker-controlled event names', () => {
    const sink = capture()
    const log = pino(buildLoggerOptions({logLevel:'info'}),sink.stream)
    logSafeException(log,{code:SECRETS[2],statusCode:500,message:URL_SECRET},SECRETS[0],{
      request_id:SECRETS[1],correlation_id:URL_SECRET,
    })
    expect(sink.records()[0]).toMatchObject({err:{code:'UNKNOWN_ERROR',statusCode:500},msg:'diagnostic event'})
    expect(sink.records()[0].request_id).toBeUndefined()
    expectNoLeaks(sink.text())
  })

  it('filters nested children and their message prefixes at the final output boundary', () => {
    const sink = capture()
    const log = pino(buildLoggerOptions({logLevel:'info'}),sink.stream)
    const child = log.child({untrusted:{secret:SECRETS[2]},correlationId:CORRELATION_ID}, {msgPrefix:URL_SECRET})
    child.child({other:{password:SECRETS[0]},reqId:REQUEST_ID}).error({err:hostileError()},'unhandled error')
    expectNoLeaks(sink.text())
    expect(sink.records()[0]).toMatchObject({msg:'diagnostic event'})
    expect(sink.records()[0].request_id).toBeUndefined()
    expect(sink.records()[0].correlation_id).toBeUndefined()
  })

  it('fails closed for an invalid JSON log line without echoing it', () => {
    const line = sanitizeLogLine(URL_SECRET)
    expect(JSON.parse(line)).toEqual({level:50,code:'UNKNOWN_ERROR',msg:'diagnostic event'})
    expectNoLeaks(line)
  })
})

describe('bootstrap failure logging (no database/server started)', () => {
  it('does not forward raw subprocess diagnostics from the migration CLI (static check)', () => {
    const source=readFileSync(new URL('../../scripts/migrate.js',import.meta.url),'utf8')
    expect(source).toContain("stdio: 'ignore'")
    expect(source).not.toContain("stdio: 'inherit'")
    expect(source).not.toContain('console.log(result.output)')
    expect(source).toContain('migrationDiagnostic(')
  })

  it('exits safely on invalid configuration without printing its values or stack', () => {
    const result=spawnSync(process.execPath,['src/server.js'],{
      cwd:fileURLToPath(new URL('../..',import.meta.url)),
      env:{...process.env,DATABASE_URL:`mysql://u:${SECRETS[0]}@invalid/db`,PORT:SECRETS[1]},
      encoding:'utf8',timeout:10000,
    })
    expect(result.status).toBe(1)
    expect(result.error).toBeUndefined()
    expectNoLeaks(`${result.stdout}${result.stderr}`)
    const records=result.stdout.trim().split('\n').map((line)=>JSON.parse(line))
    expect(records.some((r)=>r.msg==='invalid configuration')).toBe(true)
    expect(result.stderr).toBe('')
  })
})

describe('API log regression with fake database only', () => {
  it('protects 500, readiness, pool errors and automatic request logs without changing API error shape', async () => {
    const sink = capture()
    const pool = new EventEmitter()
    pool.query = vi.fn(async () => { throw hostileError() })
    const app = await buildApp({
      config:{logLevel:'info'},pool,loggerStream:sink.stream,
    })
    app.get('/boom', async (request) => {
      request.correlationId = CORRELATION_ID
      throw hostileError()
    })
    app.post('/echo', async () => ({ok:true}))
    try {
      const boom = await app.inject({url:'/boom?api_key=fixture-api-key-M2',headers:{
        authorization:`Bearer ${SECRETS[1]}`,cookie:SECRETS[3],'x-request-id':SECRETS[0],
      }})
      expect(boom.statusCode).toBe(500)
      expect(boom.json().error).toMatchObject({code:'INTERNAL_ERROR',message:'Internal server error'})
      expect(typeof boom.json().error.requestId).toBe('string')
      const ready = await app.inject('/health/ready')
      expect(ready.statusCode).toBe(503)
      expect(ready.json().error.code).toBe('SERVICE_UNAVAILABLE')
      const body = await app.inject({method:'POST',url:'/echo',payload:{password:SECRETS[0],token:SECRETS[1]}})
      expect(body.statusCode).toBe(200)
      pool.emit('error',hostileError())
      const malformed = await app.inject({method:'POST',url:'/echo',headers:{'content-type':'application/json'},payload:`{"password":"${SECRETS[0]}"`})
      expect(malformed.statusCode).toBe(400)
      expectNoLeaks(sink.text())
      const errorRecord = sink.records().find((r)=>r.msg==='unhandled error')
      expect(errorRecord.request_id).toBe(boom.json().error.requestId)
      expect(typeof errorRecord.correlation_id).toBe('string')
      expect(errorRecord.correlation_id).not.toBe(CORRELATION_ID)
      expect(errorRecord.err.code).toBe('28P01')
      expect(sink.records().some((r)=>r.msg==='idle database client error')).toBe(true)
    } finally { await app.close() }
  })
})

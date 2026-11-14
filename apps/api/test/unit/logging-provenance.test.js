import { Writable } from 'node:stream'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createSafeLogger } from '../../src/plugins/logging.js'
import { createServerLogContext, trustedLogFields } from '../../src/lib/log-context.js'
import { safeLogContext, logSafeException, serializeException, migrationDiagnostic } from '../../src/lib/safe-diagnostics.js'
import { buildApp } from '../../src/app.js'

const TOKEN = '15aa35be-e6a9-43f6-9f66-6d9e127178cc'
const capture = () => {
  let output = ''
  const stream = new Writable({write(chunk,_encoding,callback){output+=chunk.toString();callback()}})
  return {stream,text:()=>output,records:()=>output.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))}
}

describe('trusted context cannot be reconstructed from log fields', () => {
  it.each(['id','request_id','requestId','reqId','correlation_id','correlationId'])(
    'never promotes Error.%s into an identifier', (key) => {
      const sink=capture(), log=createSafeLogger({logLevel:'info'},sink.stream)
      const error=new Error('private message')
      error[key]=TOKEN
      log.error(error,'unhandled error')
      log.error({err:error,[key]:TOKEN},'unhandled error')
      logSafeException(log,error,'unhandled_error',error)
      expect(sink.records()).toHaveLength(3)
      expect(sink.text()).not.toContain(TOKEN)
      for(const record of sink.records()) {
        expect(record.request_id).toBeUndefined()
        expect(record.correlation_id).toBeUndefined()
      }
    },
  )

  it('rejects plain UUID bindings and ignores getters before reaching raw Pino', () => {
    const sink=capture(), log=createSafeLogger({logLevel:'info'},sink.stream)
    const getter=vi.fn(()=>{throw new Error('must not run')})
    const bindings={id:TOKEN,request_id:TOKEN,reqId:TOKEN,correlation_id:TOKEN,nested:{token:TOKEN}}
    for(const key of ['extra','toJSON','correlationId']) Object.defineProperty(bindings,key,{enumerable:true,get:getter})
    log.child(bindings).child(bindings).error({err:new TypeError('hidden')},'unhandled error')
    expect(getter).not.toHaveBeenCalled()
    expect(sink.records()[0].err.type).toBe('TypeError')
    expect(sink.text()).not.toContain(TOKEN)
  })

  it('rejects revoked proxy bindings without invoking their traps', () => {
    const sink=capture(), log=createSafeLogger({logLevel:'info'},sink.stream)
    const {proxy,revoke}=Proxy.revocable({}, {})
    revoke()
    expect(()=>log.child(proxy).info('incoming request')).not.toThrow()
    expect(sink.records()).toHaveLength(1)
  })

  it('does not promote copied trusted fields or accept factory input', () => {
    const context=createServerLogContext({request_id:TOKEN})
    const fields=trustedLogFields(context)
    expect(fields.request_id).not.toBe(TOKEN)
    expect(safeLogContext(context)).toEqual(fields)
    expect(safeLogContext({...fields})).toEqual({})
    const sink=capture(), log=createSafeLogger({logLevel:'info'},sink.stream)
    log.child({...fields}).error({err:new Error('hidden')},'unhandled error')
    expect(sink.records()[0].request_id).toBeUndefined()
    logSafeException(log,new Error('hidden'),'unhandled_error',{...fields})
    expect(sink.records()[1].request_id).toBeUndefined()
  })

  it('preserves real server context through children and rejects attempted overrides', () => {
    const context=createServerLogContext(), fields=trustedLogFields(context)
    const sink=capture(), log=createSafeLogger({logLevel:'info'},sink.stream)
    const child=log.child(context)
    child.child({request_id:TOKEN,correlation_id:TOKEN}).error({id:TOKEN,err:new Error('hidden')},'unhandled error')
    expect(sink.records()[0]).toMatchObject(fields)
    expect(sink.text()).not.toContain(TOKEN)
    expect(child.bindings()).toEqual(fields)
  })

  it('does not mix concurrent request contexts or inherit mutable request fields', async () => {
    const sink=capture(), pool=new EventEmitter()
    const app=await buildApp({config:{logLevel:'info'},pool,loggerStream:sink.stream})
    app.get('/failure',async request=>{
      request.correlationId=TOKEN
      await Promise.resolve()
      const error=new RangeError('hidden');error.id=TOKEN
      throw error
    })
    try {
      const responses=await Promise.all(Array.from({length:4},()=>app.inject({url:'/failure',headers:{'x-request-id':TOKEN,'x-correlation-id':TOKEN}})))
      const ids=responses.map(r=>r.json().error.requestId)
      expect(new Set(ids).size).toBe(4)
      const errors=sink.records().filter(r=>r.msg==='unhandled error')
      expect(errors).toHaveLength(4)
      expect(new Set(errors.map(r=>r.correlation_id)).size).toBe(4)
      expect(errors.map(r=>r.request_id).sort()).toEqual([...ids].sort())
      for(const r of responses) expect(r.json().error).toMatchObject({code:'INTERNAL_ERROR',message:'Internal server error'})
      for(const error of errors) expect(error.err.type).toBe('RangeError')
      expect(sink.text()).not.toContain(TOKEN)
    } finally {await app.close()}
  })
})

describe('finite native exception classification', () => {
  it.each([TypeError,RangeError,ReferenceError,SyntaxError,URIError,EvalError,Error])('classifies %s without trusting name', Constructor=>{
    const error=new Constructor('hidden')
    error.name=TOKEN
    expect(serializeException(error)).toEqual({type:Constructor.name,code:'UNKNOWN_ERROR'})
  })

  it('does not traverse nested AggregateError/cause', () => {
    const error=new AggregateError([new TypeError(TOKEN)],TOKEN)
    error.cause=error
    expect(serializeException(error)).toEqual({type:'AggregateError',code:'UNKNOWN_ERROR',hasCause:true})
  })

  it('uses UnknownError for unsupported subclasses, spoofed names and constructors', () => {
    class PrivateError extends Error {}
    expect(serializeException(new PrivateError(TOKEN))).toEqual({type:'UnknownError',code:'UNKNOWN_ERROR'})
    expect(serializeException({name:'TypeError',constructor:TypeError,message:TOKEN})).toEqual({type:'UnknownError',code:'UNKNOWN_ERROR'})
  })
})

describe('bounded migration diagnostics, no subprocess is run', () => {
  it.each([0,1,127,255])('preserves exit status %s and the fixed phase', status=>{
    const record=migrationDiagnostic('cli_exit',{status,stdout:TOKEN,stderr:TOKEN})
    expect(record.exit_status).toBe(status)
    expect(record.phase).toBe('cli_exit')
    expect(record.code).toBe(status===0?'MIGRATION_COMPLETED':'MIGRATION_PROCESS_FAILED')
    expect(JSON.stringify(record)).not.toContain(TOKEN)
  })

  it.each([-1,256,1.5,'1',null,NaN])('drops unsupported exit status %s', status=>{
    expect(migrationDiagnostic('cli_exit',{status}).exit_status).toBeUndefined()
  })

  it.each(['SIGTERM','SIGKILL','SIGINT'])('preserves approved signal %s',signal=>{
    expect(migrationDiagnostic('cli_exit',{signal}).signal).toBe(signal)
  })

  it('keeps only known codes/signals/phases; excludes all error text', () => {
    const error=Object.assign(new Error(TOKEN),{code:'ENOENT',cause:new Error(TOKEN)})
    const record=migrationDiagnostic('cli_spawn',{error,status:null,signal:TOKEN,stdout:TOKEN,stderr:TOKEN})
    expect(record).toMatchObject({phase:'cli_spawn',code:'ENOENT',error:{type:'Error',code:'ENOENT',hasCause:true}})
    expect(record.signal).toBeUndefined()
    expect(JSON.stringify(record)).not.toContain(TOKEN)
    expect(migrationDiagnostic(TOKEN,{status:1}).phase).toBe('configuration')
  })

  it('does not execute getters on a foreign subprocess result', () => {
    const getter=vi.fn(()=>{throw Error('must not run')})
    const result={}
    for(const field of ['status','signal','error','stdout','stderr']) Object.defineProperty(result,field,{get:getter})
    expect(migrationDiagnostic('cli_exit',result)).toEqual({phase:'cli_exit',code:'MIGRATION_PROCESS_FAILED'})
    expect(getter).not.toHaveBeenCalled()
  })
})

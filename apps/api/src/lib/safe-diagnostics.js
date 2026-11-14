import { ErrorCodes } from '@busway-kg/contracts'
import { trustedLogFields, currentLogFields, withTrustedLogContext } from './log-context.js'
import { types } from 'node:util'
import { problemsFromIssued, problemsFromLogLine } from './config-diagnostics.js'

const KNOWN_CODES = new Set([
  ...Object.values(ErrorCodes),
  'UNKNOWN_ERROR', 'CONFIG_ERROR',
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE', 'EADDRINUSE', 'EACCES',
  'ENOENT', 'ENOMEM', 'E2BIG', 'EIO',
  '23502', '23503', '23505', '23514', '23000', '42501', '28P01', '3D000',
  '08001', '08006', '53300', '57P01', '57014', '42P01', '0A000',
  'FST_ERR_CTP_BODY_TOO_LARGE', 'FST_ERR_CTP_INVALID_JSON_BODY',
  'FST_ERR_CTP_INVALID_MEDIA_TYPE', 'FST_ERR_VALIDATION',
])
const HTTP_STATUSES = new Set([400,401,403,404,409,413,415,429,500,502,503,504])
const ERROR_CLASSES = [TypeError,RangeError,ReferenceError,SyntaxError,URIError,EvalError,AggregateError,Error]
// Track our own serializations without trusting a forged {type: ...} object.
const safeExceptions = new WeakSet()

function errorClass(value) {
  try {
    if (!types.isNativeError(value)) return 'UnknownError'
    const prototype = Object.getPrototypeOf(value)
    for (const constructor of ERROR_CLASSES) if (prototype === constructor.prototype) return constructor.name
  } catch { /* Unknown/proxy/custom subclasses get no trusted classification. */ }
  return 'UnknownError'
}

/** Never invoke getters/toJSON/toString on an untrusted thrown value. */
function own(value, key) {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return undefined
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
  } catch { return undefined }
}

export function safeCode(value) {
  return typeof value === 'string' && KNOWN_CODES.has(value) ? value : 'UNKNOWN_ERROR'
}

/** A fresh plain object: never retain the original exception, cause or stack. */
export function serializeException(error) {
  if (safeExceptions.has(error)) return error
  const safe = { type: errorClass(error), code: safeCode(own(error, 'code')) }
  const status = own(error, 'statusCode')
  if (HTTP_STATUSES.has(status)) safe.statusCode = status
  if (own(error, 'cause') !== undefined || own(error, 'hasCause') === true) safe.hasCause = true
  // Only a list issued by createDiagnostics() is trusted; a forged or copied `diagnostics`
  // property yields nothing. The result is "VARIABLE: reason" strings from a fixed vocabulary.
  const problems = problemsFromIssued(own(error, 'diagnostics'))
  if (problems.length > 0) safe.problems = Object.freeze(problems)
  safeExceptions.add(safe)
  return Object.freeze(safe)
}

/** Only server-issued capabilities are accepted. No object fields are inspected. */
export function safeLogContext(context) {
  return trustedLogFields(context)
}

export const DIAGNOSTIC_EVENTS = Object.freeze({
  unhandled_error: 'unhandled error',
  database_unavailable: 'database readiness check failed',
  database_pool_error: 'idle database client error',
  startup_failed: 'failed to start',
  configuration_invalid: 'invalid configuration',
  shutdown_failed: 'shutdown failed',
  process_failure: 'process failure',
})
const SAFE_MESSAGES = new Set([
  ...Object.values(DIAGNOSTIC_EVENTS),
  'incoming request', 'request completed', 'shutting down', 'diagnostic event',
])

export function safeLogMessage(value) {
  return typeof value === 'string' && SAFE_MESSAGES.has(value) ? value : 'diagnostic event'
}

/** Allowlist for all Pino records, including nonstandard/nested error objects. */
export function sanitizeLogRecord(value) {
  const result = {}
  let isError = false
  try { isError = value instanceof Error } catch { /* Proxy with a throwing trap. */ }
  if (isError) result.err = serializeException(value)
  for (const key of ['err','error']) {
    const error = own(value, key)
    if (error !== undefined) result[key] = serializeException(error)
  }
  const code = own(value, 'code')
  if (code !== undefined) result.code = safeCode(code)
  const statusCode = own(value, 'statusCode')
  if (HTTP_STATUSES.has(statusCode) || statusCode === 200) result.statusCode = statusCode
  const responseTime = own(value, 'responseTime')
  if (typeof responseTime === 'number' && Number.isFinite(responseTime) && responseTime >= 0 && responseTime <= 3_600_000) {
    result.responseTime = Math.round(responseTime)
  }
  const signal = own(value, 'signal')
  if (signal === 'SIGINT' || signal === 'SIGTERM') result.signal = signal
  // req/res/body/headers/url and arbitrary objects are intentionally not retained.
  return result
}

export function logSafeException(logger, error, event, context) {
  const message = Object.hasOwn(DIAGNOSTIC_EVENTS, event) ? DIAGNOSTIC_EVENTS[event] : 'diagnostic event'
  withTrustedLogContext(context, () => logger.error({ err: serializeException(error) }, message))
}

/** Final boundary: Pino does not inherit bindings formatters for plain children.
 * Filter the actual JSON line too, so child bindings cannot bypass the allowlist.
 */
export function sanitizeLogLine(line) {
  try {
    const record = JSON.parse(line)
    const safe = sanitizeLogRecord(record)
    // JSON is no longer an object capability. Only retain a fixed error class
    // emitted by our serializer; never take identifiers from parsed log fields.
    for (const key of ['err','error']) {
      if (safe[key]) {
        const type = own(record[key], 'type')
        const allowed = ['Error','TypeError','RangeError','ReferenceError','SyntaxError','URIError','EvalError','AggregateError','UnknownError']
        const next = { ...safe[key], type: allowed.includes(type) ? type : 'UnknownError' }
        // Re-validate the already serialised text against the fixed vocabulary; no provenance
        // is needed here because nothing outside the vocabulary can survive.
        const problems = problemsFromLogLine(own(record[key], 'problems'))
        if (problems.length > 0) next.problems = problems
        safe[key] = next
      }
    }
    const level = [10,20,30,40,50,60].includes(record.level) ? record.level : 50
    const output = { level }
    if (typeof record.time === 'number' && Number.isFinite(record.time)) output.time = record.time
    return `${JSON.stringify({ ...output, ...safe, ...currentLogFields(), msg: safeLogMessage(record.msg) })}\n`
  } catch {
    return '{"level":50,"code":"UNKNOWN_ERROR","msg":"diagnostic event"}\n'
  }
}

const EXIT_SIGNALS = new Set(['SIGINT','SIGTERM','SIGKILL','SIGABRT','SIGSEGV','SIGBUS','SIGHUP','SIGQUIT','SIGPIPE'])
const MIGRATION_PHASES = new Set(['configuration','test_migration','cli_spawn','cli_exit'])

/** No stdout/stderr/message fields; only bounded subprocess diagnostics. */
export function migrationDiagnostic(phase, result) {
  const diagnostic = {
    phase: MIGRATION_PHASES.has(phase) ? phase : 'configuration',
  }
  const error = own(result,'error')
  if (error !== undefined) diagnostic.error = serializeException(error)
  const status = own(result,'status')
  diagnostic.code = error !== undefined ? safeCode(own(error,'code'))
    : status === 0 ? 'MIGRATION_COMPLETED' : 'MIGRATION_PROCESS_FAILED'
  if (Number.isInteger(status) && status >= 0 && status <= 255) diagnostic.exit_status = status
  const signal = own(result,'signal')
  if (typeof signal === 'string' && EXIT_SIGNALS.has(signal)) diagnostic.signal = signal
  return diagnostic
}

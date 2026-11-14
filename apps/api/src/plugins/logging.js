import { sanitizeLogRecord, serializeException, safeLogMessage, safeLogContext, sanitizeLogLine } from '../lib/safe-diagnostics.js'
import pino from 'pino'
import { isTrustedLogContext, trustedLogFields, withTrustedLogContext } from '../lib/log-context.js'

/**
 * Secrets must never reach the logs (SECURITY.md). pino censors these paths.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'req.headers["x-internal-secret"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'headers["x-csrf-token"]',
  'headers["x-internal-secret"]',
  'password',
  'passwordHash',
  'token',
  'secret',
  'databaseUrl',
  'connectionString',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.secret',
  '*.databaseUrl',
  '*.connectionString',
]

/**
 * @param {{ logLevel: string }} config
 * @param {import('node:stream').Writable} [stream] destination, for tests
 */
export function buildLoggerOptions(config, stream) {
  const options = {
    level: config.logLevel,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    // Hooks also cover Error-first calls, raw strings and printf interpolation.
    // No submitted string can become a log message unless explicitly allowlisted.
    hooks: {
      streamWrite: sanitizeLogLine,
      logMethod(args, method) {
        const message = typeof args[0] === 'string' ? args[0] : args[1]
        method.call(this, sanitizeLogRecord(args[0]), safeLogMessage(message))
      },
    },
    formatters: {
      bindings: safeLogContext,
      log: sanitizeLogRecord,
    },
    serializers: { err: serializeException, error: serializeException },
  }
  if (stream) options.stream = stream
  return options
}

/** Application boundary: do not expose raw Pino or pass unknown bindings to it.
 * Third-party direct Pino use is not covered by this facade's getter guarantee.
 */
export function createSafeLogger(config, stream) {
  const raw = pino(buildLoggerOptions(config), stream)
  const levels = new Set(['fatal','error','warn','info','debug','trace','silent'])
  function facade(context) {
    const logger = Object.create(null)
    for (const level of levels) {
      logger[level] = (...args) => withTrustedLogContext(context, () => raw[level](...args))
    }
    // Never inspect bindings, enumerate keys, invoke getters or call raw.child().
    logger.child = (bindings) => facade(isTrustedLogContext(bindings) ? bindings : context)
    logger.bindings = () => trustedLogFields(context)
    logger.isLevelEnabled = (level) => levels.has(level) && raw.isLevelEnabled(level)
    logger.flush = (...args) => raw.flush(...args)
    Object.defineProperty(logger, 'level', {
      get: () => raw.level,
      set: (level) => {
        if (!levels.has(level)) throw new TypeError('Unsupported log level')
        raw.level = level
      },
    })
    return Object.freeze(logger)
  }
  return facade()
}

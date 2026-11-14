/**
 * Fixed-vocabulary diagnostics for configuration errors.
 *
 * An operator needs to know WHICH setting was refused and WHY, but never the value.
 * A diagnostic is therefore a pair of constants: a variable name from CONFIG_VARIABLES and a
 * reason code from CONFIG_REASONS. Nothing else (no value, message, stack, URL) can be
 * expressed, and free text is dropped rather than escaped.
 *
 * Provenance: arrays are issued only by createDiagnostics() and remembered in a private
 * WeakSet. An error object that merely carries a `diagnostics` property (forged, copied or
 * built from a request) is not trusted by the logger.
 */
export const CONFIG_VARIABLES = Object.freeze([
  'DATABASE_URL', 'DB_POOL_MAX', 'NODE_ENV', 'HOST', 'PORT', 'LOG_LEVEL', 'PGREPLICATION',
])

export const CONFIG_REASONS = Object.freeze([
  'missing', 'empty', 'invalid', 'malformed', 'unexpected_parameters',
  'scheme', 'host', 'port', 'database', 'test_database', 'user', 'password',
  'out_of_range', 'same_connection', 'non_loopback',
  'unsafe_driver_env', 'no_production_profile',
])

const VARIABLES = new Set(CONFIG_VARIABLES)
const REASONS = new Set(CONFIG_REASONS)
const MAX_PROBLEMS = 16
const issued = new WeakSet()

export function isAllowedProblem(variable, reason) {
  return typeof variable === 'string' && typeof reason === 'string' && VARIABLES.has(variable) && REASONS.has(reason)
}

export function formatProblem(variable, reason) {
  return `${variable}: ${reason}`
}

/**
 * Builds and registers an immutable list of validated {variable, reason} pairs.
 * Pairs outside the vocabulary are dropped (tests assert none is dropped for real scenarios).
 * @param {Array<{variable: string, reason: string}>} pairs
 */
export function createDiagnostics(pairs) {
  const seen = new Set()
  const list = []
  for (const pair of Array.isArray(pairs) ? pairs : []) {
    const variable = pair?.variable
    const reason = pair?.reason
    if (!isAllowedProblem(variable, reason)) continue
    const text = formatProblem(variable, reason)
    if (seen.has(text) || list.length >= MAX_PROBLEMS) continue
    seen.add(text)
    list.push(Object.freeze({ variable, reason }))
  }
  const diagnostics = Object.freeze(list)
  issued.add(diagnostics)
  return diagnostics
}

/** Strings for the log, only from an array issued by createDiagnostics(). */
export function problemsFromIssued(value) {
  if (typeof value !== 'object' || value === null || !issued.has(value)) return []
  return value.map((pair) => formatProblem(pair.variable, pair.reason))
}

/**
 * Second pass over an already serialised log line: only exact "VARIABLE: reason" strings
 * from the vocabulary survive; any other text is discarded.
 */
export function problemsFromLogLine(value) {
  if (!Array.isArray(value)) return []
  const result = []
  for (const item of value.slice(0, MAX_PROBLEMS)) {
    if (typeof item !== 'string') continue
    const index = item.indexOf(': ')
    if (index <= 0) continue
    const variable = item.slice(0, index)
    const reason = item.slice(index + 2)
    if (isAllowedProblem(variable, reason) && item === formatProblem(variable, reason) && !result.includes(item)) {
      result.push(item)
    }
  }
  return result
}

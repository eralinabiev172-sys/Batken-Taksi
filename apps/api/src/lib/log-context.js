import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'

const contexts = new WeakMap()
const storage = new AsyncLocalStorage()

/** Infrastructure-only capability. No caller-supplied identifiers are accepted. */
export function createServerLogContext() {
  const capability = Object.freeze(Object.create(null))
  contexts.set(capability, Object.freeze({ request_id: randomUUID(), correlation_id: randomUUID() }))
  return capability
}

export function isTrustedLogContext(value) {
  return contexts.has(value)
}

/** Returning a copy does NOT give that copy the authority of the capability. */
export function trustedLogFields(context) {
  return { ...contexts.get(context) }
}

export function withTrustedLogContext(context, operation) {
  return contexts.has(context) ? storage.run(context, operation) : operation()
}

export function currentLogFields() {
  return trustedLogFields(storage.getStore())
}

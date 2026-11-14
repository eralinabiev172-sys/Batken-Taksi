import { randomBytes, randomUUID } from 'node:crypto'
import { PUBLIC_ID_PATTERN } from '@busway-kg/contracts'

const PREFIX_PATTERN = /^[a-z]{2,8}$/
const PUBLIC_ID_REGEX = new RegExp(PUBLIC_ID_PATTERN)

/** Internal primary key (D-107). Never exposed through public APIs. */
export function newInternalId() {
  return randomUUID()
}

/** Opaque public identifier: "<prefix>_<22 base64url chars>" (128 random bits). */
export function newPublicId(prefix) {
  if (!PREFIX_PATTERN.test(prefix)) throw new TypeError('Public id prefix must be 2-8 lowercase letters')
  return `${prefix}_${randomBytes(16).toString('base64url')}`
}

export function isPublicId(value) {
  return typeof value === 'string' && PUBLIC_ID_REGEX.test(value)
}

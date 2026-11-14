import argon2 from 'argon2'

// Argon2id (D-105). Parameters chosen per OWASP guidance; tune by measurement before production.
const ARGON2_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
})

export async function hashPassword(plain) {
  if (typeof plain !== 'string' || plain.length === 0) throw new TypeError('password must be a non-empty string')
  return argon2.hash(plain, ARGON2_OPTIONS)
}

export async function verifyPassword(plain, hash) {
  if (typeof plain !== 'string' || typeof hash !== 'string') return false
  try {
    return await argon2.verify(hash, plain, ARGON2_OPTIONS)
  } catch {
    return false
  }
}
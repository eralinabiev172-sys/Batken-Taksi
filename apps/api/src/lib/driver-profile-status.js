/** Pure state rule matching driver_profiles_sync_active in migration 0003.
 * This is not authorisation: administrative approval and sessions belong to 3.2.
 */
export const DRIVER_STATUSES = Object.freeze(['pending', 'active', 'suspended'])

export function deriveDriverState(next = {}, previous) {
  const status = Object.hasOwn(next, 'status') ? next.status : (previous?.status ?? 'pending')
  if (!DRIVER_STATUSES.includes(status)) throw new TypeError('Invalid driver profile status')
  if (previous && status === previous.status && Object.hasOwn(next, 'is_active') && next.is_active !== previous.is_active) {
    throw new TypeError('is_active is derived from status')
  }
  return { status, is_active: status === 'active' }
}

// Reconciliation & grant expiry helpers (Stage 3.2.8).
// Traccar is emulated by a fixture provider; real HTTP calls are out of scope here.

export async function expireGrants(pool) {
  const { rowCount } = await pool.query(
    `update public_visibility_grants set disabled_at = now(), disabled_reason = 'expired'
      where disabled_at is null and expires_at <= now()`,
  )
  return rowCount ?? 0
}

export async function markStaleLiveStates(pool, staleAfterSec = 60) {
  const { rowCount } = await pool.query(
    `update vehicle_live_states set freshness = 'offline', updated_at = now()
      where freshness <> 'offline' and measured_at < now() - ($1 || ' seconds')::interval`,
    [String(staleAfterSec)],
  )
  return rowCount ?? 0
}

export async function runReconciliation(pool) {
  const expired = await expireGrants(pool)
  const stale = await markStaleLiveStates(pool)
  return { expiredGrants: expired, staleStates: stale }
}
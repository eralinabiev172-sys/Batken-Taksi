// Thin fetch wrapper for the real BusWay KG API (Stage 3.2.10).
// Mock adapter remains the default; real mode is opt-in via VITE_USE_REAL_API=true.
export const API_BASE = (import.meta.env?.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')

export async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })
  if (!res.ok) {
    let body = null
    try { body = await res.json() } catch { /* ignore */ }
    const err = new Error(body?.error?.message || `HTTP ${res.status}`)
    err.status = res.status
    err.code = body?.error?.code
    err.requestId = body?.error?.requestId
    throw err
  }
  if (res.status === 204) return null
  return res.json()
}

export const realApi = {
  health: () => apiFetch('/health'),
  me: () => apiFetch('/auth/me'),
  login: (email, password) => apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => apiFetch('/auth/logout', { method: 'POST' }),
}
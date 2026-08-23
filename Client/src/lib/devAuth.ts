// ─────────────────────────────────────────────────────────────────────────────
// DEV-ONLY LOGIN BYPASS
//
// Temporary shim so development can continue while the real database is down.
// Every function here is gated behind `import.meta.env.DEV`, which Vite hard-codes
// to `false` in a production build (`vite build`) and tree-shakes out — so this
// bypass CANNOT exist in production. It performs no network or DB calls.
//
// Remove this file (and its two call sites in App.tsx / pages/login.tsx) once the
// database is back and real auth works.
// ─────────────────────────────────────────────────────────────────────────────

import type { AuthUser } from './api'

export const DEV_BYPASS_EMAIL = 'dev@leadops.local'
export const DEV_BYPASS_PASSWORD = 'devmode123'

const DEV_SESSION_FLAG = 'leadops_dev_session'

export const DEV_USER: AuthUser = { id: 'dev-user', email: DEV_BYPASS_EMAIL, role: 'admin' }

/** True only in a dev build AND when the dev bypass credentials are entered. */
export function isDevBypass(email: string, password: string): boolean {
  return import.meta.env.DEV && email === DEV_BYPASS_EMAIL && password === DEV_BYPASS_PASSWORD
}

// sessionStorage, not localStorage — see the note in lib/api.ts. Keeps a dev
// session scoped to one tab instead of leaking into every new tab.
export function startDevSession(): void {
  sessionStorage.setItem(DEV_SESSION_FLAG, '1')
}

/** True only in a dev build AND when a dev session was previously started. */
export function hasDevSession(): boolean {
  return import.meta.env.DEV && sessionStorage.getItem(DEV_SESSION_FLAG) === '1'
}

export function endDevSession(): void {
  sessionStorage.removeItem(DEV_SESSION_FLAG)
}

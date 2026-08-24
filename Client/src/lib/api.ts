import { hasDevSession } from './devAuth'

export type Role = 'admin' | 'employee'
export type AuthUser = { id: string; email: string; role?: Role }
export type AuthResponse = { accessToken: string; user: AuthUser }

// ─── Reference / lookup entities ─────────────────────────────────────────────
export type Location = { id: string; city: string; state: string | null; country: string | null; address: string | null; createdAt: string; updatedAt: string }
export type Plant = { id: string; plantName: string; companyName: string | null; locationId: string; plantCode: string | null; isActive: boolean; location?: { id: string; city: string; state: string | null }; createdAt: string; updatedAt: string }
export type Contact = { id: string; plantId: string; contactPersonName: string; designation: string | null; contactPersonNumber: string | null; alternateNumber: string | null; mailId: string | null; isPrimaryContact: boolean; createdAt: string; updatedAt: string }
export type Vertical = { id: string; verticalName: string; description: string | null; isActive: boolean }
export type Sector = { id: string; sectorName: string; description: string | null; isActive: boolean }
export type LeadStatus = { id: string; statusName: string; statusCategory: string | null; displayOrder: number; isActive: boolean }
export type EmployeeUser = { id: string; userName: string | null; email: string; role: string; department: string | null; phoneNumber: string | null; isActive: boolean }

// ─── Lead (main entity, with joined display data) ────────────────────────────
export type Lead = {
  id: string
  plantId: string
  plant?: { id: string; plantName: string; companyName: string | null; plantCode: string | null; location?: { id: string; city: string; state: string | null; country: string | null; address: string | null } }
  verticalId: string | null
  vertical?: { id: string; verticalName: string } | null
  sectorId: string | null
  sector?: { id: string; sectorName: string } | null
  contactId: string | null
  contact?: { id: string; contactPersonName: string; designation: string | null; contactPersonNumber: string | null; alternateNumber: string | null; mailId: string | null; isPrimaryContact: boolean } | null
  assignedToUserId: string | null
  assignedToUser?: { id: string; userName: string | null; email: string } | null
  assignedByUserId: string | null
  assignedByUser?: { id: string; userName: string | null; email: string } | null
  statusId: string | null
  status?: { id: string; statusName: string; statusCategory: string | null } | null
  remark: string | null
  createdByUserId: string
  createdByUser?: { id: string; userName: string | null; email: string }
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

// ─── Task (admin-assigned to-do, independent of any lead) ───────────────────
export type Task = {
  id: string
  title: string
  description: string | null
  deadline: string
  status: string
  assignedToUserId: string
  assignedToUser?: { id: string; userName: string | null; email: string }
  assignedByUserId: string
  assignedByUser?: { id: string; userName: string | null; email: string }
  createdAt: string
  updatedAt: string
}

// Base URL of the backend. Override with VITE_API_URL in a .env file if needed.
export const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export type Notification = { id: string; userId: string; leadId: string | null; message: string; isRead: boolean; createdAt: string }

// Fired on `window` whenever a lead is created/updated/deleted by anyone —
// either because this user got a personal notification about it, or because
// the backend broadcast a public "lead changed" ping over the same SSE
// stream (see NotificationBell) — so any open leads list can resync that one
// lead without the viewer refreshing. detail: { leadId: string }
export const LEAD_SYNC_EVENT = 'leadops:lead-sync'

// Same idea as LEAD_SYNC_EVENT, for tasks. detail: { taskId: string }
export const TASK_SYNC_EVENT = 'leadops:task-sync'

const TOKEN_KEY = 'leadops_token'

// sessionStorage (not localStorage) — scoped to this one tab, so opening the
// app in a new tab always starts logged out instead of silently inheriting
// whatever's already signed in elsewhere. Still survives a refresh of the tab.
export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY)
}

// DEV-ONLY self-heal: mint a real access token via the dev-login endpoint.
// Returns true if a token was obtained. Needs the backend + DB to be up.
async function acquireDevToken(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
    if (!res.ok) return false
    const d = (await res.json()) as { accessToken?: string }
    if (d.accessToken) { setToken(d.accessToken); return true }
  } catch { /* backend/DB unavailable */ }
  return false
}

/**
 * Thin fetch wrapper. Sends/receives JSON, attaches the bearer token when present,
 * and throws an Error carrying the backend's `error` message on any non-2xx response.
 * In a dev session it auto-acquires a token when missing/expired so authenticated
 * calls recover automatically once the backend + database are reachable.
 */
export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {},
  retried = false,
): Promise<T> {
  const { method = 'GET', body, auth = false } = options

  // Auth requested but no token yet — in a dev session, try to mint one first.
  if (auth && !getToken() && hasDevSession()) await acquireDevToken()

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (auth) {
    const token = getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
  }

  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    // Network error / server not running
    throw new Error('Cannot reach the server. Please try again.')
  }

  // Token missing/expired — in a dev session, refresh it once and retry.
  if (res.status === 401 && auth && !retried && hasDevSession()) {
    if (await acquireDevToken()) return api<T>(path, options, true)
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? 'Something went wrong. Please try again.')
  }
  return data as T
}

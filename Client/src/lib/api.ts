import { hasDevSession } from './devAuth'

export type Role = 'admin' | 'employee'
export type AuthUser = { id: string; email: string; role?: Role }
export type AuthResponse = { accessToken: string; user: AuthUser }

// ─── Reference / lookup entities ─────────────────────────────────────────────
export type Location = { id: string; city: string; state: string | null; country: string | null; address: string | null; createdAt: string; updatedAt: string }
export type ClientCategory = { id: string; categoryName: string; description: string | null; isActive: boolean }
export type Client = { id: string; clientName: string; industryType: string | null; website: string | null; linkedIn: string | null; categoryId: string | null; category?: { id: string; categoryName: string } | null; country: string | null; region: string | null; isActive: boolean }
export type Plant = { id: string; plantName: string; companyName: string | null; clientId: string | null; client?: { id: string; clientName: string } | null; locationId: string; plantCode: string | null; isActive: boolean; location?: { id: string; city: string; state: string | null }; createdAt: string; updatedAt: string }
export type Contact = { id: string; plantId: string; contactPersonName: string; designation: string | null; contactPersonNumber: string | null; alternateNumber: string | null; mailId: string | null; isPrimaryContact: boolean; createdAt: string; updatedAt: string }
export type Vertical = { id: string; verticalName: string; description: string | null; isActive: boolean }
export type Sector = { id: string; sectorName: string; description: string | null; isActive: boolean }
export type LeadSource = { id: string; sourceName: string; description: string | null; isActive: boolean }
export type ServiceType = { id: string; serviceTypeName: string; description: string | null; isActive: boolean }
export type LeadStatus = { id: string; statusName: string; statusCategory: string | null; displayOrder: number; isActive: boolean }
export const EVENT_TYPES = ['Expo', 'Visit'] as const
export type EventType = (typeof EVENT_TYPES)[number]
export type Event = { id: string; eventName: string; eventType: string; eventDate: string | null; leadsGenerated: number; createdAt: string }
export type EmployeeUser = { id: string; userName: string | null; email: string; role: string; department: string | null; phoneNumber: string | null; isActive: boolean }

// ─── Lead (main entity, with joined display data) ────────────────────────────
export type Lead = {
  id: string
  plantId: string
  plant?: { id: string; plantName: string; companyName: string | null; plantCode: string | null; client?: { id: string; clientName: string } | null; location?: { id: string; city: string; state: string | null; country: string | null; address: string | null } }
  verticalId: string | null
  vertical?: { id: string; verticalName: string } | null
  sectorId: string | null
  sector?: { id: string; sectorName: string } | null
  sourceId: string | null
  source?: { id: string; sourceName: string } | null
  serviceTypeId: string | null
  serviceType?: { id: string; serviceTypeName: string } | null
  eventId: string | null
  event?: { id: string; eventName: string } | null
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

// ─── Activity (call/visit/meeting/mail logged against a lead) ───────────────
export const ACTIVITY_TYPES = ['Call', 'Visit', 'Meeting', 'Mail', 'Proposal'] as const
export type ActivityType = (typeof ACTIVITY_TYPES)[number]
export type Activity = {
  id: string
  leadId: string
  lead?: { id: string; plant?: { id: string; plantName: string } }
  userId: string
  user?: { id: string; userName: string | null; email: string }
  activityType: string
  activityDate: string
  notes: string | null
  nextActionDate: string | null
  createdAt: string
  updatedAt: string
}

// ─── Proposal (a quoted opportunity raised against a lead) ──────────────────
export const PROPOSAL_STATUSES = ['Draft', 'Submitted', 'Follow-up', 'Negotiation', 'Won', 'Lost', 'Hold'] as const
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number]
export type Proposal = {
  id: string
  proposalNumber: string
  leadId: string
  lead?: { id: string; plant?: { id: string; plantName: string; client?: { id: string; clientName: string } | null } }
  projectName: string | null
  value: number | null
  submissionDate: string | null
  status: string
  probabilityPct: number | null
  expectedOrderDate: string | null
  createdByUserId: string
  createdByUser?: { id: string; userName: string | null; email: string }
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

// ─── Project / Work Order (post-order execution tracking) ───────────────────
export const PROJECT_STATUSES = ['Not Started', 'In Progress', 'On Hold', 'Completed'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]
export const BILLING_STAGES = ['Not Started', 'Advance Received', 'Partial Billing', 'Final Billing', 'Fully Billed'] as const
export type BillingStage = (typeof BILLING_STAGES)[number]
export type Project = {
  id: string
  workOrderNo: string
  proposalId: string | null
  proposal?: { id: string; proposalNumber: string } | null
  leadId: string
  lead?: { id: string; plant?: { id: string; plantName: string; client?: { id: string; clientName: string } | null } }
  projectName: string
  locationId: string | null
  location?: { id: string; city: string; state: string | null } | null
  startDate: string | null
  completionDate: string | null
  responsibleUserId: string | null
  responsibleUser?: { id: string; userName: string | null; email: string } | null
  status: string
  billingStage: string
  createdByUserId: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

// ─── Document (a PDF uploaded against a lead, stored on the server's local disk) ──
export type LeadDocument = {
  id: string
  leadId: string
  fileName: string
  fileSize: number
  createdAt: string
  uploadedByUser?: { id: string; userName: string | null; email: string }
}

// ─── Invoice / Payment (billing against a project) ───────────────────────────
export const INVOICE_STATUSES = ['Draft', 'Sent', 'Partially Paid', 'Paid', 'Overdue'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]
export type Payment = {
  id: string
  invoiceId: string
  amountReceived: number
  paymentDate: string
  notes: string | null
  recordedByUser?: { id: string; userName: string | null; email: string }
  createdAt: string
}
export type Invoice = {
  id: string
  invoiceNumber: string
  projectId: string
  project?: { id: string; workOrderNo: string; projectName: string; lead?: { id: string; plant?: { id: string; plantName: string; client?: { id: string; clientName: string } | null } } }
  amount: number
  invoiceDate: string | null
  dueDate: string | null
  status: string
  payments: Payment[]
  createdAt: string
  updatedAt: string
}

// ─── Empanelment / Tender (client-relationship-level, not tied to a lead) ────
export const EMPANELMENT_STATUSES = ['Applied', 'Under Review', 'Empanelled', 'Rejected', 'Expired'] as const
export type EmpanelmentStatus = (typeof EMPANELMENT_STATUSES)[number]
export type Empanelment = {
  id: string
  clientId: string
  client?: { id: string; clientName: string }
  serviceTypeId: string | null
  serviceType?: { id: string; serviceTypeName: string } | null
  status: string
  renewalDate: string | null
  createdByUser?: { id: string; userName: string | null; email: string }
  createdAt: string
  updatedAt: string
}

export const TENDER_STATUSES = ['Identified', 'Preparing', 'Submitted', 'Under Evaluation', 'Won', 'Lost'] as const
export type TenderStatus = (typeof TENDER_STATUSES)[number]
export type Tender = {
  id: string
  tenderNo: string
  clientId: string
  client?: { id: string; clientName: string }
  submissionDate: string | null
  value: number | null
  status: string
  createdByUser?: { id: string; userName: string | null; email: string }
  createdAt: string
  updatedAt: string
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

// Same idea as LEAD_SYNC_EVENT, for activities. detail: { leadId: string }
export const ACTIVITY_SYNC_EVENT = 'leadops:activity-sync'

// Same idea as LEAD_SYNC_EVENT, for proposals. detail: { proposalId: string }
export const PROPOSAL_SYNC_EVENT = 'leadops:proposal-sync'

// Same idea as LEAD_SYNC_EVENT, for projects. detail: { projectId: string }
export const PROJECT_SYNC_EVENT = 'leadops:project-sync'

// Same idea as LEAD_SYNC_EVENT, for invoices. detail: { invoiceId: string }
export const INVOICE_SYNC_EVENT = 'leadops:invoice-sync'

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

// Multipart upload — bypasses `api()`'s JSON body since the browser needs to
// set its own multipart boundary in Content-Type.
export async function uploadDocument(leadId: string, file: File): Promise<LeadDocument> {
  const token = getToken()
  const formData = new FormData()
  formData.append('leadId', leadId)
  formData.append('file', file)
  const res = await fetch(`${BASE_URL}/documents`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Could not upload document.')
  return (data as { document: LeadDocument }).document
}

// Fetches the PDF as a blob (auth header required) and triggers a browser
// download with the document's original filename.
export async function downloadDocument(id: string, fileName: string): Promise<void> {
  const token = getToken()
  const res = await fetch(`${BASE_URL}/documents/${id}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  if (!res.ok) throw new Error('Could not download document.')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = window.document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

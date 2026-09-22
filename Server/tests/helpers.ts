export const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:3000'

// Seeded by prisma/seed.ts — a real non-admin account used throughout this
// project's manual Phase 1-3 verification too.
const EMPLOYEE_EMAIL = 'arjun.mehta@leadops.local'
const EMPLOYEE_PASSWORD = 'demo123'

let adminTokenCache: string | undefined
let employeeTokenCache: string | undefined

export async function adminToken(): Promise<string> {
  if (adminTokenCache) return adminTokenCache
  const res = await fetch(`${BASE_URL}/auth/dev-login`, { method: 'POST' })
  if (!res.ok) {
    throw new Error(
      `Could not get an admin token via /auth/dev-login (${res.status}). ` +
      `Is ENABLE_DEV_LOGIN="true" set in Server/.env?`
    )
  }
  const data = (await res.json()) as { accessToken: string }
  adminTokenCache = data.accessToken
  return adminTokenCache
}

export async function employeeToken(): Promise<string> {
  if (employeeTokenCache) return employeeTokenCache
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMPLOYEE_EMAIL, password: EMPLOYEE_PASSWORD }),
  })
  if (!res.ok) {
    throw new Error(
      `Could not log in as the seeded employee ${EMPLOYEE_EMAIL} (${res.status}). ` +
      `Has \`npm run db:seed\` been run against this database?`
    )
  }
  const data = (await res.json()) as { accessToken: string }
  employeeTokenCache = data.accessToken
  return employeeTokenCache
}

type ApiOptions = { method?: string; token?: string; body?: unknown }

// Thin fetch wrapper matching the client's own `api()` helper in spirit:
// always returns the parsed body alongside the status, so tests can assert
// on either without a try/catch per call.
export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  const body = (await res.json().catch(() => ({}))) as T
  return { status: res.status, body }
}

// ─── fixtures ───────────────────────────────────────────────────────────────
// Every test file creates its own throwaway lead (and project, where needed)
// rather than depending on whatever real data happens to exist, and cleans
// up everything it created — same discipline used throughout this project's
// manual verification, just automated now.

export async function createTestLead(token: string, plantName: string): Promise<string> {
  const { status, body } = await api<{ lead: { id: string } }>('/leads', {
    method: 'POST',
    token,
    body: { plantName, city: 'Vitest City' },
  })
  if (status !== 201) throw new Error(`Failed to create test lead: ${JSON.stringify(body)}`)
  return body.lead.id
}

export async function createTestProject(token: string, leadId: string, projectName: string): Promise<string> {
  const { status, body } = await api<{ project: { id: string } }>('/projects', {
    method: 'POST',
    token,
    body: { leadId, projectName },
  })
  if (status !== 201) throw new Error(`Failed to create test project: ${JSON.stringify(body)}`)
  return body.project.id
}

export const deleteLead = (token: string, id: string) => api(`/leads/${id}`, { method: 'DELETE', token })
export const deleteProposal = (token: string, id: string) => api(`/proposals/${id}`, { method: 'DELETE', token })
export const deleteProject = (token: string, id: string) => api(`/projects/${id}`, { method: 'DELETE', token })
export const deleteInvoice = (token: string, id: string) => api(`/invoices/${id}`, { method: 'DELETE', token })
export const deleteUser = (token: string, id: string) => api(`/users/${id}`, { method: 'DELETE', token })
export const voidPayment = (token: string, invoiceId: string, paymentId: string) =>
  api(`/invoices/${invoiceId}/payments/${paymentId}`, { method: 'DELETE', token })

// Deleting an invoice soft-deletes the invoice row but leaves any payments
// under it untouched — harmless in the real app (a payment under a deleted
// invoice is permanently unreachable), but it does mean any test that logs a
// real payment must void it explicitly before deleting the invoice, or the
// database's active-payment count silently drifts from run to run. This
// wraps both steps together so that mistake can't happen again the way it
// did, twice, during this project's own manual verification.
export async function deleteInvoiceAndPayments(token: string, invoice: { id: string; payments: { id: string }[] }) {
  for (const payment of invoice.payments) await voidPayment(token, invoice.id, payment.id)
  await deleteInvoice(token, invoice.id)
}

export const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:3000'

let adminTokenCache: string | undefined
let employeeTokenCache: string | undefined

// There's no dev-login backdoor any more: the tests sign a short-lived token
// for a real active admin directly with the server's own JWT_SECRET (read
// from Server/.env), exactly as the server would after a password login —
// so no password ever needs to live in the code. TEST_ADMIN_EMAIL picks a
// specific admin; otherwise the earliest active admin is used.
export async function adminToken(): Promise<string> {
  if (adminTokenCache) return adminTokenCache
  const { config } = await import('dotenv')
  config()
  const [{ Client }, fs, jwt] = await Promise.all([import('pg'), import('fs'), import('jsonwebtoken')])
  const db = new Client({
    connectionString: (process.env.DATABASE_URL ?? '').replace(/[?&]sslmode=[^&]*/, ''),
    ssl: { ca: fs.readFileSync('./certs/aiven-ca.pem', 'utf8') },
  })
  await db.connect()
  try {
    const email = process.env.TEST_ADMIN_EMAIL
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM users WHERE role = 'admin' AND is_active ${email ? 'AND email = $1' : ''} ORDER BY created_at LIMIT 1`,
      email ? [email] : [],
    )
    if (!rows[0]) throw new Error(`No active admin found${email ? ` with email ${email}` : ''} to run the tests as.`)
    adminTokenCache = jwt.default.sign({ sub: rows[0].id }, process.env.JWT_SECRET!, { expiresIn: '30m' })
    return adminTokenCache
  } finally {
    await db.end()
  }
}

// Same approach as adminToken, for a real active non-admin user —
// TEST_EMPLOYEE_EMAIL picks one, otherwise the earliest active employee.
// (Logging in with a password no longer works for this: the seeded employee
// account was removed and sign-in is normally through Microsoft.)
export async function employeeToken(): Promise<string> {
  if (employeeTokenCache) return employeeTokenCache
  const { config } = await import('dotenv')
  config()
  const [{ Client }, fs, jwt] = await Promise.all([import('pg'), import('fs'), import('jsonwebtoken')])
  const db = new Client({
    connectionString: (process.env.DATABASE_URL ?? '').replace(/[?&]sslmode=[^&]*/, ''),
    ssl: { ca: fs.readFileSync('./certs/aiven-ca.pem', 'utf8') },
  })
  await db.connect()
  try {
    const email = process.env.TEST_EMPLOYEE_EMAIL
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM users WHERE role <> 'admin' AND is_active ${email ? 'AND email = $1' : ''} ORDER BY created_at LIMIT 1`,
      email ? [email] : [],
    )
    if (!rows[0]) throw new Error(`No active employee found${email ? ` with email ${email}` : ''} to run the tests as.`)
    employeeTokenCache = jwt.default.sign({ sub: rows[0].id }, process.env.JWT_SECRET!, { expiresIn: '30m' })
    return employeeTokenCache
  } finally {
    await db.end()
  }
}

// Runs one query straight against the test database — for cleanup that has
// no API (e.g. removing the notifications a test caused).
export async function dbQuery(sql: string, params: unknown[] = []): Promise<void> {
  const { config } = await import('dotenv')
  config()
  const [{ Client }, fs] = await Promise.all([import('pg'), import('fs')])
  const db = new Client({
    connectionString: (process.env.DATABASE_URL ?? '').replace(/[?&]sslmode=[^&]*/, ''),
    ssl: { ca: fs.readFileSync('./certs/aiven-ca.pem', 'utf8') },
  })
  await db.connect()
  try {
    await db.query(sql, params)
  } finally {
    await db.end()
  }
}

type ApiOptions ={ method?: string; token?: string; body?: unknown }

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

// Every project needs a responsible engineer (an active non-admin user) and
// start/completion dates — whichever employee exists is fine for tests.
export async function projectDetails(token: string): Promise<{ responsibleUserId: string; startDate: string; completionDate: string }> {
  const { body } = await api<{ users: { id: string; role: string; isActive: boolean }[] }>('/users', { token })
  const engineer = body.users.find(u => u.role !== 'admin' && u.isActive)
  if (!engineer) throw new Error('Tests need at least one active employee to assign projects to.')
  return { responsibleUserId: engineer.id, startDate: '2026-10-01', completionDate: '2026-10-31' }
}

export async function createTestProject(token: string, leadId: string, projectName: string): Promise<string> {
  const { status, body } = await api<{ project: { id: string } }>('/projects', {
    method: 'POST',
    token,
    body: { leadId, projectName, ...(await projectDetails(token)) },
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

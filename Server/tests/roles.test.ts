import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminToken, api, createTestLead, createTestProject, deleteLead, deleteProject, dbRows, leadOwners, tokenForEmail, createAccountsUser, removeAccountsUser } from './helpers'

type Project = { id: string; status: string; billingStage: string; billingHandoffAt: string | null }

// BD works leads → projects; Accounts take over once a project is completed.
describe('Roles: BD up to projects, Accounts for invoicing', () => {
  let admin: string
  let bd: string
  let accounts: { id: string; token: string }
  let leadId: string
  let projectId: string
  const projectsFor = async (token: string) => (await api<{ projects: Project[] }>('/projects', { token })).body.projects
  const handoff = async () => (await dbRows<{ billing_handoff_at: string | null }>('SELECT billing_handoff_at FROM projects WHERE id = $1', [projectId]))[0].billing_handoff_at

  beforeAll(async () => {
    admin = await adminToken()
    accounts = await createAccountsUser()
    bd = await tokenForEmail((await leadOwners(admin)).assignedToName)
    leadId = await createTestLead(admin, `Vitest Roles ${Date.now()}`)
    projectId = await createTestProject(admin, leadId, 'Vitest Roles Project')
  })

  afterAll(async () => {
    await deleteProject(admin, projectId)
    await deleteLead(admin, leadId)
    await removeAccountsUser(accounts.id)
  })

  it('keeps Accounts out of the sales side', async () => {
    expect((await api('/leads', { token: accounts.token })).status).toBe(403)
    expect((await api('/proposals', { token: accounts.token })).status).toBe(403)
    expect((await api('/projects', { method: 'POST', token: accounts.token, body: { leadId } })).status).toBe(403)
  })

  it('does not show Accounts a project until it is completed', async () => {
    expect((await projectsFor(accounts.token)).some(p => p.id === projectId)).toBe(false)
    expect((await api(`/projects/${projectId}`, { token: accounts.token })).status).toBe(404)
  })

  it('hands a completed project to Accounts and notifies them', async () => {
    const done = await api<{ project: Project }>(`/projects/${projectId}`, { method: 'PATCH', token: bd, body: { status: 'Completed' } })
    expect(done.status).toBe(200)
    expect(done.body.project.billingHandoffAt).toBeTruthy()
    expect(await handoff()).toBeTruthy()
    expect((await projectsFor(accounts.token)).some(p => p.id === projectId)).toBe(true)
    const { body } = await api<{ notifications: { message: string }[] }>('/notifications', { token: accounts.token })
    expect(body.notifications.some(n => n.message.includes('ready for invoicing'))).toBe(true)
  })

  it('lets Accounts raise the invoice and record payments, and BD only read', async () => {
    const created = await api<{ invoice: { id: string; status: string } }>('/invoices', { method: 'POST', token: accounts.token, body: { projectId, amount: 1000 } })
    expect(created.status).toBe(201)
    const id = created.body.invoice.id
    // BD sees it but cannot change it
    expect((await api<{ invoices: { id: string }[] }>('/invoices', { token: bd })).body.invoices.some(i => i.id === id)).toBe(true)
    expect((await api('/invoices', { method: 'POST', token: bd, body: { projectId, amount: 5 } })).status).toBe(403)
    expect((await api(`/invoices/${id}/payments`, { method: 'POST', token: bd, body: { amountReceived: 5 } })).status).toBe(403)
    // Accounts record the payment
    const paid = await api<{ invoice: { status: string; payments: { id: string }[] } }>(`/invoices/${id}/payments`, { method: 'POST', token: accounts.token, body: { amountReceived: 1000 } })
    expect(paid.status).toBe(201)
    expect(paid.body.invoice.status).toBe('Paid')
    // voiding and deleting stay admin-only
    const paymentId = paid.body.invoice.payments[0].id
    expect((await api(`/invoices/${id}/payments/${paymentId}`, { method: 'DELETE', token: accounts.token })).status).toBe(403)
    await api(`/invoices/${id}/payments/${paymentId}`, { method: 'DELETE', token: admin })
    expect((await api(`/invoices/${id}`, { method: 'DELETE', token: accounts.token })).status).toBe(403)
    await api(`/invoices/${id}`, { method: 'DELETE', token: admin })
  })

  it('limits Accounts to the billing stage, and BD to everything else', async () => {
    expect((await api(`/projects/${projectId}`, { method: 'PATCH', token: accounts.token, body: { status: 'In Progress' } })).status).toBe(403)
    expect((await api(`/projects/${projectId}`, { method: 'PATCH', token: accounts.token, body: { billingStage: 'Final Billing' } })).status).toBe(200)
    expect((await api(`/projects/${projectId}`, { method: 'PATCH', token: bd, body: { billingStage: 'Fully Billed' } })).status).toBe(403)
  })

  it('takes a reopened, not-yet-invoiced project back out of the queue', async () => {
    expect((await api(`/projects/${projectId}`, { method: 'PATCH', token: bd, body: { status: 'In Progress' } })).status).toBe(200)
    expect(await handoff()).toBeNull()
    expect((await projectsFor(accounts.token)).some(p => p.id === projectId)).toBe(false)
  })
})

describe('Roles: team management', () => {
  it('only accepts the three roles, defaults new members to BD, and never assigns leads to Accounts', async () => {
    const admin = await adminToken()
    const email = `vitest-role-${Date.now()}@example.test`
    expect((await api('/users', { method: 'POST', token: admin, body: { email, role: 'employee' } })).status).toBe(400)
    const created = await api<{ user: { id: string; role: string } }>('/users', { method: 'POST', token: admin, body: { email } })
    expect(created.status).toBe(201)
    expect(created.body.user.role).toBe('bd')
    const id = created.body.user.id
    expect((await api(`/users/${id}/role`, { method: 'PATCH', token: admin, body: { role: 'accounts' } })).status).toBe(200)
    expect((await dbRows<{ role: string }>('SELECT role FROM users WHERE id = $1', [id]))[0].role).toBe('accounts')
    const lead = await api('/leads', { method: 'POST', token: admin, body: { plantName: 'Vitest Role Lead', city: 'X', bmUserId: id, assignedToName: email } })
    expect(lead.status).toBe(400)
    await api(`/users/${id}`, { method: 'DELETE', token: admin })
  })
})

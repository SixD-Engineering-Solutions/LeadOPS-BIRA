import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminToken, employeeToken, api, projectDetails, dbQuery } from './helpers'

// The admin Activity log (utils/auditLog.ts, routes/activityLog.ts): every
// create / change / delete of a lead, proposal, project or invoice — and each
// payment — is recorded with who did it and each field before and after.

type Change = { field: string; from: string | null; to: string | null }
type Entry = { entity: string; entityId: string; label: string; action: string; userName: string; summary: string | null; changes: Change[] }

describe('Activity log', () => {
  let admin: string
  let employee: string
  let employeeName: string
  const tag = `Vitest log ${Date.now()}`
  let leadId = ''

  const entriesFor = async (entityId: string) =>
    (await api<{ entries: Entry[] }>('/activity-log', { token: admin })).body.entries.filter(e => e.entityId === entityId).reverse() // oldest first
  const change = (e: Entry | undefined, field: string) => e?.changes.find(c => c.field === field)

  beforeAll(async () => {
    admin = await adminToken()
    employee = await employeeToken()
    const meId = (await api<{ user: { id: string } }>('/auth/me', { token: employee })).body.user.id
    const me = (await api<{ users: { id: string; userName: string | null; email: string }[] }>('/users', { token: admin })).body.users.find(u => u.id === meId)!
    employeeName = me.userName || me.email
    const created = await api<{ lead: { id: string } }>('/leads', { method: 'POST', token: admin, body: { plantName: tag, sectorName: 'Steel', assignedToName: me.email } })
    expect(created.status).toBe(201)
    leadId = created.body.lead.id
  })

  afterAll(async () => {
    await dbQuery(`DELETE FROM audit_logs WHERE label LIKE $1 OR lead_id = $2`, [`%${tag}%`, leadId])
  })

  it('is for admins only', async () => {
    expect((await api('/activity-log', { token: employee })).status).toBe(403)
  })

  it('records a lead being created and changed, by whoever did it', async () => {
    const changed = await api(`/leads/${leadId}`, { method: 'PATCH', token: employee, body: { statusName: 'In Process' } })
    expect(changed.status).toBe(200)
    const log = await entriesFor(leadId)
    expect(log.map(e => e.action)).toEqual(['created', 'updated'])
    expect(change(log[0], 'Plant')?.to).toBe(tag)
    expect(change(log[0], 'Sector')?.to).toBe('Steel')
    expect(log[1].userName).toBe(employeeName)
    expect(change(log[1], 'Status')).toEqual({ field: 'Status', from: 'Submitted', to: 'In Process' })
    expect(log[1].changes).toHaveLength(1) // only what actually changed
  })

  it('records a proposal won, the project it creates, an invoice and its payments', async () => {
    const prop = (await api<{ proposal: { id: string; proposalNumber: string } }>('/proposals', { method: 'POST', token: admin, body: { leadId, value: 250000 } })).body.proposal
    await api(`/proposals/${prop.id}`, { method: 'PATCH', token: admin, body: { status: 'Won', project: await projectDetails(admin) } })
    const propLog = await entriesFor(prop.id)
    expect(propLog.map(e => e.action)).toEqual(['created', 'updated'])
    expect(change(propLog[0], 'Value')?.to).toBe('₹2,50,000')
    expect(change(propLog[1], 'Status')).toEqual({ field: 'Status', from: 'Draft', to: 'Won' })

    const project = (await api<{ projects: { id: string; proposalId: string | null }[] }>('/projects', { token: admin })).body.projects.find(p => p.proposalId === prop.id)!
    const projLog = await entriesFor(project.id)
    expect(projLog[0].action).toBe('created')
    expect(projLog[0].summary).toContain(`marking ${prop.proposalNumber} Won`)

    const inv = (await api<{ invoice: { id: string } }>('/invoices', { method: 'POST', token: admin, body: { projectId: project.id, amount: 100000 } })).body.invoice
    const paid = await api<{ invoice: { payments: { id: string }[] } }>(`/invoices/${inv.id}/payments`, { method: 'POST', token: admin, body: { amountReceived: 40000 } })
    await api(`/invoices/${inv.id}/payments/${paid.body.invoice.payments[0].id}`, { method: 'DELETE', token: admin })
    const invLog = await entriesFor(inv.id)
    expect(invLog.map(e => e.action)).toEqual(['created', 'payment', 'payment voided'])
    expect(invLog[1].summary).toContain('₹40,000 received')
    expect(change(invLog[1], 'Status')).toEqual({ field: 'Status', from: 'Draft', to: 'Partially Paid' })
    expect(change(invLog[2], 'Status')?.from).toBe('Partially Paid')
  })

  it('records a lead being deleted, with what went with it', async () => {
    expect((await api(`/leads/${leadId}`, { method: 'DELETE', token: admin })).status).toBe(200)
    const log = await entriesFor(leadId)
    const deleted = log[log.length - 1]
    expect(deleted.action).toBe('deleted')
    expect(deleted.summary).toBe('Removed with 1 proposal, 1 project, 1 invoice')
  })
})

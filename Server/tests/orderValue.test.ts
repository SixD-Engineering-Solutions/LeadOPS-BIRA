import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminToken, api, createTestLead, createTestProject, projectDetails, deleteLead, deleteProject, deleteProposal } from './helpers'

// A project won from a proposal can't be invoiced for more than the
// proposal's value (routes/invoices.ts: assertWithinOrderValue) — on create
// and when an invoice's amount is raised. A project raised by hand, with no
// proposal, has no limit.

type Invoice = { id: string; amount: number }

describe('Invoices stay within the order value', () => {
  let admin: string
  let leadId: string
  let proposalId: string
  let projectId: string
  let freeLeadId: string
  let freeProjectId: string
  const invoiceIds: string[] = []

  const raise = (amount: number, project = projectId) =>
    api<{ invoice: Invoice; error: string }>('/invoices', { method: 'POST', token: admin, body: { projectId: project, amount } })

  beforeAll(async () => {
    admin = await adminToken()
    leadId = await createTestLead(admin, `Vitest Order Value ${Date.now()}`)
    const prop = await api<{ proposal: { id: string } }>('/proposals', { method: 'POST', token: admin, body: { leadId, value: 200000 } })
    expect(prop.status).toBe(201)
    proposalId = prop.body.proposal.id
    const won = await api(`/proposals/${proposalId}`, { method: 'PATCH', token: admin, body: { status: 'Won', project: await projectDetails(admin) } })
    expect(won.status).toBe(200)
    // Winning it created the project.
    const projects = await api<{ projects: { id: string; proposalId: string | null }[] }>('/projects', { token: admin })
    projectId = projects.body.projects.find(p => p.proposalId === proposalId)!.id

    freeLeadId = await createTestLead(admin, `Vitest No Order ${Date.now()}`)
    freeProjectId = await createTestProject(admin, freeLeadId, 'Vitest project without a proposal')
  })

  afterAll(async () => {
    for (const id of invoiceIds) await api(`/invoices/${id}`, { method: 'DELETE', token: admin })
    await deleteProject(admin, projectId)
    await deleteProposal(admin, proposalId)
    await deleteLead(admin, leadId)
    await deleteProject(admin, freeProjectId)
    await deleteLead(admin, freeLeadId)
  })

  it('allows invoicing up to the order, and no further', async () => {
    const first = await raise(150000)
    expect(first.status).toBe(201)
    invoiceIds.push(first.body.invoice.id)

    const tooMuch = await raise(60000)
    expect(tooMuch.status).toBe(400)
    expect(tooMuch.body.error).toContain('₹50,000') // what's left
    expect(tooMuch.body.error).toContain('₹2,00,000') // the order

    const rest = await raise(50000)
    expect(rest.status).toBe(201)
    invoiceIds.push(rest.body.invoice.id)

    const full = await raise(1)
    expect(full.status).toBe(400)
    expect(full.body.error).toMatch(/fully invoiced/)
  })

  it('checks a raised amount too, but lets an amount come down', async () => {
    const up = await api<{ error: string }>(`/invoices/${invoiceIds[0]}`, { method: 'PATCH', token: admin, body: { amount: 160000 } })
    expect(up.status).toBe(400)
    const down = await api<{ invoice: Invoice }>(`/invoices/${invoiceIds[0]}`, { method: 'PATCH', token: admin, body: { amount: 140000 } })
    expect(down.status).toBe(200)
    expect(down.body.invoice.amount).toBe(140000)
    // and the ₹10,000 that freed up can be invoiced again
    const refill = await raise(10000)
    expect(refill.status).toBe(201)
    invoiceIds.push(refill.body.invoice.id)
  })

  it('leaves a project without a proposal unlimited', async () => {
    const big = await raise(99999999, freeProjectId)
    expect(big.status).toBe(201)
    invoiceIds.push(big.body.invoice.id)
  })
})

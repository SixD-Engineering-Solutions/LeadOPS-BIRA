import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminToken, api, createTestLead, createTestProject, deleteLead, deleteProject, deleteProposal, deleteInvoiceAndPayments, projectDetails } from './helpers'

type Proposal = { id: string; proposalNumber: string }
type Project = { id: string; workOrderNo: string; proposal?: { id: string } | null }
type Invoice = { id: string; payments: { id: string; amountReceived: number }[] }

// Phase 3 — every one of these fires genuinely concurrent requests
// (Promise.all, not a for-loop with awaits) and asserts on uniqueness/counts
// of what actually landed, never on which specific request "won" — that's
// the only way these claims mean anything.
describe('Concurrency (Phase 3)', () => {
  let admin: string
  let leadId: string

  beforeAll(async () => {
    admin = await adminToken()
    leadId = await createTestLead(admin, `Vitest Concurrency Test ${Date.now()}`)
  })

  afterAll(async () => {
    await deleteLead(admin, leadId)
  })

  // One proposal per lead: of N simultaneous creates on the same lead, exactly
  // one lands and the rest are refused — never two, and never a burned number.
  it('N simultaneous proposal creates on one lead: exactly one succeeds', async () => {
    const N = 10
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        api<{ proposal: Proposal }>('/proposals', { method: 'POST', token: admin, body: { leadId } })
      )
    )
    const created = results.filter(r => r.status === 201)
    expect(created.length).toBe(1)
    expect(results.filter(r => r.status === 409).length).toBe(N - 1)

    await deleteProposal(admin, created[0].body.proposal.id)
  })

  // Same rule for projects.
  it('N simultaneous project creates on one lead: exactly one succeeds', async () => {
    const details = await projectDetails(admin)
    const N = 8
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        api<{ project: Project }>('/projects', { method: 'POST', token: admin, body: { leadId, projectName: 'Vitest concurrency project', ...details } })
      )
    )
    const created = results.filter(r => r.status === 201)
    expect(created.length).toBe(1)
    expect(results.filter(r => r.status === 409).length).toBe(N - 1)

    await deleteProject(admin, created[0].body.project.id)
  })

  it('marking Won without the project’s engineer and dates is refused, and leaves the proposal unchanged', async () => {
    const { body: created } = await api<{ proposal: Proposal & { status: string } }>('/proposals', { method: 'POST', token: admin, body: { leadId } })
    const proposalId = created.proposal.id

    const res = await api(`/proposals/${proposalId}`, { method: 'PATCH', token: admin, body: { status: 'Won' } })
    expect(res.status).toBe(400)
    const { body: after } = await api<{ proposal: { status: string } }>(`/proposals/${proposalId}`, { token: admin })
    expect(after.proposal.status).toBe('Draft')

    await deleteProposal(admin, proposalId)
  })

  it('N simultaneous "mark Won" requests on the same proposal create exactly one project', async () => {
    const { body: created } = await api<{ proposal: Proposal }>('/proposals', { method: 'POST', token: admin, body: { leadId } })
    const proposalId = created.proposal.id
    const project = await projectDetails(admin)

    const N = 6
    const results = await Promise.all(
      Array.from({ length: N }, () => api(`/proposals/${proposalId}`, { method: 'PATCH', token: admin, body: { status: 'Won', project } }))
    )
    expect(results.every(r => r.status === 200)).toBe(true)

    const { body: allProjects } = await api<{ projects: Project[] }>('/projects', { token: admin })
    const matching = allProjects.projects.filter(p => p.proposal?.id === proposalId)
    expect(matching.length).toBe(1)

    await deleteProject(admin, matching[0].id)
    await deleteProposal(admin, proposalId)
  })

  it('concurrent payments that would jointly overpay an invoice: exactly one succeeds', async () => {
    const projectId = await createTestProject(admin, leadId, 'Vitest overpay-race project')
    const { body: inv } = await api<{ invoice: { id: string } }>('/invoices', { method: 'POST', token: admin, body: { projectId, amount: 10000 } })
    const invoiceId = inv.invoice.id

    // 5 x 6000 against a 10000 invoice — only one can possibly fit.
    const N = 5
    const results = await Promise.all(
      Array.from({ length: N }, () => api(`/invoices/${invoiceId}/payments`, { method: 'POST', token: admin, body: { amountReceived: 6000 } }))
    )
    expect(results.filter(r => r.status === 201).length).toBe(1)
    expect(results.filter(r => r.status === 400).length).toBe(N - 1)

    const { body: final } = await api<{ invoice: Invoice }>(`/invoices/${invoiceId}`, { token: admin })
    expect(final.invoice.payments.length).toBe(1)
    expect(final.invoice.payments.reduce((sum, p) => sum + p.amountReceived, 0)).toBe(6000)

    await deleteInvoiceAndPayments(admin, final.invoice)
    await deleteProject(admin, projectId)
  })
})

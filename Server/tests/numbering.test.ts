import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminToken, api, createTestLead, projectDetails, deleteLead, dbRows } from './helpers'

// PROP-/WO-/INV- numbers (utils/sequence.ts): the next number is one more
// than the highest still in use, so deleting the newest records — or a whole
// lead with its proposal, project and invoices — frees their numbers for the
// next ones. Numbers are still never handed out twice, even at the same moment.

type Proposal = { id: string; proposalNumber: string }
const num = (s: string) => Number(s.match(/(\d+)$/)![1])

describe('Document numbering', () => {
  let admin: string
  const leads: string[] = []

  // A lead with a won proposal, its project and one invoice.
  async function fullDeal(name: string) {
    const leadId = await createTestLead(admin, `${name} ${Date.now()}`)
    leads.push(leadId)
    const prop = (await api<{ proposal: Proposal }>('/proposals', { method: 'POST', token: admin, body: { leadId, value: 100000 } })).body.proposal
    await api(`/proposals/${prop.id}`, { method: 'PATCH', token: admin, body: { status: 'Won', project: await projectDetails(admin) } })
    const project = (await api<{ projects: { id: string; proposalId: string | null; workOrderNo: string }[] }>('/projects', { token: admin })).body.projects.find(p => p.proposalId === prop.id)!
    const invoice = (await api<{ invoice: { id: string; invoiceNumber: string } }>('/invoices', { method: 'POST', token: admin, body: { projectId: project.id, amount: 1000 } })).body.invoice
    return { leadId, proposal: prop.proposalNumber, workOrder: project.workOrderNo, invoice: invoice.invoiceNumber }
  }

  beforeAll(async () => { admin = await adminToken() })
  afterAll(async () => { for (const id of leads) await deleteLead(admin, id) })

  it('reuses the numbers of a deleted lead’s proposal, project and invoice', async () => {
    const first = await fullDeal('Vitest numbering A')
    expect((await deleteLead(admin, first.leadId)).status).toBe(200)

    const second = await fullDeal('Vitest numbering B')
    expect(second.proposal).toBe(first.proposal)
    expect(second.workOrder).toBe(first.workOrder)
    expect(second.invoice).toBe(first.invoice)

    // The deleted ones gave their numbers up.
    const hidden = await dbRows<{ proposal_number: string }>(`SELECT proposal_number FROM proposals WHERE lead_id = $1`, [first.leadId])
    expect(hidden[0].proposal_number).toMatch(new RegExp(`^${first.proposal}-deleted-`))
  })

  it('leaves a gap for a deleted record in the middle', async () => {
    const a = await fullDeal('Vitest numbering C')
    const b = await fullDeal('Vitest numbering D')
    expect(num(b.proposal)).toBe(num(a.proposal) + 1)
    await deleteLead(admin, a.leadId)
    const c = await fullDeal('Vitest numbering E')
    expect(num(c.proposal)).toBe(num(b.proposal) + 1) // not a's old number
  })

  it('never hands out the same number twice, even at the same moment', async () => {
    const created = await Promise.all(Array.from({ length: 10 }, async (_, i) => {
      const leadId = await createTestLead(admin, `Vitest numbering burst ${i} ${Date.now()}`)
      leads.push(leadId)
      return api<{ proposal: Proposal }>('/proposals', { method: 'POST', token: admin, body: { leadId, value: 5000 } })
    }))
    expect(created.every(r => r.status === 201)).toBe(true)
    const numbers = created.map(r => num(r.body.proposal.proposalNumber)).sort((x, y) => x - y)
    expect(new Set(numbers).size).toBe(10)
    expect(numbers[9] - numbers[0]).toBe(9) // consecutive, no gaps
  })
})

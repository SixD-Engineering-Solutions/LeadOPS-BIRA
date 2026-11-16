import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminToken, api, createTestLead, deleteLead, deleteProposal, dbQuery } from './helpers'

// A proposal's decision date (decidedAt): stamped when its status lands on Won
// or Lost, cleared when it moves off both, and untouched by other edits.

type Proposal = { id: string; status: string; decidedAt: string | null }

describe('Proposal decision date', () => {
  let admin: string
  let leadId = ''
  let proposalId = ''
  const tag = `Vitest decided ${Date.now()}`

  const patch = (body: unknown) => api<{ proposal: Proposal }>(`/proposals/${proposalId}`, { method: 'PATCH', token: admin, body })

  beforeAll(async () => {
    admin = await adminToken()
    leadId = await createTestLead(admin, tag)
    const created = await api<{ proposal: Proposal }>('/proposals', { method: 'POST', token: admin, body: { leadId, value: 1000 } })
    expect(created.status).toBe(201)
    proposalId = created.body.proposal.id
  })

  afterAll(async () => {
    if (proposalId) await deleteProposal(admin, proposalId)
    if (leadId) await deleteLead(admin, leadId)
    await dbQuery(`DELETE FROM audit_logs WHERE label LIKE $1 OR lead_id = $2`, [`%${tag}%`, leadId])
  })

  it('is empty while the proposal is undecided', async () => {
    const list = (await api<{ proposals: Proposal[] }>(`/proposals?leadId=${leadId}`, { token: admin })).body.proposals
    expect(list[0].decidedAt).toBeNull()
  })

  it('is stamped when the proposal is marked Lost, and kept by unrelated edits', async () => {
    const lost = await patch({ status: 'Lost', lostReason: 'Went with a competitor' })
    expect(lost.status).toBe(200)
    const decidedAt = lost.body.proposal.decidedAt
    expect(decidedAt).toBeTruthy()
    expect(Math.abs(Date.now() - new Date(decidedAt!).getTime())).toBeLessThan(60_000)

    const edited = await patch({ probabilityPct: 10 })
    expect(edited.body.proposal.decidedAt).toBe(decidedAt)
  })

  it('is cleared when it moves back to an open status, and stamped again on the next decision', async () => {
    const reopened = await patch({ status: 'Negotiation' })
    expect(reopened.body.proposal.decidedAt).toBeNull()
    const again = await patch({ status: 'Lost', lostReason: 'Budget cut again' })
    expect(again.body.proposal.decidedAt).toBeTruthy()
  })
})

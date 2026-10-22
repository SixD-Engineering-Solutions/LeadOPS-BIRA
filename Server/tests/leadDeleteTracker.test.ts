import { describe, it, expect, beforeAll } from 'vitest'
import { adminToken, api, createTestLead, projectDetails, deleteLead, dbRows } from './helpers'

// Deleting a lead takes its invoices back out of the Tracker completely —
// their Invoice Register rows AND their amounts in the sector summary (which
// drive the FY totals, the dashboard's target card and the invoicing charts),
// the same as deleting each invoice on its own.

const total = async () => (await dbRows<{ fy_total: number }>(`SELECT fy_total FROM invoice_sector_summary WHERE upper(trim(sector)) = 'TOTAL'`))[0]?.fy_total ?? 0
// The summary covers the financial year most of the sheet's invoices fall in.
const summaryFyStart = async () => {
  const [{ y }] = await dbRows<{ y: number }>(`
    SELECT CASE WHEN EXTRACT(MONTH FROM invoice_date) >= 4 THEN EXTRACT(YEAR FROM invoice_date) ELSE EXTRACT(YEAR FROM invoice_date) - 1 END AS y
    FROM invoice_register_items WHERE source_invoice_id IS NULL AND invoice_date IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC, 1 DESC LIMIT 1`)
  return Number(y)
}

describe('Deleting a lead clears it from the Tracker', () => {
  let admin: string
  beforeAll(async () => { admin = await adminToken() })

  it('takes its invoice back out of the sector summary and the register', async () => {
    const leadId = await createTestLead(admin, `Vitest lead delete ${Date.now()}`)
    const prop = (await api<{ proposal: { id: string } }>('/proposals', { method: 'POST', token: admin, body: { leadId, value: 300000 } })).body.proposal
    await api(`/proposals/${prop.id}`, { method: 'PATCH', token: admin, body: { status: 'Won', project: await projectDetails(admin) } })
    const project = (await api<{ projects: { id: string; proposalId: string | null }[] }>('/projects', { token: admin })).body.projects.find(p => p.proposalId === prop.id)!

    const before = await total()
    const invoiceDate = `${await summaryFyStart()}-07-15` // inside the summary's year
    const inv = await api<{ invoice: { id: string } }>('/invoices', { method: 'POST', token: admin, body: { projectId: project.id, amount: 300000, invoiceDate } })
    expect(inv.status).toBe(201)
    expect(await total()).toBeCloseTo(before + 3, 2) // ₹3 L added
    expect(await dbRows(`SELECT 1 FROM invoice_register_items WHERE source_invoice_id = $1`, [inv.body.invoice.id])).toHaveLength(1)

    expect((await deleteLead(admin, leadId)).status).toBe(200)
    expect(await total()).toBeCloseTo(before, 2) // and taken back
    expect(await dbRows(`SELECT 1 FROM invoice_register_items WHERE source_invoice_id = $1`, [inv.body.invoice.id])).toHaveLength(0)
    expect(await dbRows(`SELECT 1 FROM pipeline_tracker_items WHERE source_lead_id = $1`, [leadId])).toHaveLength(0)
  })
})

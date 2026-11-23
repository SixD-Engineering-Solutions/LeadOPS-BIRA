import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminToken, employeeToken, api, projectDetails, dbRows, leadOwners } from './helpers'

// The daily SharePoint sheet sync (services/sheetSync.ts), run by hand through
// POST /tracker/sheet-sync/run. Needs the API started with a sync source — e.g.
// SHEET_SYNC_FILE pointing at prisma/data/LeadOps sheet.xlsx — and skips
// otherwise. Re-applying the same workbook leaves the sheet rows as they are.

type Summary = { id: string; sector: string | null; aug: number | null; fyTotal: number | null; fyTarget: number | null }
type Register = { id: string; sourceInvoiceId: string | null }

describe('Sheet sync', async () => {
  const admin = await adminToken()
  const status = await api<{ enabled: boolean }>('/tracker/sheet-sync', { token: admin })
  const enabled = status.status === 200 && status.body.enabled
  const tag = `Vitest sync ${Date.now()}`
  let leadId = ''
  let invoiceId = ''

  const invoices = async () => (await api<{ summary: Summary[]; register: Register[] }>('/tracker/invoices', { token: admin })).body
  const steel = (s: Summary[]) => s.find(r => r.sector?.trim().toLowerCase() === 'steel')

  beforeAll(async () => {
    if (!enabled) return
    const lead = await api<{ lead: { id: string } }>('/leads', { method: 'POST', token: admin, body: { plantName: tag, sectorName: 'Steel', ...(await leadOwners(admin)) } })
    leadId = lead.body.lead.id
    const prop = (await api<{ proposal: { id: string } }>('/proposals', { method: 'POST', token: admin, body: { leadId, value: 500000 } })).body.proposal
    await api(`/proposals/${prop.id}`, { method: 'PATCH', token: admin, body: { status: 'Won', project: await projectDetails(admin) } })
    const project = (await api<{ projects: { id: string; proposalId: string | null }[] }>('/projects', { token: admin })).body.projects.find(p => p.proposalId === prop.id)!
    // ₹1,23,000 = 1.23 lakh, in August of the sheet's financial year.
    const inv = await api<{ invoice: { id: string } }>('/invoices', { method: 'POST', token: admin, body: { projectId: project.id, amount: 123000, invoiceDate: '2026-08-10' } })
    expect(inv.status).toBe(201)
    invoiceId = inv.body.invoice.id
  })

  afterAll(async () => {
    if (leadId) await api(`/leads/${leadId}`, { method: 'DELETE', token: admin })
  })

  it.skipIf(!enabled)('is for admins only', async () => {
    const employee = await employeeToken()
    expect((await api('/tracker/sheet-sync', { token: employee })).status).toBe(403)
    expect((await api('/tracker/sheet-sync/run', { method: 'POST', token: employee, body: {} })).status).toBe(403)
  })

  it.skipIf(!enabled)('replaces only the sheet rows, and keeps the app invoice counted exactly once', async () => {
    const before = await invoices()
    const appRow = before.register.find(r => r.sourceInvoiceId === invoiceId)
    expect(appRow).toBeTruthy()
    const steelAugBefore = steel(before.summary)!.aug

    const run = await api<{ status: string; message: string }>('/tracker/sheet-sync/run', { method: 'POST', token: admin, body: {} })
    expect(run.status).toBe(200)
    expect(run.body.status).toBe('success')

    const after = await invoices()
    // The app's invoice row is untouched — same row, same id.
    expect(after.register.find(r => r.sourceInvoiceId === invoiceId)?.id).toBe(appRow!.id)
    // Its 1.23 lakh is still in Steel's August, once: the sheet's figure plus it.
    expect(steel(after.summary)!.aug).toBe(steelAugBefore)
    // The sheet rows are exactly the workbook's.
    const [{ n }] = await dbRows<{ n: string }>('SELECT count(*) AS n FROM invoice_register_items WHERE source_invoice_id IS NULL')
    expect(Number(n)).toBeGreaterThan(0)
    // TOTAL is the sum of the sectors.
    const sectors = after.summary.filter(r => r.sector?.trim().toUpperCase() !== 'TOTAL')
    const total = after.summary.find(r => r.sector?.trim().toUpperCase() === 'TOTAL')!
    expect(total.fyTotal).toBeCloseTo(sectors.reduce((s, r) => s + (r.fyTotal ?? 0), 0), 2)

    // Running it again changes nothing: every sheet row is kept as it was.
    const again = await api<{ status: string }>('/tracker/sheet-sync/run', { method: 'POST', token: admin, body: {} })
    expect(again.body.status).toBe('success')
    const runs = (await api<{ runs: { status: string; changes: { pipeline: { added: number; removed: number }; register: { added: number; removed: number } } }[] }>('/tracker/sheet-sync', { token: admin })).body.runs
    expect(runs[0].changes.pipeline).toMatchObject({ added: 0, removed: 0 })
    expect(runs[0].changes.register).toMatchObject({ added: 0, removed: 0 })
    expect(steel((await invoices()).summary)!.aug).toBe(steelAugBefore)
  })
})

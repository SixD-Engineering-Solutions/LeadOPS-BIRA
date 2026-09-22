import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminToken, employeeToken, api, createTestLead, createTestProject, deleteLead, deleteProject } from './helpers'

type Invoice = {
  id: string
  amount: number
  status: string
  payments: { id: string; amountReceived: number }[]
}

// Phase 2 — invoice status recompute, overpayment rejection, payment voiding
// — plus the Phase 4 Decimal migration's precision. Uses genuinely
// fractional amounts throughout (not round numbers) specifically because
// round numbers can't distinguish exact decimal math from float noise.
describe('Invoice correctness (Phase 2, Decimal precision)', () => {
  let admin: string
  let employee: string
  let leadId: string
  let projectId: string

  beforeAll(async () => {
    admin = await adminToken()
    employee = await employeeToken()
    leadId = await createTestLead(admin, `Vitest Invoice Test ${Date.now()}`)
    projectId = await createTestProject(admin, leadId, 'Vitest Invoice Test Project')
  })

  afterAll(async () => {
    await deleteProject(admin, projectId)
    await deleteLead(admin, leadId)
  })

  it('walks the full lifecycle with exact decimal math at every step', async () => {
    const created = await api<{ invoice: Invoice }>('/invoices', { method: 'POST', token: admin, body: { projectId, amount: 10000.55 } })
    expect(created.status).toBe(201)
    expect(created.body.invoice.amount).toBe(10000.55)
    const invoiceId = created.body.invoice.id

    // partial payment -> Partially Paid
    const pay1 = await api<{ invoice: Invoice }>(`/invoices/${invoiceId}/payments`, { method: 'POST', token: admin, body: { amountReceived: 6000.25 } })
    expect(pay1.status).toBe(201)
    expect(pay1.body.invoice.status).toBe('Partially Paid')
    expect(typeof pay1.body.invoice.payments[0].amountReceived).toBe('number') // Decimal must serialize as a number, not a string

    // overpayment rejected, with the exact remaining balance in the message
    const overpay = await api<{ error: string }>(`/invoices/${invoiceId}/payments`, { method: 'POST', token: admin, body: { amountReceived: 5000 } })
    expect(overpay.status).toBe(400)
    expect(overpay.body.error).toContain('4000.3') // 10000.55 - 6000.25, computed exactly — not 4000.299999999999

    // paying exactly the remainder -> Paid
    const pay2 = await api<{ invoice: Invoice }>(`/invoices/${invoiceId}/payments`, { method: 'POST', token: admin, body: { amountReceived: 4000.3 } })
    expect(pay2.status).toBe(201)
    expect(pay2.body.invoice.status).toBe('Paid')
    const pay2Id = pay2.body.invoice.payments.find(p => p.amountReceived === 4000.3)!.id

    // voiding is admin-only
    const voidDenied = await api(`/invoices/${invoiceId}/payments/${pay2Id}`, { method: 'DELETE', token: employee })
    expect(voidDenied.status).toBe(403)

    // voiding it drops status back to Partially Paid
    const voided = await api<{ invoice: Invoice }>(`/invoices/${invoiceId}/payments/${pay2Id}`, { method: 'DELETE', token: admin })
    expect(voided.status).toBe(200)
    expect(voided.body.invoice.status).toBe('Partially Paid')

    // editing the amount down to exactly what's paid -> Paid again
    const patched = await api<{ invoice: Invoice }>(`/invoices/${invoiceId}`, { method: 'PATCH', token: admin, body: { amount: 6000.25 } })
    expect(patched.body.invoice.status).toBe('Paid')
    expect(patched.body.invoice.amount).toBe(6000.25)

    // voiding the last remaining payment (paid drops to 0, was Paid) falls back to Sent, not stuck
    const lastPayId = patched.body.invoice.payments[0].id
    const voidLast = await api<{ invoice: Invoice }>(`/invoices/${invoiceId}/payments/${lastPayId}`, { method: 'DELETE', token: admin })
    expect(voidLast.body.invoice.status).toBe('Sent')

    await api(`/invoices/${invoiceId}`, { method: 'DELETE', token: admin })
  })
})

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminToken, employeeToken, api, dbQuery } from './helpers'

// Tracker change requests: an employee proposes an edit to an imported row,
// an admin approves (applied) or declines (closed, employee notified). Uses
// real imported rows, so every field a test changes is put back afterwards,
// and the requests and notifications it caused are removed.

type PipelineRow = { id: string; sourceLeadId: string | null; notes: string | null; priority: string | null }
type RegisterRow = { id: string; sourceInvoiceId: string | null; remarks: string | null }
type SummaryRow = { id: string; sector: string | null }
type Req = { id: string; rowId: string; status: string; changes: Record<string, { from: unknown; to: unknown }> }
type Notification = { message: string; createdAt: string }

describe('Tracker change requests', () => {
  let admin: string
  let employee: string
  let adminId: string
  let employeeId: string
  let pipelineRow: PipelineRow
  let appPipelineRow: PipelineRow | undefined
  let registerRow: RegisterRow
  let totalRow: SummaryRow | undefined
  const startedAt = new Date()
  const createdRequestIds: string[] = []
  const marker = `vitest-${Date.now()}`

  beforeAll(async () => {
    admin = await adminToken()
    employee = await employeeToken()
    adminId = (await api<{ user: { id: string } }>('/auth/me', { token: admin })).body.user.id
    employeeId = (await api<{ user: { id: string } }>('/auth/me', { token: employee })).body.user.id

    const pipeline = (await api<{ items: PipelineRow[] }>('/tracker/pipeline', { token: admin })).body.items
    pipelineRow = pipeline.find(r => !r.sourceLeadId)!
    appPipelineRow = pipeline.find(r => r.sourceLeadId)
    const invoices = (await api<{ summary: SummaryRow[]; register: RegisterRow[] }>('/tracker/invoices', { token: admin })).body
    registerRow = invoices.register.find(r => !r.sourceInvoiceId)!
    totalRow = invoices.summary.find(r => r.sector === 'TOTAL')
    expect(pipelineRow, 'needs at least one imported pipeline row').toBeTruthy()
    expect(registerRow, 'needs at least one imported invoice register row').toBeTruthy()
  })

  afterAll(async () => {
    if (pipelineRow) {
      await api(`/tracker/rows/pipeline/${pipelineRow.id}`, { method: 'PATCH', token: admin, body: { changes: { notes: pipelineRow.notes, priority: pipelineRow.priority } } })
    }
    if (registerRow) {
      await api(`/tracker/rows/invoiceRegister/${registerRow.id}`, { method: 'PATCH', token: admin, body: { changes: { remarks: registerRow.remarks } } })
    }
    if (createdRequestIds.length) await dbQuery('DELETE FROM tracker_change_requests WHERE id = ANY($1)', [createdRequestIds])
    // Notifications this file caused, for the two real accounts it ran as.
    await dbQuery(
      `DELETE FROM notifications WHERE user_id = ANY($1) AND created_at >= $2
        AND (message LIKE '%asked you to approve a change to%' OR message LIKE 'Your change to%')`,
      [[adminId, employeeId], startedAt],
    )
  })

  async function request(rowId: string, changes: Record<string, unknown>, table = 'pipeline', to = adminId) {
    const res = await api<{ request: Req; error?: string }>('/tracker/requests', {
      method: 'POST', token: employee, body: { table, rowId, adminId: to, changes, note: marker },
    })
    if (res.status === 201) createdRequestIds.push(res.body.request.id)
    return res
  }

  const latestNotification = async (token: string) =>
    (await api<{ notifications: Notification[] }>('/notifications', { token })).body.notifications[0]

  it('an employee can send a request; it waits for the admin and changes nothing yet', async () => {
    const { status, body } = await request(pipelineRow.id, { notes: `${marker} approved note` })
    expect(status).toBe(201)
    expect(body.request.changes.notes).toEqual({ from: pipelineRow.notes, to: `${marker} approved note` })

    const incoming = await api<{ requests: (Req & { current: Record<string, unknown> })[] }>('/tracker/requests/incoming', { token: admin })
    const mine = incoming.body.requests.find(r => r.id === body.request.id)
    expect(mine?.current).toEqual({ notes: pipelineRow.notes })

    const row = (await api<{ items: PipelineRow[] }>('/tracker/pipeline', { token: admin })).body.items.find(r => r.id === pipelineRow.id)
    expect(row?.notes).toBe(pipelineRow.notes)
    expect((await latestNotification(admin)).message).toContain('asked you to approve a change')
  })

  it('refuses a second waiting request on the same row from the same employee', async () => {
    const { status } = await request(pipelineRow.id, { priority: `${marker}` })
    expect(status).toBe(409)
  })

  it('an employee cannot approve, decline, or edit directly', async () => {
    const id = createdRequestIds[0]
    expect((await api(`/tracker/requests/${id}/approve`, { method: 'POST', token: employee })).status).toBe(403)
    expect((await api(`/tracker/requests/${id}/decline`, { method: 'POST', token: employee })).status).toBe(403)
    expect((await api(`/tracker/rows/pipeline/${pipelineRow.id}`, { method: 'PATCH', token: employee, body: { changes: { notes: 'x' } } })).status).toBe(403)
  })

  it('approving applies the change, notifies the employee, and closes the request', async () => {
    const id = createdRequestIds[0]
    const { status } = await api(`/tracker/requests/${id}/approve`, { method: 'POST', token: admin })
    expect(status).toBe(200)

    const row = (await api<{ items: PipelineRow[] }>('/tracker/pipeline', { token: admin })).body.items.find(r => r.id === pipelineRow.id)
    expect(row?.notes).toBe(`${marker} approved note`)
    expect((await latestNotification(employee)).message).toMatch(/was approved/)

    const again = await api(`/tracker/requests/${id}/approve`, { method: 'POST', token: admin })
    expect(again.status).toBe(404)
    const mine = (await api<{ requests: Req[] }>('/tracker/requests/mine', { token: employee })).body.requests
    expect(mine.some(r => r.id === id)).toBe(false)
  })

  it('declining changes nothing, tells the employee why, and the request is gone for good', async () => {
    const { status, body } = await request(registerRow.id, { remarks: `${marker} declined remark` }, 'invoiceRegister')
    expect(status).toBe(201)
    const id = body.request.id

    const decline = await api(`/tracker/requests/${id}/decline`, { method: 'POST', token: admin, body: { reason: 'Not needed' } })
    expect(decline.status).toBe(200)

    const row = (await api<{ register: RegisterRow[] }>('/tracker/invoices', { token: admin })).body.register.find(r => r.id === registerRow.id)
    expect(row?.remarks).toBe(registerRow.remarks)
    const note = await latestNotification(employee)
    expect(note.message).toMatch(/was declined/)
    expect(note.message).toContain('Not needed')

    expect((await api(`/tracker/requests/${id}/approve`, { method: 'POST', token: admin })).status).toBe(404)
    expect((await api(`/tracker/requests/${id}/decline`, { method: 'POST', token: admin })).status).toBe(404)
    const incoming = (await api<{ requests: Req[] }>('/tracker/requests/incoming', { token: admin })).body.requests
    expect(incoming.some(r => r.id === id)).toBe(false)
  })

  it('rejects rows that can’t be edited, bad values, no-op edits and a non-admin recipient', async () => {
    if (appPipelineRow) expect((await request(appPipelineRow.id, { notes: 'x' })).status).toBe(400)
    if (totalRow) expect((await request(totalRow.id, { remarks: 'x' }, 'sectorSummary')).status).toBe(400)
    expect((await request(pipelineRow.id, { valueLakhs: 'abc' })).status).toBe(400)
    expect((await request(pipelineRow.id, { sortOrder: 1 })).status).toBe(400)
    expect((await request(registerRow.id, { remarks: registerRow.remarks }, 'invoiceRegister')).status).toBe(400)
    expect((await request(registerRow.id, { remarks: 'x' }, 'invoiceRegister', employeeId)).status).toBe(400)
  })

  it('serves the editable fields, which are exactly what an edit may change', async () => {
    type Def = { title: string; fields: { key: string; label: string; kind: string }[] }
    const { status, body } = await api<{ tables: Record<string, Def> }>('/tracker/fields', { token: employee })
    expect(status).toBe(200)
    expect(Object.keys(body.tables).sort()).toEqual(['invoiceRegister', 'pipeline', 'sectorSummary'])
    const pipelineKeys = body.tables.pipeline.fields.map(f => f.key)
    expect(pipelineKeys).toContain('notes')
    expect(pipelineKeys).not.toContain('sourceLeadId')
    // A listed field is accepted by the server; an unlisted one is refused.
    const unlisted = await request(pipelineRow.id, { sourceLeadId: 'x' })
    expect(unlisted.status).toBe(400)
  })

  it('an admin can edit an imported row directly', async () => {
    const { status } = await api(`/tracker/rows/pipeline/${pipelineRow.id}`, { method: 'PATCH', token: admin, body: { changes: { priority: `${marker} direct` } } })
    expect(status).toBe(200)
    const row = (await api<{ items: PipelineRow[] }>('/tracker/pipeline', { token: admin })).body.items.find(r => r.id === pipelineRow.id)
    expect(row?.priority).toBe(`${marker} direct`)
  })
})

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminToken, employeeToken, api, dbRows, dbQuery } from './helpers'

// Data clean-up (routes/catalog.ts): renaming and merging sectors carries the
// Tracker along, every change is recorded, and reverting one puts back
// exactly what it changed. Uses two throwaway sectors with their own leads,
// register rows and sector-summary rows, so real data is never touched, and
// removes all of it afterwards.

type Change = { id: string; summary: string; revertedAt: string | null }

describe('Data clean-up: rename, merge and revert', () => {
  let admin: string
  let employee: string
  const tag = `vt${Date.now()}`
  const A = `${tag} Oilfield`
  const B = `${tag} Oil & Gas`
  const C = `${tag} Steel`
  const leadIds: string[] = []
  const regIds: string[] = []
  const sumIds: string[] = []

  const sectorId = async (name: string) =>
    (await dbRows<{ id: string }>(`SELECT id FROM sectors WHERE sector_name = $1 AND is_active`, [name]))[0]?.id
  const latestChange = async () =>
    (await api<{ changes: Change[] }>('/catalog/sector/history', { token: admin })).body.changes.find(c => !c.revertedAt && c.summary.includes(tag))!
  // Everything a sector change can touch, for "is it exactly as before?".
  const fingerprint = async () => {
    const q = async (sql: string) => JSON.stringify(await dbRows(sql, [`${tag}%`]))
    return {
      sectors: await q(`SELECT id, sector_name, is_active FROM sectors WHERE sector_name LIKE $1 ORDER BY id`),
      leads: JSON.stringify(await dbRows(`SELECT id, sector_id FROM leads WHERE id = ANY($1) ORDER BY id`, [leadIds])),
      register: JSON.stringify(await dbRows(`SELECT id, sector FROM invoice_register_items WHERE id = ANY($1) ORDER BY id`, [regIds])),
      summary: await q(`SELECT id, sector, apr, may, fy_target, fy_total, q1_total FROM invoice_sector_summary WHERE sector LIKE $1 ORDER BY id`),
    }
  }
  // The TOTAL row is worked out again by every summary change (it's the sum
  // of the sector rows, test rows included), so it's saved here and put back
  // exactly at the end.
  let totalRow: Record<string, unknown> | undefined

  beforeAll(async () => {
    totalRow = (await dbRows(`SELECT * FROM invoice_sector_summary WHERE upper(trim(sector)) = 'TOTAL'`))[0]
    admin = await adminToken()
    employee = await employeeToken()
    // Two sectors written two ways plus a third, each with a lead; the first
    // two also have register rows and sector-summary rows.
    for (const [i, sector] of [A, B, C].entries()) {
      const { status, body } = await api<{ lead: { id: string } }>('/leads', { method: 'POST', token: admin, body: { plantName: `${tag} plant ${i}`, sectorName: sector } })
      expect(status).toBe(201)
      leadIds.push(body.lead.id)
    }
    expect(await sectorId(A)).toBeTruthy()
    expect(await sectorId(B)).toBeTruthy()
    for (const [i, sector] of [A, B].entries()) {
      const r = await dbRows<{ id: string }>(`INSERT INTO invoice_register_items (id, sort_order, sector, updated_at) VALUES ($1, 99990 + $2, $3, now()) RETURNING id`, [`${tag}-reg-${i}`, i, sector])
      regIds.push(r[0].id)
      const s = await dbRows<{ id: string }>(
        `INSERT INTO invoice_sector_summary (id, sort_order, sector, apr, may, fy_target, updated_at) VALUES ($1, 99990 + $2, $3, $4, $5, $6, now()) RETURNING id`,
        [`${tag}-sum-${i}`, i, sector, 10 + i, 1.5, 100],
      )
      sumIds.push(s[0].id)
    }
  })

  afterAll(async () => {
    if (totalRow) {
      const cols = Object.keys(totalRow).filter(c => c !== 'id')
      await dbQuery(`UPDATE invoice_sector_summary SET ${cols.map((c, i) => `"${c}" = $${i + 2}`).join(', ')} WHERE id = $1`, [totalRow.id, ...cols.map(c => totalRow![c])])
    }
    await dbQuery(`DELETE FROM catalog_changes WHERE summary LIKE $1`, [`%${tag}%`])
    for (const id of leadIds) await api(`/leads/${id}`, { method: 'DELETE', token: admin })
    await dbQuery(`DELETE FROM invoice_register_items WHERE id LIKE $1`, [`${tag}%`])
    await dbQuery(`DELETE FROM invoice_sector_summary WHERE id LIKE $1 OR sector LIKE $1`, [`${tag}%`])
    // The leads are only soft-deleted (like every other test's), so their
    // sectors stay referenced — turn them off so no list shows them.
    await dbQuery(`UPDATE sectors SET is_active = false WHERE sector_name LIKE $1`, [`${tag}%`])
  })

  it('is for admins only', async () => {
    expect((await api('/catalog/sector', { token: employee })).status).toBe(403)
    expect((await api('/catalog/sector/history', { token: employee })).status).toBe(403)
  })

  it('a rename carries the Tracker along and reverts exactly', async () => {
    const before = await fingerprint()
    const renamed = await api<{ trackerRows: number }>(`/catalog/sector/${await sectorId(A)}/rename`, { method: 'POST', token: admin, body: { name: `${tag} Petroleum` } })
    expect(renamed.status).toBe(200)
    expect(renamed.body.trackerRows).toBe(2) // its register row and its summary row
    expect(await dbRows(`SELECT 1 FROM invoice_register_items WHERE id = $1 AND sector = $2`, [regIds[0], `${tag} Petroleum`])).toHaveLength(1)

    const reverted = await api(`/catalog/changes/${(await latestChange()).id}/revert`, { method: 'POST', token: admin })
    expect(reverted.status).toBe(200)
    expect(await fingerprint()).toEqual(before)
  })

  it('a merge adds the summary rows together, and reverts them apart again', async () => {
    const before = await fingerprint()
    const merged = await api<{ leadsMoved: number }>('/catalog/sector/merge', { method: 'POST', token: admin, body: { fromIds: [await sectorId(A)], toId: await sectorId(B) } })
    expect(merged.status).toBe(200)
    expect(merged.body.leadsMoved).toBe(1)
    const rows = await dbRows<{ apr: number; may: number; fy_target: number }>(`SELECT apr, may, fy_target FROM invoice_sector_summary WHERE id LIKE $1`, [`${tag}%`])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ apr: 21, may: 3, fy_target: 200 })
    expect(await sectorId(A)).toBeUndefined() // turned off

    const reverted = await api(`/catalog/changes/${(await latestChange()).id}/revert`, { method: 'POST', token: admin })
    expect(reverted.status).toBe(200)
    expect(await fingerprint()).toEqual(before)
  })

  it('reverts newest first, and two in a row come back exactly', async () => {
    const before = await fingerprint()
    await api(`/catalog/sector/${await sectorId(C)}/rename`, { method: 'POST', token: admin, body: { name: `${tag} Steel & Metals` } })
    const first = await latestChange()
    await api(`/catalog/sector/${await sectorId(`${tag} Steel & Metals`)}/rename`, { method: 'POST', token: admin, body: { name: `${tag} Metals` } })

    const tooEarly = await api<{ error: string }>(`/catalog/changes/${first.id}/revert`, { method: 'POST', token: admin })
    expect(tooEarly.status).toBe(409)
    expect(tooEarly.body.error).toMatch(/newer change first/)

    expect((await api(`/catalog/changes/${(await latestChange()).id}/revert`, { method: 'POST', token: admin })).status).toBe(200)
    expect((await api(`/catalog/changes/${first.id}/revert`, { method: 'POST', token: admin })).status).toBe(200)
    expect(await fingerprint()).toEqual(before)
  })

  it('removes a value no lead uses, refuses one in use, and reverts', async () => {
    const id = `${tag}-src`
    await dbQuery(`INSERT INTO lead_sources (id, source_name, is_active, updated_at) VALUES ($1, $2, true, now())`, [id, `${tag} e`])
    const sourceOf = async () => (await dbRows<{ is_active: boolean }>(`SELECT is_active FROM lead_sources WHERE id = $1`, [id]))[0].is_active

    const removed = await api<{ removed: string }>(`/catalog/source/${id}/remove`, { method: 'POST', token: admin })
    expect(removed.status).toBe(200)
    expect(await sourceOf()).toBe(false)
    const listed = await api<{ items: { id: string }[] }>('/catalog/source', { token: admin })
    expect(listed.body.items.some(i => i.id === id)).toBe(false)

    const history = await api<{ changes: Change[] }>('/catalog/source/history', { token: admin })
    const change = history.body.changes.find(c => c.summary.includes(tag))!
    expect((await api(`/catalog/changes/${change.id}/revert`, { method: 'POST', token: admin })).status).toBe(200)
    expect(await sourceOf()).toBe(true)

    // A sector still on a lead can't be removed — it has to be merged.
    const inUse = await api<{ error: string }>(`/catalog/sector/${await sectorId(C)}/remove`, { method: 'POST', token: admin })
    expect(inUse.status).toBe(409)
    expect(inUse.body.error).toMatch(/merge it/)
    expect((await api(`/catalog/source/${id}/remove`, { method: 'POST', token: employee })).status).toBe(403)

    await dbQuery(`DELETE FROM catalog_changes WHERE summary LIKE $1`, [`%${tag}%`])
    await dbQuery(`DELETE FROM lead_sources WHERE id = $1`, [id])
  })

  it('won’t revert over an edit made to the summary since', async () => {
    await api(`/catalog/sector/${await sectorId(A)}/rename`, { method: 'POST', token: admin, body: { name: `${tag} Hydrocarbons` } })
    const change = await latestChange()
    const [{ updated_at }] = await dbRows<{ updated_at: Date }>(`SELECT updated_at FROM invoice_sector_summary WHERE id = $1`, [sumIds[0]])
    await dbQuery(`UPDATE invoice_sector_summary SET updated_at = now() + interval '1 second' WHERE id = $1`, [sumIds[0]])

    const refused = await api<{ error: string }>(`/catalog/changes/${change.id}/revert`, { method: 'POST', token: admin })
    expect(refused.status).toBe(409)
    expect(refused.body.error).toMatch(/edited after this change/)

    await dbQuery(`UPDATE invoice_sector_summary SET updated_at = $2 WHERE id = $1`, [sumIds[0], updated_at])
    expect((await api(`/catalog/changes/${change.id}/revert`, { method: 'POST', token: admin })).status).toBe(200)
    expect(await sectorId(A)).toBeTruthy()
  })
})

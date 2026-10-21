import { Router, Response } from 'express'
import { z } from 'zod'
import { Prisma } from '../generated/prisma/client'
import { prisma } from '../prisma'
import { authenticate, requireAdmin, AuthRequest } from '../middleware/authenticate'
import { sendError } from '../utils/errors'
import { TX_OPTS } from '../utils/sequence'
import { recomputeSectorTotals, SUMMARY_TOTAL_SECTOR } from '../utils/trackerFields'
import { resyncAllLeadsToPipeline } from '../utils/pipelineSync'
import { sameNameKey } from '../utils/names'

// Admin data clean-up for the lookup lists leads are classified by — sectors,
// verticals, sources, service types: see how much uses each value, and merge
// duplicates ("Oil and Gas" + "Oil & Gas") into one. A merge moves every lead
// onto the kept value, turns the others off (isActive=false — kept for
// history, hidden from lists and from new leads), and brings the Tracker's
// sheet text along: register rows and pipeline rows are renamed, and sector
// summary rows are added together month by month. All in one transaction.
// Every rename and merge is recorded with a snapshot of what it changed
// (CatalogChange), and can be reverted from the screen's history.
const router = Router()
router.use(authenticate, requireAdmin)

type Kind = 'sector' | 'vertical' | 'source' | 'service-type'
type Row = { id: string; name: string }
const KINDS: Kind[] = ['sector', 'vertical', 'source', 'service-type']
const LEAD_FK = { sector: 'sectorId', vertical: 'verticalId', source: 'sourceId', 'service-type': 'serviceTypeId' } as const
const MONTHS = ['apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'jan', 'feb', 'mar'] as const
type Tx = Prisma.TransactionClient

const parseKind = (k: unknown): Kind | null => (KINDS.includes(k as Kind) ? (k as Kind) : null)

async function activeRows(db: Tx | typeof prisma, kind: Kind): Promise<Row[]> {
  const where = { isActive: true }
  switch (kind) {
    case 'sector': return (await db.sector.findMany({ where, orderBy: { sectorName: 'asc' } })).map(r => ({ id: r.id, name: r.sectorName }))
    case 'vertical': return (await db.vertical.findMany({ where, orderBy: { verticalName: 'asc' } })).map(r => ({ id: r.id, name: r.verticalName }))
    case 'source': return (await db.leadSource.findMany({ where, orderBy: { sourceName: 'asc' } })).map(r => ({ id: r.id, name: r.sourceName }))
    case 'service-type': return (await db.serviceType.findMany({ where, orderBy: { serviceTypeName: 'asc' } })).map(r => ({ id: r.id, name: r.serviceTypeName }))
  }
}

async function deactivate(tx: Tx, kind: Kind, ids: string[]) {
  const args = { where: { id: { in: ids } }, data: { isActive: false } }
  switch (kind) {
    case 'sector': return tx.sector.updateMany(args)
    case 'vertical': return tx.vertical.updateMany(args)
    case 'source': return tx.leadSource.updateMany(args)
    case 'service-type': return tx.serviceType.updateMany(args)
  }
}

type SummaryRow = Awaited<ReturnType<Tx['invoiceSectorSummary']['findMany']>>[number]
type Snapshot = {
  /** The name everything was renamed / merged to. */
  to: string
  toId: string
  /** The list values as they were (name, on/off). */
  values: { id: string; name: string; isActive: boolean }[]
  /** Leads a merge moved onto `toId`, grouped by the value they had. */
  leads: { from: string; ids: string[] }[]
  /** Tracker rows renamed, grouped by the text they had. */
  register: { sector: string | null; ids: string[] }[]
  pipeline: { vertical: string | null; ids: string[] }[]
  /** Sector summary rows as they were, and when the surviving ones were last written by the change. */
  summaryBefore: SummaryRow[]
  summaryAfter: { id: string; updatedAt: string }[]
}
const emptySnapshot = (to: string, toId: string): Snapshot => ({ to, toId, values: [], leads: [], register: [], pipeline: [], summaryBefore: [], summaryAfter: [] })

async function valueRows(tx: Tx, kind: Kind, ids: string[]): Promise<Snapshot['values']> {
  const where = { id: { in: ids } }
  switch (kind) {
    case 'sector': return (await tx.sector.findMany({ where })).map(r => ({ id: r.id, name: r.sectorName, isActive: r.isActive }))
    case 'vertical': return (await tx.vertical.findMany({ where })).map(r => ({ id: r.id, name: r.verticalName, isActive: r.isActive }))
    case 'source': return (await tx.leadSource.findMany({ where })).map(r => ({ id: r.id, name: r.sourceName, isActive: r.isActive }))
    case 'service-type': return (await tx.serviceType.findMany({ where })).map(r => ({ id: r.id, name: r.serviceTypeName, isActive: r.isActive }))
  }
}

async function setValue(tx: Tx, kind: Kind, v: Snapshot['values'][number]) {
  switch (kind) {
    case 'sector': return tx.sector.update({ where: { id: v.id }, data: { sectorName: v.name, isActive: v.isActive } })
    case 'vertical': return tx.vertical.update({ where: { id: v.id }, data: { verticalName: v.name, isActive: v.isActive } })
    case 'source': return tx.leadSource.update({ where: { id: v.id }, data: { sourceName: v.name, isActive: v.isActive } })
    case 'service-type': return tx.serviceType.update({ where: { id: v.id }, data: { serviceTypeName: v.name, isActive: v.isActive } })
  }
}

// Renames the Tracker sheet text under `fromName` (register rows for a
// sector, pipeline rows for a vertical), noting which rows had what.
async function renameSheetText(tx: Tx, kind: Kind, fromName: string, toName: string, snap: Snapshot): Promise<number> {
  if (kind === 'sector') {
    const rows = await tx.$queryRaw<{ id: string; sector: string | null }[]>`SELECT id, sector FROM invoice_register_items WHERE lower(trim(sector)) = lower(trim(${fromName}))`
    if (!rows.length) return 0
    for (const [sector, ids] of groupIds(rows, r => r.sector)) snap.register.push({ sector, ids })
    return tx.$executeRaw`UPDATE invoice_register_items SET sector = ${toName} WHERE id = ANY(${rows.map(r => r.id)})`
  }
  if (kind === 'vertical') {
    const rows = await tx.$queryRaw<{ id: string; vertical: string | null }[]>`SELECT id, vertical FROM pipeline_tracker_items WHERE lower(trim(vertical)) = lower(trim(${fromName}))`
    if (!rows.length) return 0
    for (const [vertical, ids] of groupIds(rows, r => r.vertical)) snap.pipeline.push({ vertical, ids })
    return tx.$executeRaw`UPDATE pipeline_tracker_items SET vertical = ${toName} WHERE id = ANY(${rows.map(r => r.id)})`
  }
  return 0
}

function groupIds<T extends { id: string }, K>(rows: T[], keyOf: (r: T) => K): Map<K, string[]> {
  const m = new Map<K, string[]>()
  for (const r of rows) m.set(keyOf(r), [...(m.get(keyOf(r)) ?? []), r.id])
  return m
}

// Notes when the summary rows the change touched were last written, so a
// revert can tell whether anyone has edited them since.
async function finishSnapshot(tx: Tx, snap: Snapshot) {
  if (!snap.summaryBefore.length) return
  const after = await tx.invoiceSectorSummary.findMany({ where: { id: { in: snap.summaryBefore.map(r => r.id) } } })
  snap.summaryAfter = after.map(r => ({ id: r.id, updatedAt: r.updatedAt.toISOString() }))
}

async function whoIs(userId: string | undefined): Promise<{ id: string; name: string }> {
  const u = userId ? await prisma.user.findUnique({ where: { id: userId }, select: { id: true, userName: true, email: true } }) : null
  return { id: userId ?? '', name: u?.userName || u?.email || 'An admin' }
}

// How many Tracker sheet rows carry each name (sheet text, not a link).
async function trackerCounts(kind: Kind): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  const add = (rows: { name: string | null; n: bigint | number }[]) => {
    for (const r of rows) if (r.name) counts.set(r.name, (counts.get(r.name) ?? 0) + Number(r.n))
  }
  if (kind === 'sector') {
    add(await prisma.$queryRaw<{ name: string | null; n: bigint }[]>`SELECT lower(trim(sector)) AS name, count(*) AS n FROM invoice_register_items GROUP BY 1`)
    add(await prisma.$queryRaw<{ name: string | null; n: bigint }[]>`SELECT lower(trim(sector)) AS name, count(*) AS n FROM invoice_sector_summary GROUP BY 1`)
  } else if (kind === 'vertical') {
    add(await prisma.$queryRaw<{ name: string | null; n: bigint }[]>`SELECT lower(trim(vertical)) AS name, count(*) AS n FROM pipeline_tracker_items GROUP BY 1`)
  }
  return counts
}

// GET /catalog/:kind — every active value, with what uses it, and the groups
// that look like the same name written differently.
router.get('/:kind', async (req: AuthRequest, res: Response): Promise<void> => {
  const kind = parseKind(req.params.kind)
  if (!kind) return sendError(res, 404, 'Unknown list.')
  const rows = await activeRows(prisma, kind)
  const leadCounts = await prisma.lead.groupBy({ by: [LEAD_FK[kind]], where: { deletedAt: null }, _count: { _all: true } })
  const byId = new Map(leadCounts.map(g => [(g as Record<string, unknown>)[LEAD_FK[kind]] as string | null, g._count._all]))
  const tracker = await trackerCounts(kind)

  const items = rows.map(r => ({ id: r.id, name: r.name, leads: byId.get(r.id) ?? 0, trackerRows: tracker.get(r.name.trim().toLowerCase()) ?? 0 }))
  const byKey = new Map<string, string[]>()
  for (const r of rows) { const k = sameNameKey(r.name); if (k) byKey.set(k, [...(byKey.get(k) ?? []), r.id]) }
  res.json({ items, suggestions: [...byKey.values()].filter(ids => ids.length > 1), sheetNames: await sheetNames(kind) })
})

const mergeSchema = z.object({ fromIds: z.array(z.string().min(1)).min(1).max(50), toId: z.string().min(1) })

// POST /catalog/:kind/merge { fromIds, toId } — fold `fromIds` into `toId`.
router.post('/:kind/merge', async (req: AuthRequest, res: Response): Promise<void> => {
  const kind = parseKind(req.params.kind)
  if (!kind) return sendError(res, 404, 'Unknown list.')
  const parsed = mergeSchema.safeParse(req.body)
  if (!parsed.success) return sendError(res, 400, 'Choose the values to merge and the one to keep.')
  const fromIds = parsed.data.fromIds.filter(id => id !== parsed.data.toId)
  if (fromIds.length === 0) return sendError(res, 400, 'Choose at least one value other than the one you keep.')

  const by = await whoIs(req.userId)
  const result = await prisma.$transaction(async tx => {
    const rows = await activeRows(tx, kind)
    const target = rows.find(r => r.id === parsed.data.toId)
    const from = rows.filter(r => fromIds.includes(r.id))
    if (!target || from.length !== fromIds.length) return null

    const snap = emptySnapshot(target.name, target.id)
    snap.values = await valueRows(tx, kind, fromIds)
    const fk = LEAD_FK[kind]
    const leads = await tx.lead.findMany({ where: { [fk]: { in: fromIds } }, select: { id: true, sectorId: true, verticalId: true, sourceId: true, serviceTypeId: true } })
    for (const [fromId, ids] of groupIds(leads, l => l[fk] as string)) snap.leads.push({ from: fromId, ids })

    const moved = await tx.lead.updateMany({ where: { [fk]: { in: fromIds } }, data: { [fk]: target.id } })
    await deactivate(tx, kind, fromIds)

    let trackerRows = 0
    for (const f of from) {
      trackerRows += await renameSheetText(tx, kind, f.name, target.name, snap)
      if (kind === 'sector') trackerRows += await mergeSummaryRows(tx, f.name, target.name, snap)
    }
    await finishSnapshot(tx, snap)
    const summary = `Merged ${from.map(f => `“${f.name}”`).join(', ')} into “${target.name}”`
    await tx.catalogChange.create({ data: { kind, action: 'merge', summary, leadsMoved: moved.count, trackerRows, byUserId: by.id, byName: by.name, snapshot: snap as unknown as Prisma.InputJsonValue } })
    return { kept: target.name, merged: from.map(f => f.name), leadsMoved: moved.count, trackerRows }
  }, TX_OPTS)

  if (!result) return sendError(res, 409, 'Those values have changed since the list was loaded — reload and try again.')
  // Leads synced into the Tracker show their vertical — refresh those rows.
  void resyncAllLeadsToPipeline().catch(err => console.error('[catalog] pipeline resync after merge failed:', err))
  res.json(result)
})

// The names the imported Tracker sheet uses for this list (its sector summary
// rows, its pipeline verticals) — so a value can be renamed to match the sheet.
async function sheetNames(kind: Kind): Promise<string[]> {
  if (kind === 'sector') {
    const rows = await prisma.invoiceSectorSummary.findMany({ select: { sector: true } })
    return [...new Set(rows.map(r => r.sector?.trim()).filter((n): n is string => !!n && n.toUpperCase() !== SUMMARY_TOTAL_SECTOR))]
  }
  if (kind === 'vertical') {
    const rows = await prisma.pipelineTrackerItem.findMany({ where: { sourceLeadId: null }, select: { vertical: true }, distinct: ['vertical'] })
    return [...new Set(rows.map(r => r.vertical?.trim()).filter((n): n is string => !!n))]
  }
  return []
}

async function renameRow(tx: Tx, kind: Kind, id: string, name: string) {
  switch (kind) {
    case 'sector': return tx.sector.update({ where: { id }, data: { sectorName: name } })
    case 'vertical': return tx.vertical.update({ where: { id }, data: { verticalName: name } })
    case 'source': return tx.leadSource.update({ where: { id }, data: { sourceName: name } })
    case 'service-type': return tx.serviceType.update({ where: { id }, data: { serviceTypeName: name } })
  }
}

const renameSchema = z.object({ name: z.string().trim().min(1).max(120) })

// POST /catalog/:kind/:id/rename { name } — e.g. the app's "Oil and Gas" →
// the sheet's "Oil & Gas". Every lead keeps it (they link by id); the
// Tracker's rows under the old name are renamed, and a sector summary row
// under the old name is added into the new name's row.
router.post('/:kind/:id/rename', async (req: AuthRequest, res: Response): Promise<void> => {
  const kind = parseKind(req.params.kind)
  if (!kind) return sendError(res, 404, 'Unknown list.')
  const parsed = renameSchema.safeParse(req.body)
  if (!parsed.success) return sendError(res, 400, 'Enter the new name.')
  const name = parsed.data.name

  const by = await whoIs(req.userId)
  const result = await prisma.$transaction(async tx => {
    const rows = await activeRows(tx, kind)
    const row = rows.find(r => r.id === req.params.id)
    if (!row) return { error: 'That value no longer exists — reload and try again.' }
    const clash = rows.find(r => r.id !== row.id && sameNameKey(r.name) === sameNameKey(name))
    if (clash) return { error: `“${clash.name}” already exists — merge into it instead.` }
    if (row.name === name) return { renamed: name, from: row.name, trackerRows: 0 }

    const snap = emptySnapshot(name, row.id)
    snap.values = await valueRows(tx, kind, [row.id])
    await renameRow(tx, kind, row.id, name)
    let trackerRows = await renameSheetText(tx, kind, row.name, name, snap)
    if (kind === 'sector') trackerRows += await mergeSummaryRows(tx, row.name, name, snap)
    await finishSnapshot(tx, snap)
    await tx.catalogChange.create({ data: { kind, action: 'rename', summary: `Renamed “${row.name}” to “${name}”`, trackerRows, byUserId: by.id, byName: by.name, snapshot: snap as unknown as Prisma.InputJsonValue } })
    return { renamed: name, from: row.name, trackerRows }
  }, TX_OPTS)

  if ('error' in result) return sendError(res, 409, result.error!)
  void resyncAllLeadsToPipeline().catch(err => console.error('[catalog] pipeline resync after rename failed:', err))
  res.json(result)
})

// GET /catalog/:kind/history — the renames and merges made here, newest first.
router.get('/:kind/history', async (req: AuthRequest, res: Response): Promise<void> => {
  const kind = parseKind(req.params.kind)
  if (!kind) return sendError(res, 404, 'Unknown list.')
  const changes = await prisma.catalogChange.findMany({
    where: { kind },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, action: true, summary: true, leadsMoved: true, trackerRows: true, byName: true, createdAt: true, revertedAt: true, revertedByName: true },
  })
  res.json({ changes })
})

// POST /catalog/changes/:id/revert — puts back exactly what one change
// altered, from its snapshot. Only the newest change still in force for its
// list can be reverted (later ones may build on it), and not if a sector
// summary row it touched has been edited since — that edit would be lost.
router.post('/changes/:id/revert', async (req: AuthRequest, res: Response): Promise<void> => {
  const by = await whoIs(req.userId)
  const result = await prisma.$transaction(async tx => {
    const change = await tx.catalogChange.findUnique({ where: { id: String(req.params.id) } })
    if (!change) return { status: 404, error: 'That change no longer exists.' }
    if (change.revertedAt) return { status: 409, error: 'This change has already been reverted.' }
    const kind = parseKind(change.kind)!
    const newer = await tx.catalogChange.findFirst({ where: { kind, revertedAt: null, createdAt: { gt: change.createdAt } }, orderBy: { createdAt: 'desc' } })
    if (newer) return { status: 409, error: `Revert the newer change first: ${newer.summary}.` }
    const snap = change.snapshot as unknown as Snapshot

    // The summary rows must be as the change left them.
    for (const a of snap.summaryAfter) {
      const now = await tx.invoiceSectorSummary.findUnique({ where: { id: a.id }, select: { updatedAt: true, sector: true } })
      if (!now) return { status: 409, error: 'The sector summary has been re-imported since this change, so it can’t be reverted automatically.' }
      if (now.updatedAt.toISOString() !== a.updatedAt) return { status: 409, error: `The “${now.sector}” row of the sector summary was edited after this change — revert that edit first, or fix it by hand.` }
    }
    // A name being given back mustn't clash with a value added since.
    const active = await activeRows(tx, kind)
    for (const v of snap.values) {
      const clash = active.find(r => r.id !== v.id && r.id !== snap.toId && sameNameKey(r.name) === sameNameKey(v.name))
      if (clash) return { status: 409, error: `“${clash.name}” has been added since — merge or rename it first.` }
    }

    for (const v of snap.values) await setValue(tx, kind, v)
    const fk = LEAD_FK[kind]
    let leads = 0
    for (const g of snap.leads) leads += (await tx.lead.updateMany({ where: { id: { in: g.ids }, [fk]: snap.toId }, data: { [fk]: g.from } })).count
    let rows = 0
    for (const g of snap.register) rows += await tx.$executeRaw`UPDATE invoice_register_items SET sector = ${g.sector} WHERE id = ANY(${g.ids}) AND sector = ${snap.to}`
    for (const g of snap.pipeline) rows += await tx.$executeRaw`UPDATE pipeline_tracker_items SET vertical = ${g.vertical} WHERE id = ANY(${g.ids}) AND vertical = ${snap.to}`
    for (const r of snap.summaryBefore) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, createdAt, updatedAt, ...data } = r
      await tx.invoiceSectorSummary.upsert({ where: { id }, update: data, create: { id, ...data } })
      rows++
    }
    if (snap.summaryBefore.length) {
      // The rows go back exactly as saved; only the TOTAL row is worked out
      // again, as the sum of the sector rows now.
      const total = (await tx.invoiceSectorSummary.findMany({ select: { id: true, sector: true } })).find(r => (r.sector ?? '').trim().toUpperCase() === SUMMARY_TOTAL_SECTOR)
      if (total) await recomputeSectorTotals(tx, total.id)
      // Back to their old "last written" too, so the change before this one
      // still sees them as it left them and can be reverted next.
      for (const r of snap.summaryBefore) await tx.$executeRaw`UPDATE invoice_sector_summary SET updated_at = ${new Date(r.updatedAt)} WHERE id = ${r.id}`
    }

    await tx.catalogChange.update({ where: { id: change.id }, data: { revertedAt: new Date(), revertedByName: by.name } })
    return { status: 200, summary: change.summary, leadsMoved: leads, trackerRows: rows }
  }, TX_OPTS)

  if (result.status !== 200) return sendError(res, result.status, result.error!)
  void resyncAllLeadsToPipeline().catch(err => console.error('[catalog] pipeline resync after revert failed:', err))
  res.json(result)
})

// The sector summary keeps one row per sector name. Merging a sector adds its
// row's months and FY target into the kept sector's row (or renames it when
// the kept one has no row yet), then recomputes the totals and the TOTAL row.
async function mergeSummaryRows(tx: Tx, fromName: string, toName: string, snap: Snapshot): Promise<number> {
  const same = (a: string | null, b: string) => (a ?? '').trim().toLowerCase() === b.trim().toLowerCase()
  const rows = await tx.invoiceSectorSummary.findMany()
  const sources = rows.filter(r => same(r.sector, fromName) && !same(r.sector, SUMMARY_TOTAL_SECTOR))
  if (sources.length === 0) return 0
  let target = rows.find(r => same(r.sector, toName))
  for (const r of [...sources, ...(target ? [target] : [])]) if (!snap.summaryBefore.some(b => b.id === r.id)) snap.summaryBefore.push(r)
  for (const src of sources) {
    if (!target) {
      target = await tx.invoiceSectorSummary.update({ where: { id: src.id }, data: { sector: toName } })
      continue
    }
    const sum = (a: number | null, b: number | null) => (a == null && b == null ? null : Math.round(((a ?? 0) + (b ?? 0)) * 100) / 100)
    const data: Record<string, number | null> = Object.fromEntries(MONTHS.map(m => [m, sum(target![m], src[m])]))
    data.fyTarget = sum(target.fyTarget, src.fyTarget)
    target = await tx.invoiceSectorSummary.update({ where: { id: target.id }, data })
    await tx.invoiceSectorSummary.delete({ where: { id: src.id } })
  }
  await recomputeSectorTotals(tx, target!.id)
  return sources.length
}

export default router

// Scheduled pull of the live business tracker workbook (SharePoint / OneDrive)
// into the Tracker's sheet rows.
//
// The workbook is the source of truth for the Tracker's *sheet* rows: each
// sync replaces them with what the workbook says now. Rows that come from the
// app itself — leads (sourceLeadId) and invoices (sourceInvoiceId) — are never
// touched, and the app invoices' amounts are added back onto the sheet's
// sector summary afterwards, so the totals keep counting them exactly once.
//
// Where the file comes from (environment, see PORTAINER_DEPLOYMENT.md):
//  - Microsoft Graph, app-only: SHEET_SYNC_CLIENT_SECRET (+ the client and
//    tenant ids, defaulting to MS_CLIENT_ID / MS_TENANT_ID), and either
//    SHEET_SYNC_DRIVE_ID + SHEET_SYNC_ITEM_ID or SHEET_SYNC_SHARE_URL;
//  - or SHEET_SYNC_FILE, a workbook path on the server (testing / fallback).
// None set → the sync is off and the Tracker only changes as before.
//
// Safety: nothing is written unless the whole workbook reads correctly (tabs
// and headings found), and a workbook with far fewer rows than the Tracker has
// now is refused as a likely wrong or half-empty file (an admin can override
// that on a manual run). The replace happens in one transaction, so a failure
// part-way leaves the Tracker exactly as it was.
import crypto from 'crypto'
import fs from 'fs'
import { prisma } from '../prisma'
import { Prisma } from '../generated/prisma/client'
import { parseTrackerWorkbook, SheetError, TrackerSheetData } from './trackerSheet'
import { reapplyAppInvoiceContributions } from '../utils/invoiceTrackerSync'
import { notifyUser } from './notify'
import { syncLeadsFromSheet } from './sheetLeads'
import { ROLES } from '../utils/roles'

const GRAPH = 'https://graph.microsoft.com/v1.0'
const MAX_FILE_BYTES = 25 * 1024 * 1024
const CHECK_EVERY_MS = 5 * 60 * 1000 // how often the scheduler looks whether a run is due
const STALE_RUN_MS = 30 * 60 * 1000 // a "running" row older than this was cut off (restart) — counts as failed

// ─── configuration ──────────────────────────────────────────────────────────

type Source =
  | { kind: 'graph'; tenantId: string; clientId: string; clientSecret: string; driveId?: string; itemId?: string; shareUrl?: string }
  | { kind: 'file'; path: string }

const env = (k: string) => process.env[k]?.trim() || undefined

export function sheetSyncSource(): Source | null {
  const file = env('SHEET_SYNC_FILE')
  if (file) return { kind: 'file', path: file }
  const shareUrl = env('SHEET_SYNC_SHARE_URL')
  const driveId = env('SHEET_SYNC_DRIVE_ID')
  const itemId = env('SHEET_SYNC_ITEM_ID')
  if (!shareUrl && !(driveId && itemId)) return null
  return {
    kind: 'graph',
    tenantId: env('SHEET_SYNC_TENANT_ID') ?? env('MS_TENANT_ID') ?? '',
    clientId: env('SHEET_SYNC_CLIENT_ID') ?? env('MS_CLIENT_ID') ?? '',
    clientSecret: env('SHEET_SYNC_CLIENT_SECRET') ?? '',
    driveId, itemId, shareUrl,
  }
}

// How often the sync runs, in minutes: SHEET_SYNC_EVERY_MINUTES, default 60,
// never less than 15 (each run downloads and re-reads the whole workbook).
export function sheetSyncEveryMinutes(): number {
  const m = Number(env('SHEET_SYNC_EVERY_MINUTES') ?? 60)
  return Number.isFinite(m) ? Math.max(15, Math.round(m)) : 60
}

// ─── fetching the workbook ──────────────────────────────────────────────────

class FetchError extends Error {}

async function graphToken(s: Extract<Source, { kind: 'graph' }>): Promise<string> {
  if (!s.tenantId || !s.clientId || !s.clientSecret) {
    throw new FetchError('Microsoft access isn’t set up: SHEET_SYNC_CLIENT_SECRET, and MS_TENANT_ID / MS_CLIENT_ID (or SHEET_SYNC_TENANT_ID / SHEET_SYNC_CLIENT_ID), must all be set.')
  }
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(s.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: s.clientId, client_secret: s.clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
    signal: AbortSignal.timeout(30000),
  })
  const body = await res.json().catch(() => ({})) as { access_token?: string; error?: string; error_description?: string }
  if (!res.ok || !body.access_token) {
    throw new FetchError(`Microsoft sign-in for the sync failed (${body.error ?? res.status}): ${(body.error_description ?? '').split('\r\n')[0] || 'no details'}. Check SHEET_SYNC_CLIENT_SECRET hasn’t expired.`)
  }
  return body.access_token
}

// A sharing link as Graph's /shares id: "u!" + unpadded base64url of the URL.
const shareId = (url: string) => `u!${Buffer.from(url, 'utf8').toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-')}`

type FileInfo = { name: string; modified: string | null; driveId: string | null; itemId: string | null }

async function graphGet(token: string, path: string): Promise<Response> {
  const res = await fetch(`${GRAPH}${path}`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'follow', signal: AbortSignal.timeout(60000) })
  if (!res.ok) {
    const detail = await res.json()
      .then(b => { const err = (b as { error?: { code?: string; message?: string } }).error; return `${err?.code ?? ''} ${err?.message ?? ''}`.trim() })
      .catch(() => '')
    const hint = res.status === 401 || res.status === 403
      ? ' The app registration needs read access to this file (Files.Read.All, or Sites.Selected with this site granted), with admin consent.'
      : res.status === 404 ? ' The file wasn’t found — it may have been moved, renamed or deleted, or the link/ids are wrong.' : ''
    throw new FetchError(`Couldn’t read the workbook from Microsoft (${res.status}${detail ? `: ${detail}` : ''}).${hint}`)
  }
  return res
}

async function readCapped(res: Response): Promise<Buffer> {
  const len = Number(res.headers.get('content-length') ?? 0)
  if (len > MAX_FILE_BYTES) throw new FetchError(`The workbook is too large (${Math.round(len / 1048576)} MB).`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_FILE_BYTES) throw new FetchError(`The workbook is too large (${Math.round(buf.length / 1048576)} MB).`)
  return buf
}

export async function fetchWorkbook(source: Source): Promise<{ buf: Buffer; info: FileInfo }> {
  if (source.kind === 'file') {
    if (!fs.existsSync(source.path)) throw new FetchError(`SHEET_SYNC_FILE: no file at ${source.path}.`)
    const stat = fs.statSync(source.path)
    if (stat.size > MAX_FILE_BYTES) throw new FetchError('The workbook is too large.')
    return { buf: fs.readFileSync(source.path), info: { name: source.path, modified: stat.mtime.toISOString(), driveId: null, itemId: null } }
  }
  const token = await graphToken(source)
  const item = source.driveId && source.itemId
    ? `/drives/${encodeURIComponent(source.driveId)}/items/${encodeURIComponent(source.itemId)}`
    : `/shares/${shareId(source.shareUrl!)}/driveItem`
  const meta = await (await graphGet(token, item)).json() as { name?: string; lastModifiedDateTime?: string; id?: string; parentReference?: { driveId?: string }; file?: unknown }
  if (!meta.file) throw new FetchError('The configured link/ids point to a folder, not the workbook file.')
  const buf = await readCapped(await graphGet(token, `${item}/content`))
  return { buf, info: { name: meta.name ?? 'workbook', modified: meta.lastModifiedDateTime ?? null, driveId: meta.parentReference?.driveId ?? null, itemId: meta.id ?? null } }
}

// ─── applying it ────────────────────────────────────────────────────────────

type Counts = { rows: number; kept: number; added: number; removed: number }
export type SyncChanges = { pipeline: Counts; register: Counts; summary: Counts; appInvoicesReapplied: number }

// A row's content, for spotting rows the sync leaves exactly as they were —
// those keep their id, so a pending change request on one still applies.
const DROP = new Set(['id', 'sortOrder', 'createdAt', 'updatedAt', 'sourceLeadId', 'sourceInvoiceId'])
const signature = (row: Record<string, unknown>) =>
  JSON.stringify(Object.keys(row).filter(k => !DROP.has(k)).sort().map(k => {
    const v = row[k]
    return [k, v instanceof Date ? v.toISOString() : v ?? null]
  }))

// Gives each new row the id of an identical current row (each used once).
function matchIds<T extends Record<string, unknown>>(current: (Record<string, unknown> & { id: string })[], incoming: T[], keyOf: (r: Record<string, unknown>) => string): { rows: (T & { id?: string })[]; counts: Counts } {
  const pool = new Map<string, string[]>()
  for (const r of current) {
    const k = keyOf(r)
    pool.set(k, [...(pool.get(k) ?? []), r.id])
  }
  let kept = 0
  const rows = incoming.map(r => {
    const id = pool.get(keyOf(r))?.shift()
    if (id) { kept++; return { ...r, id } }
    return { ...r }
  })
  return { rows, counts: { rows: incoming.length, kept, added: incoming.length - kept, removed: current.length - kept } }
}

// A workbook with under half the rows the Tracker has now is most likely the
// wrong file, a copy someone cleared, or a sheet mid-edit.
function shrinkProblem(label: string, now: number, incoming: number): string | null {
  return now >= 20 && incoming < now * 0.5 ? `${label}: the workbook has ${incoming} rows, the Tracker has ${now}` : null
}

export async function applySheetData(data: TrackerSheetData, opts: { force?: boolean } = {}): Promise<SyncChanges> {
  return prisma.$transaction(async tx => {
    // Writers to these tables (the app's lead / invoice syncs, admin edits)
    // wait until this replace has committed; plain reads carry on.
    await tx.$executeRaw`LOCK TABLE pipeline_tracker_items, invoice_register_items, invoice_sector_summary IN EXCLUSIVE MODE`

    const [pipeNow, regNow, sumNow] = await Promise.all([
      tx.pipelineTrackerItem.findMany({ where: { sourceLeadId: null } }),
      tx.invoiceRegisterItem.findMany({ where: { sourceInvoiceId: null } }),
      tx.invoiceSectorSummary.findMany(),
    ])

    if (!opts.force) {
      const problems = [shrinkProblem('Pipeline', pipeNow.length, data.pipeline.length), shrinkProblem('Invoice register', regNow.length, data.register.length)].filter(Boolean)
      if (problems.length) throw new SheetError(`Not synced — ${problems.join('; ')}. If that’s really right, an admin can run the sync by hand with “apply anyway”.`)
    }

    const pipe = matchIds(pipeNow, data.pipeline, signature)
    const reg = matchIds(regNow, data.register, signature)
    // Sector rows keep their id by sector name: their figures include the
    // app's invoices, so their content never matches the sheet's exactly.
    const sum = matchIds(sumNow, data.summary, r => String(r.sector ?? '').trim().toLowerCase())

    await tx.pipelineTrackerItem.deleteMany({ where: { sourceLeadId: null } })
    await tx.invoiceRegisterItem.deleteMany({ where: { sourceInvoiceId: null } })
    await tx.invoiceSectorSummary.deleteMany()
    await tx.pipelineTrackerItem.createMany({ data: pipe.rows as Prisma.PipelineTrackerItemCreateManyInput[] })
    await tx.invoiceRegisterItem.createMany({ data: reg.rows as Prisma.InvoiceRegisterItemCreateManyInput[] })
    await tx.invoiceSectorSummary.createMany({ data: sum.rows as Prisma.InvoiceSectorSummaryCreateManyInput[] })

    const appInvoicesReapplied = await reapplyAppInvoiceContributions(tx)
    return { pipeline: pipe.counts, register: reg.counts, summary: sum.counts, appInvoicesReapplied }
  }, { maxWait: 30000, timeout: 120000 })
}

// ─── one run ────────────────────────────────────────────────────────────────

const describe = (c: SyncChanges) => {
  const part = (label: string, k: Counts) => `${label} ${k.rows}${k.added || k.removed ? ` (${k.added} new/changed, ${k.removed} removed)` : ''}`
  return `${part('Pipeline', c.pipeline)} · ${part('Invoices', c.register)} · ${part('Sector rows', c.summary)}`
}

let running: Promise<unknown> | null = null

export type RunResult = { id: string; status: 'success' | 'failed'; message: string }

/** Pulls the workbook and applies it. Only one run at a time per server. */
export async function runSheetSync(trigger: 'schedule' | 'manual' | 'script', opts: { userName?: string | null; force?: boolean } = {}): Promise<RunResult> {
  if (running) throw new SheetError('A sync is already running — try again in a minute.')
  const source = sheetSyncSource()
  if (!source) throw new SheetError('The sheet sync isn’t configured on this server (see PORTAINER_DEPLOYMENT.md, “Daily sync from the SharePoint sheet”).')

  const run = await prisma.sheetSyncRun.create({ data: { trigger, userName: opts.userName ?? null } })
  const work = (async (): Promise<RunResult> => {
    try {
      const { buf, info } = await fetchWorkbook(source)
      const data = parseTrackerWorkbook(buf)
      const changes = await applySheetData(data, { force: opts.force })
      const modified = info.modified ? ` (file last changed ${new Date(info.modified).toISOString().slice(0, 16).replace('T', ' ')} UTC)` : ''
      // The sheet's deals become leads / proposals / projects for the people named
      // in it. A failure here never fails the sync itself.
      const leads = await syncLeadsFromSheet().catch(err => { console.error('[sheet leads] failed:', err instanceof Error ? err.message : err); return null })
      const leadsNote = leads ? ` · Leads: ${leads.created} new, ${leads.updated} updated${leads.unassigned ? `, ${leads.unassigned} with no matching owner` : ''}` : ''
      const message = `${describe(changes)}${modified}${leadsNote}`
      await prisma.sheetSyncRun.update({
        where: { id: run.id },
        data: { status: 'success', finishedAt: new Date(), message, fileHash: crypto.createHash('sha256').update(buf).digest('hex'), changes: changes as unknown as Prisma.InputJsonValue },
      })
      console.log(`[sheet sync] ${trigger}: ${message}`)
      // Found through a sharing link: print the file's permanent ids, which
      // keep working if the link is changed or switched off.
      if (source.kind === 'graph' && !source.driveId && info.driveId) console.log(`[sheet sync] file ids — SHEET_SYNC_DRIVE_ID=${info.driveId} SHEET_SYNC_ITEM_ID=${info.itemId}`)
      return { id: run.id, status: 'success', message }
    } catch (e) {
      const known = e instanceof SheetError || e instanceof FetchError
      const message = known ? (e as Error).message : `Unexpected error: ${e instanceof Error ? e.message : String(e)}`
      if (!known) console.error('[sheet sync] failed:', e)
      else console.error(`[sheet sync] ${trigger} failed: ${message}`)
      await prisma.sheetSyncRun.update({ where: { id: run.id }, data: { status: 'failed', finishedAt: new Date(), message } }).catch(() => {})
      if (trigger === 'schedule') await alertAdminsOnce(run.id, message)
      return { id: run.id, status: 'failed', message }
    }
  })()
  running = work
  try { return await work } finally { running = null }
}

// Tells every active admin when the scheduled sync starts failing — once,
// not on every retry: only when the run before this one didn't fail.
async function alertAdminsOnce(runId: string, message: string) {
  try {
    const previous = await prisma.sheetSyncRun.findFirst({ where: { id: { not: runId }, status: { not: 'running' } }, orderBy: { startedAt: 'desc' } })
    if (previous?.status === 'failed') return
    const admins = await prisma.user.findMany({ where: { role: ROLES.admin, isActive: true }, select: { id: true } })
    for (const a of admins) await notifyUser(a.id, `The sync from the SharePoint tracker sheet failed — the Tracker still shows the last synced data. ${message}`.slice(0, 1000))
  } catch (err) {
    console.error('[sheet sync] could not notify admins:', err instanceof Error ? err.message : err)
  }
}

// ─── schedule ───────────────────────────────────────────────────────────────

// Due when no run (successful or not) has started within the sync interval —
// so a server that was down catches up when it's back, and a failure is
// retried once per interval rather than on every check.
async function syncDue(now: Date): Promise<boolean> {
  await prisma.sheetSyncRun.updateMany({
    where: { status: 'running', startedAt: { lt: new Date(now.getTime() - STALE_RUN_MS) } },
    data: { status: 'failed', finishedAt: now, message: 'Interrupted (the server restarted mid-sync). Nothing was changed.' },
  })
  const recent = await prisma.sheetSyncRun.findFirst({ where: { startedAt: { gte: new Date(now.getTime() - sheetSyncEveryMinutes() * 60000) } } })
  return !recent
}

export function startSheetSyncJob(): void {
  const source = sheetSyncSource()
  if (!source) { console.log('[sheet sync] off (no SHEET_SYNC_* source configured)'); return }
  console.log(`[sheet sync] on — every ${sheetSyncEveryMinutes()} minutes, from ${source.kind === 'file' ? source.path : source.driveId ? 'SharePoint (drive/item id)' : 'SharePoint (sharing link)'}`)
  const tick = () => {
    syncDue(new Date())
      .then(due => (due && !running ? runSheetSync('schedule') : null))
      .catch(err => console.error('[sheet sync] scheduler error:', err instanceof Error ? err.message : err))
  }
  // First look a minute after start-up, once the app's own start-up re-syncs are done.
  setTimeout(tick, 60 * 1000)
  // The Tracker rows may already be there (an earlier sync or import) — turn them
  // into leads without waiting for the next sheet sync.
  setTimeout(() => {
    syncLeadsFromSheet()
      .then(r => { if (r) console.log(`[sheet leads] ${r.created} new, ${r.updated} updated, ${r.unchanged} unchanged, ${r.unassigned} with no matching owner`) })
      .catch(err => console.error('[sheet leads] failed:', err instanceof Error ? err.message : err))
  }, 90 * 1000)
  setInterval(tick, CHECK_EVERY_MS)
}

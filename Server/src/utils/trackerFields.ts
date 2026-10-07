import { Prisma } from '../generated/prisma/client'
import type { PipelineTrackerItem, InvoiceRegisterItem, InvoiceSectorSummary } from '../generated/prisma/client'

type Db = Prisma.TransactionClient

// The tracker tables an edit (an admin's own, or an approved employee
// request — see routes/trackerRequests.ts) can change, and which of their
// fields. Only rows from the Excel import are editable: rows synced from app
// leads / invoices are rebuilt from that record on every change, so an edit
// there would just be overwritten — those are changed on the lead or invoice.
// Totals on the sector summary aren't editable either; they're recomputed
// from the months whenever an amount changes (see recomputeSectorTotals).

// 'longtext' is text the form shows as a larger box.
export type FieldKind = 'text' | 'longtext' | 'number' | 'int' | 'date'
export type TrackerTable = 'pipeline' | 'invoiceRegister' | 'sectorSummary'

// Field keys are typed against the database models, so renaming a column
// without updating this list is a compile error, not a silently broken form.
type FieldDef<K extends string> = { key: K; label: string; kind: FieldKind; hint?: string }
type TableDef<M> = {
  title: string
  // How a row is named in requests and notifications: the label field, plus
  // the first non-blank detail field ("JSW Steel · Thermography").
  labelField: keyof M & string
  detailFields: (keyof M & string)[]
  fields: FieldDef<keyof M & string>[]
}

// The sector summary's grand-total row, named so in the imported sheet.
export const SUMMARY_TOTAL_SECTOR = 'TOTAL'
const isTotalSector = (v: unknown) => typeof v === 'string' && v.trim().toUpperCase() === SUMMARY_TOTAL_SECTOR

// Financial-year months, in order, as the sector summary's columns; each run
// of three is a quarter (q1Total … q4Total).
const MONTHS = ['apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'jan', 'feb', 'mar'] as const
type Month = (typeof MONTHS)[number]
const QUARTERS = [0, 1, 2, 3].map(q => MONTHS.slice(q * 3, q * 3 + 3))
const monthLabel = (m: Month) => `${m[0].toUpperCase()}${m.slice(1)} (₹L)`

// Sent to the client as-is (GET /tracker/fields), which builds its edit form
// and change lists from it — the one definition of what's editable.
export const TRACKER_TABLES: {
  pipeline: TableDef<PipelineTrackerItem>
  invoiceRegister: TableDef<InvoiceRegisterItem>
  sectorSummary: TableDef<InvoiceSectorSummary>
} = {
  pipeline: {
    title: 'Pipeline tracker',
    labelField: 'client',
    detailFields: ['service', 'location'],
    fields: [
      { key: 'vertical', label: 'Vertical', kind: 'text' },
      { key: 'client', label: 'Client', kind: 'text' },
      { key: 'location', label: 'Location', kind: 'text' },
      { key: 'service', label: 'Service', kind: 'text' },
      { key: 'description', label: 'Description', kind: 'longtext' },
      { key: 'valueLakhs', label: 'Value', kind: 'number', hint: 'In lakhs for INR; plain amount for other currencies' },
      { key: 'currency', label: 'Currency', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'text' },
      { key: 'probabilityPct', label: 'Probability (%)', kind: 'int' },
      { key: 'expectedClose', label: 'Expected close', kind: 'text' },
      { key: 'owner', label: 'Owner', kind: 'text' },
      { key: 'bmContact', label: 'BM/Contact', kind: 'text' },
      { key: 'followUpDate', label: 'Follow-up date', kind: 'text' },
      { key: 'lastAction', label: 'Last action', kind: 'longtext' },
      { key: 'flagAction', label: 'Flag / action', kind: 'text' },
      { key: 'priority', label: 'Priority', kind: 'text' },
      { key: 'notes', label: 'Notes', kind: 'longtext' },
    ],
  },
  invoiceRegister: {
    title: 'Invoice register',
    labelField: 'client',
    detailFields: ['invoiceNumber', 'poNumber'],
    fields: [
      { key: 'sector', label: 'Sector', kind: 'text' },
      { key: 'client', label: 'Client', kind: 'text' },
      { key: 'location', label: 'Location', kind: 'text' },
      { key: 'poNumber', label: 'PO / WO number', kind: 'text' },
      { key: 'orderValueLakhs', label: 'Order value (₹L)', kind: 'number' },
      { key: 'serviceType', label: 'Service type', kind: 'text' },
      { key: 'bmOwner', label: 'BM owner', kind: 'text' },
      { key: 'workCompletionDate', label: 'Work completion', kind: 'text' },
      { key: 'invoiceRaised', label: 'Invoice raised?', kind: 'text' },
      { key: 'invoiceNumber', label: 'Invoice number', kind: 'text' },
      { key: 'invoiceDate', label: 'Invoice date', kind: 'date' },
      { key: 'invoiceAmountLakhs', label: 'Invoice amount (₹L)', kind: 'number' },
      { key: 'tdsDeduction', label: 'TDS/deduction (₹L)', kind: 'number' },
      { key: 'invoiceMonth', label: 'Invoice month', kind: 'text' },
      { key: 'dueDate', label: 'Due date', kind: 'text' },
      { key: 'paymentReceived', label: 'Payment received?', kind: 'text', hint: 'Yes / No' },
      { key: 'currentManager', label: 'Current manager', kind: 'text' },
      { key: 'paymentDate', label: 'Payment date', kind: 'date' },
      { key: 'amountCollectedLakhs', label: 'Amount collected (₹L)', kind: 'number' },
      { key: 'balanceOutstandingLakhs', label: 'Balance outstanding (₹L)', kind: 'number' },
      { key: 'daysToCollect', label: 'Days to collect', kind: 'int' },
      { key: 'dsoStatus', label: 'DSO status', kind: 'text' },
      { key: 'remarks', label: 'Remarks', kind: 'longtext' },
      { key: 'nextActionDate', label: 'Next action date', kind: 'text' },
    ],
  },
  sectorSummary: {
    title: 'Sector summary',
    labelField: 'sector',
    detailFields: [],
    fields: [
      { key: 'sector', label: 'Sector', kind: 'text' },
      { key: 'bmOwner', label: 'BM / Owner', kind: 'text' },
      ...MONTHS.map(m => ({ key: m, label: monthLabel(m), kind: 'number' as const })),
      { key: 'fyTarget', label: 'FY target (₹L)', kind: 'number' },
      { key: 'remarks', label: 'Remarks', kind: 'longtext' },
    ],
  },
}

const tableDef = (table: TrackerTable) => TRACKER_TABLES[table] as unknown as TableDef<Record<string, unknown>>

// key → kind, per table, for validating and writing values.
export const TRACKER_FIELDS = Object.fromEntries((Object.keys(TRACKER_TABLES) as TrackerTable[]).map(table => [
  table, Object.fromEntries(tableDef(table).fields.map(f => [f.key, f.kind])),
])) as Record<TrackerTable, Record<string, FieldKind>>

export const tableTitle = (table: TrackerTable) => TRACKER_TABLES[table].title

export const isTrackerTable = (t: unknown): t is TrackerTable => typeof t === 'string' && t in TRACKER_TABLES

// A value as stored in a change request / sent to the client: plain JSON,
// with dates as YYYY-MM-DD.
export type JsonValue = string | number | null

export function toJsonValue(v: unknown): JsonValue {
  if (v == null) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'number' || typeof v === 'string') return v
  return String(v)
}

// Checks and normalises one submitted value for its field. Blank means "clear
// it". Returns the value to store, or an error message for the user.
export function parseFieldValue(kind: FieldKind, raw: unknown): { ok: true; value: JsonValue } | { ok: false; error: string } {
  if (raw == null || (typeof raw === 'string' && raw.trim() === '')) return { ok: true, value: null }
  switch (kind) {
    case 'text':
    case 'longtext': {
      if (typeof raw !== 'string' && typeof raw !== 'number') return { ok: false, error: 'must be text' }
      const s = String(raw).trim()
      return s.length > 2000 ? { ok: false, error: 'is too long (2,000 characters at most)' } : { ok: true, value: s }
    }
    case 'number':
    case 'int': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, '').trim())
      if (!Number.isFinite(n)) return { ok: false, error: 'must be a number' }
      if (kind === 'int' && !Number.isInteger(n)) return { ok: false, error: 'must be a whole number' }
      if (Math.abs(n) > 1e9) return { ok: false, error: 'is too large' }
      return { ok: true, value: n }
    }
    case 'date': {
      const s = String(raw).trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())) return { ok: false, error: 'must be a date (YYYY-MM-DD)' }
      return { ok: true, value: s }
    }
  }
}

// JSON value → what Prisma expects for that field's column.
function toDbValue(kind: FieldKind, v: JsonValue): string | number | Date | null {
  if (v == null) return null
  return kind === 'date' ? new Date(`${v}T00:00:00Z`) : v
}

export const sameValue = (a: JsonValue, b: JsonValue) => (a ?? null) === (b ?? null)

// ─── row access ─────────────────────────────────────────────────────────────

export type TrackerRow = Record<string, unknown> & { id: string }

export async function findTrackerRow(db: Db, table: TrackerTable, id: string): Promise<TrackerRow | null> {
  if (table === 'pipeline') return db.pipelineTrackerItem.findUnique({ where: { id } })
  if (table === 'invoiceRegister') return db.invoiceRegisterItem.findUnique({ where: { id } })
  return db.invoiceSectorSummary.findUnique({ where: { id } })
}

// Why a row can't be edited at all, or null if it can.
export function rowLockReason(table: TrackerTable, row: TrackerRow): string | null {
  if (table === 'pipeline' && row.sourceLeadId) return 'This row comes from a lead in the app — change the lead instead.'
  if (table === 'invoiceRegister' && row.sourceInvoiceId) return 'This row comes from an invoice in the app — change the invoice instead.'
  if (table === 'sectorSummary' && isTotalSector(row.sector)) return `The ${SUMMARY_TOTAL_SECTOR} row is worked out from the sector rows and can’t be edited.`
  return null
}

// A readable name for a row, from its table's label and detail fields.
export function rowLabel(table: TrackerTable, row: TrackerRow): string {
  const def = tableDef(table)
  const text = (k: string) => (typeof row[k] === 'string' && (row[k] as string).trim() ? (row[k] as string).trim() : null)
  const name = text(def.labelField) ?? `Unnamed ${def.title.toLowerCase()} row`
  const detail = def.detailFields.map(text).find(Boolean)
  return detail ? `${name} · ${detail}` : name
}

export type FieldChange = { from: JsonValue; to: JsonValue }

// Validates submitted values against the row: unknown fields and bad values
// are errors; values equal to what's already there are dropped. Returns the
// real changes, keyed by field.
export function diffChanges(table: TrackerTable, row: TrackerRow, submitted: Record<string, unknown>):
  { ok: true; changes: Record<string, FieldChange> } | { ok: false; error: string } {
  const fields = TRACKER_FIELDS[table]
  const labelOf = (key: string) => tableDef(table).fields.find(f => f.key === key)?.label ?? key
  const changes: Record<string, FieldChange> = {}
  for (const [field, raw] of Object.entries(submitted)) {
    const kind = fields[field]
    if (!kind) return { ok: false, error: `“${field}” can’t be changed.` }
    const parsed = parseFieldValue(kind, raw)
    if (!parsed.ok) return { ok: false, error: `${labelOf(field)} ${parsed.error}.` }
    const from = toJsonValue(row[field])
    if (!sameValue(from, parsed.value)) changes[field] = { from, to: parsed.value }
  }
  if (table === 'sectorSummary' && isTotalSector(changes.sector?.to)) {
    return { ok: false, error: `A sector can’t be renamed to ${SUMMARY_TOTAL_SECTOR}.` }
  }
  return { ok: true, changes }
}

// Writes the changes to the row. On the sector summary, then recomputes that
// row's quarter / FY totals and achievement, and the total row.
export async function applyTrackerChanges(db: Db, table: TrackerTable, id: string, changes: Record<string, FieldChange>): Promise<void> {
  const fields = TRACKER_FIELDS[table]
  const data = Object.fromEntries(Object.entries(changes).map(([f, c]) => [f, toDbValue(fields[f], c.to)]))
  if (table === 'pipeline') await db.pipelineTrackerItem.update({ where: { id }, data })
  else if (table === 'invoiceRegister') await db.invoiceRegisterItem.update({ where: { id }, data })
  else {
    await db.invoiceSectorSummary.update({ where: { id }, data })
    // Only an amount changes the totals — renaming a sector or editing its
    // remarks leaves the sheet's figures exactly as they were.
    if (Object.keys(changes).some(f => (MONTHS as readonly string[]).includes(f) || f === 'fyTarget')) await recomputeSectorTotals(db, id)
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100
type MonthValues = Record<Month, number | null>

function totalsFor(m: MonthValues, fyTarget: number | null) {
  const [q1Total, q2Total, q3Total, q4Total] = QUARTERS.map(keys => round2(keys.reduce((s, k) => s + (m[k] ?? 0), 0)))
  const fyTotal = round2(q1Total + q2Total + q3Total + q4Total)
  // Stored as a fraction, like the sheet (0.42 = 42%).
  const achievementPct = fyTarget ? Math.round((fyTotal / fyTarget) * 10000) / 10000 : null
  return { q1Total, q2Total, q3Total, q4Total, fyTotal, achievementPct }
}

async function recomputeSectorTotals(db: Db, id: string): Promise<void> {
  const row = await db.invoiceSectorSummary.findUniqueOrThrow({ where: { id } })
  await db.invoiceSectorSummary.update({ where: { id }, data: totalsFor(row, row.fyTarget) })

  const all = await db.invoiceSectorSummary.findMany()
  const total = all.find(r => isTotalSector(r.sector))
  if (!total) return
  const sectors = all.filter(r => !isTotalSector(r.sector))
  const sum = (k: Month | 'fyTarget') => round2(sectors.reduce((s, r) => s + (r[k] ?? 0), 0))
  const months = Object.fromEntries(MONTHS.map(m => [m, sum(m)])) as MonthValues
  const fyTarget = sum('fyTarget')
  await db.invoiceSectorSummary.update({ where: { id: total.id }, data: { ...months, fyTarget, ...totalsFor(months, fyTarget) } })
}

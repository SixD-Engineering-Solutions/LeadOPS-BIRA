// Reads the business tracker workbook (.xlsx) into the three Tracker tables'
// rows: the Pipeline Tracker tab, and the Invoice & Billing Tracker tab's
// sector summary (Section 1) and invoice register (Section 2).
//
// Tabs are found by name and columns by their heading text, not by fixed
// positions — the live SharePoint workbook has more tabs than the original
// import file, and a column or tab added to it must not shift every value
// into the wrong field. Anything it can't find is an error naming what's
// missing, and nothing is written.
//
// .xlsx is a zip of XML parts and only a few of them are needed, so it's read
// by hand with Node's built-in zlib instead of the `xlsx` npm package (whose
// only npm release carries unpatched prototype-pollution/ReDoS CVEs).
import zlib from 'zlib'
import { Prisma } from '../generated/prisma/client'

// ─── minimal ZIP reader ─────────────────────────────────────────────────────
// Walks the Central Directory and inflates each entry (STORED or DEFLATE).
// Enough for the single-disk, non-zip64 archives Excel produces.
export function readZipEntries(buf: Buffer): Record<string, Buffer> {
  const EOCD_SIG = 0x06054b50
  let eocdOffset = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocdOffset = i; break }
  }
  if (eocdOffset === -1) throw new SheetError('The file is not an Excel workbook (.xlsx).')
  const entryCount = buf.readUInt16LE(eocdOffset + 10)
  const cdOffset = buf.readUInt32LE(eocdOffset + 16)

  const entries: Record<string, Buffer> = {}
  const CEN_SIG = 0x02014b50
  let offset = cdOffset
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(offset) !== CEN_SIG) throw new SheetError('The workbook file is damaged (bad zip directory).')
    const method = buf.readUInt16LE(offset + 10)
    const compSize = buf.readUInt32LE(offset + 20)
    const nameLen = buf.readUInt16LE(offset + 28)
    const extraLen = buf.readUInt16LE(offset + 30)
    const commentLen = buf.readUInt16LE(offset + 32)
    const localHeaderOffset = buf.readUInt32LE(offset + 42)
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen)

    const lNameLen = buf.readUInt16LE(localHeaderOffset + 26)
    const lExtraLen = buf.readUInt16LE(localHeaderOffset + 28)
    const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen
    const raw = buf.subarray(dataStart, dataStart + compSize)
    entries[name] = method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw)
    offset += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** A problem with the workbook itself (wrong file, missing tab or column). */
export class SheetError extends Error {}

// ─── XML → rows ─────────────────────────────────────────────────────────────

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
}

function parseSharedStrings(xml: string): string[] {
  const siBlocks = xml.match(/<si>[\s\S]*?<\/si>/g) ?? []
  return siBlocks.map(block => {
    // Phonetic hints (<rPh>) aren't part of the cell's text.
    const text = block.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
    return decodeXmlEntities([...text.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(''))
  })
}

export type SheetRow = Record<string, string>
export type Sheet = Map<number, SheetRow>

// Row number (1-indexed, as Excel shows it) → column letter → cell text.
function parseSheet(xml: string, sharedStrings: string[]): Sheet {
  const rows: Sheet = new Map()
  const rowBlocks = xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)
  for (const rowMatch of rowBlocks) {
    const rowNum = Number(rowMatch[1])
    const row: SheetRow = {}
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
    let cellMatch: RegExpExecArray | null
    while ((cellMatch = cellRe.exec(rowMatch[2]))) {
      const attrs = cellMatch[1]
      const content = cellMatch[2] ?? ''
      const ref = attrs.match(/r="([A-Z]+)\d+"/)
      if (!ref) continue
      const col = ref[1]
      const type = attrs.match(/t="([a-zA-Z]+)"/)?.[1]
      const inlineStr = content.match(/<is>([\s\S]*?)<\/is>/)
      const value = content.match(/<v>([\s\S]*?)<\/v>/)
      if (inlineStr) {
        row[col] = decodeXmlEntities([...inlineStr[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(''))
      } else if (value) {
        row[col] = type === 's' ? (sharedStrings[Number(value[1])] ?? '') : decodeXmlEntities(value[1])
      }
    }
    rows.set(rowNum, row)
  }
  return rows
}

// Tab name → its worksheet XML, via workbook.xml and its relationships.
function workbookTabs(entries: Record<string, Buffer>, sharedStrings: string[]): Map<string, Sheet> {
  const workbook = entries['xl/workbook.xml']?.toString('utf8')
  const rels = entries['xl/_rels/workbook.xml.rels']?.toString('utf8')
  if (!workbook || !rels) throw new SheetError('The file is not an Excel workbook (.xlsx).')
  const targets = new Map<string, string>()
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = m[1].match(/\bId="([^"]+)"/)?.[1]
    const target = m[1].match(/\bTarget="([^"]+)"/)?.[1]
    if (id && target) targets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`)
  }
  const tabs = new Map<string, Sheet>()
  for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = m[1].match(/\bname="([^"]*)"/)?.[1]
    const rid = m[1].match(/\br:id="([^"]+)"/)?.[1] ?? m[1].match(/\bid="([^"]+)"/)?.[1]
    const xml = rid ? entries[targets.get(rid) ?? ''] : undefined
    if (name != null && xml) tabs.set(decodeXmlEntities(name), parseSheet(xml.toString('utf8'), sharedStrings))
  }
  return tabs
}

// ─── finding tabs, header rows and columns by their text ────────────────────

// "Value (₹L)" → "value l", "Follow-up Date" → "follow up date": lower case,
// anything that isn't a letter or digit becomes one space.
const norm = (s: string | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// The tab whose name matches best: an exact name first, then one containing
// every given word.
function findTab(tabs: Map<string, Sheet>, exact: string, words: string[]): Sheet | null {
  for (const [name, sheet] of tabs) if (norm(name) === norm(exact)) return sheet
  for (const [name, sheet] of tabs) if (words.every(w => norm(name).includes(w))) return sheet
  return null
}

// A heading → field rule: the heading (normalised) equals one of `is`, or
// starts with one of `starts`.
type Rule = { is?: string[]; starts?: string[] }
const matches = (heading: string, r: Rule) =>
  !!heading && ((r.is ?? []).includes(heading) || (r.starts ?? []).some(s => heading === s || heading.startsWith(`${s} `)))

// Column letter for each field, from the header row.
type Columns<K extends string> = Record<K, string | undefined>
function mapColumns<K extends string>(header: SheetRow, rules: Record<K, Rule>): Columns<K> {
  const cols = {} as Columns<K>
  const taken = new Set<string>()
  for (const key of Object.keys(rules) as K[]) {
    // Left-most matching column wins; a column is used for one field only.
    const col = sortCols(Object.keys(header)).find(c => !taken.has(c) && matches(norm(header[c]), rules[key]))
    cols[key] = col
    if (col) taken.add(col)
  }
  return cols
}
const colIndex = (c: string) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)
const sortCols = (cols: string[]) => cols.sort((a, b) => colIndex(a) - colIndex(b))

// The first row (from `from`, within the first 60) whose headings satisfy
// every one of the given rules.
function findHeaderRow(sheet: Sheet, required: Rule[], from = 1): number | null {
  for (const r of [...sheet.keys()].filter(n => n >= from && n <= from + 60).sort((a, b) => a - b)) {
    const headings = Object.values(sheet.get(r)!).map(norm)
    if (required.every(rule => headings.some(h => matches(h, rule)))) return r
  }
  return null
}

function requireColumns<K extends string>(cols: Columns<K>, required: K[], where: string, labels: Record<string, string>) {
  const missing = required.filter(k => !cols[k])
  if (missing.length) throw new SheetError(`${where}: couldn't find the column(s) ${missing.map(k => `“${labels[k] ?? k}”`).join(', ')}.`)
}

// ─── value coercion ─────────────────────────────────────────────────────────

const cell = (row: SheetRow, col: string | undefined) => (col ? row[col] : undefined)
const str = (row: SheetRow, col: string | undefined): string | null => {
  const v = cell(row, col)?.trim()
  return v ? v : null
}
const num = (row: SheetRow, col: string | undefined): number | null => {
  const v = cell(row, col)?.replace(/,/g, '').trim()
  if (!v) return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}
// Money columns come out of Excel formulas with floating-point noise — round
// to 2dp (values are in ₹ lakhs).
const money = (row: SheetRow, col: string | undefined): number | null => {
  const n = num(row, col)
  return n == null ? null : Math.round(n * 100) / 100
}
const int = (row: SheetRow, col: string | undefined): number | null => {
  const n = num(row, col)
  return n == null ? null : Math.round(n)
}
// "Value (₹L)" sometimes holds free text ("3 Lakhs") — take its leading number.
const looseNum = (row: SheetRow, col: string | undefined): number | null => {
  const m = cell(row, col)?.replace(/,/g, '').match(/-?\d+(\.\d+)?/)
  return m ? Number(m[0]) : null
}
// Probability is a fraction (0.8), a percentage (80) or "100%%" — all → 0–100.
const percent = (row: SheetRow, col: string | undefined): number | null => {
  const raw = cell(row, col)?.replace(/%/g, '').trim()
  if (!raw) return null
  const n = Number(raw)
  if (Number.isNaN(n)) return null
  return Math.round(n <= 1 ? n * 100 : n)
}
// Excel date serial → Date. Text in a "date" column ("Done", "30 Days") → null.
const excelDate = (row: SheetRow, col: string | undefined): Date | null => {
  const n = num(row, col)
  if (n == null || n < 1 || n > 100000) return null
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000))
}
// Free text kept as-is; an actual Excel date shown as "Apr 2026".
const expectedCloseText = (row: SheetRow, col: string | undefined): string | null => {
  const raw = str(row, col)
  if (!raw || Number.isNaN(Number(raw))) return raw
  const d = excelDate(row, col)
  return d ? d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : raw
}
// Free text kept as-is; an actual Excel date as YYYY-MM-DD.
const dateText = (row: SheetRow, col: string | undefined): string | null => {
  const raw = str(row, col)
  if (!raw || Number.isNaN(Number(raw))) return raw
  return excelDate(row, col)?.toISOString().slice(0, 10) ?? raw
}

const rowsFrom = (sheet: Sheet, first: number, last = Infinity) =>
  [...sheet.keys()].filter(r => r >= first && r <= last).sort((a, b) => a - b)

// ─── the three sections ─────────────────────────────────────────────────────

const PIPELINE_RULES = {
  vertical: { starts: ['vertical', 'sector'] },
  client: { starts: ['client', 'customer'] },
  location: { starts: ['location', 'site', 'city'] },
  service: { starts: ['service'] },
  description: { starts: ['description', 'scope'] },
  valueLakhs: { starts: ['value', 'est value', 'estimated value', 'deal value'] },
  currency: { starts: ['currency'] },
  status: { starts: ['status', 'stage'] },
  probabilityPct: { starts: ['probability', 'prob'] },
  expectedClose: { starts: ['expected close', 'exp close', 'expected closure', 'close date'] },
  owner: { starts: ['owner'] },
  bmContact: { starts: ['bm', 'bm contact', 'contact'] },
  followUpDate: { starts: ['follow up', 'followup', 'next follow up'] },
  lastAction: { starts: ['last action'] },
  flagAction: { starts: ['flag'] },
  priority: { starts: ['priority'] },
  notes: { starts: ['notes', 'note', 'remarks', 'comments'] },
} satisfies Record<string, Rule>

const MONTH_KEYS = ['apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'jan', 'feb', 'mar'] as const
const MONTH_NAMES: Record<string, string> = { apr: 'april', may: 'may', jun: 'june', jul: 'july', aug: 'august', sep: 'september', oct: 'october', nov: 'november', dec: 'december', jan: 'january', feb: 'february', mar: 'march' }
const SUMMARY_RULES = {
  sector: { starts: ['sector', 'vertical'] },
  bmOwner: { starts: ['bm', 'bm owner', 'owner'] },
  ...Object.fromEntries(MONTH_KEYS.map(m => [m, { starts: [m, MONTH_NAMES[m], m === 'sep' ? 'sept' : m] }])) as Record<(typeof MONTH_KEYS)[number], Rule>,
  q1Total: { starts: ['q1'] },
  q2Total: { starts: ['q2'] },
  q3Total: { starts: ['q3'] },
  q4Total: { starts: ['q4'] },
  fyTotal: { starts: ['fy total', 'total fy', 'fy actual'] },
  fyTarget: { starts: ['fy target', 'target'] },
  achievementPct: { starts: ['achievement', 'achieved', 'ach'] },
  remarks: { starts: ['remarks', 'notes', 'comments', 'special'] },
} satisfies Record<string, Rule>

const REGISTER_RULES = {
  sector: { starts: ['sector', 'vertical'] },
  client: { starts: ['client', 'customer'] },
  location: { starts: ['location', 'site', 'city'] },
  poNumber: { starts: ['po', 'po number', 'po no', 'work order', 'wo'] },
  orderValueLakhs: { starts: ['order value', 'po value', 'value'] },
  serviceType: { starts: ['service'] },
  bmOwner: { starts: ['bm', 'bm owner', 'owner'] },
  workCompletionDate: { starts: ['work completion', 'completion'] },
  invoiceRaised: { starts: ['invoice raised', 'raised'] },
  invoiceNumber: { starts: ['invoice number', 'invoice no', 'inv no', 'invoice'] },
  invoiceDate: { starts: ['invoice date', 'inv date'] },
  invoiceAmountLakhs: { starts: ['invoice amount', 'inv amount', 'invoice value'] },
  tdsDeduction: { starts: ['tds'] },
  invoiceMonth: { starts: ['invoice month', 'month'] },
  dueDate: { starts: ['due date', 'due'] },
  paymentReceived: { starts: ['payment received', 'received'] },
  currentManager: { starts: ['current manager', 'manager'] },
  paymentDate: { starts: ['payment date'] },
  amountCollectedLakhs: { starts: ['amount collected', 'collected', 'amount received'] },
  balanceOutstandingLakhs: { starts: ['balance', 'outstanding'] },
  daysToCollect: { starts: ['days to collect', 'days'] },
  dsoStatus: { starts: ['dso'] },
  remarks: { starts: ['remarks', 'notes', 'comments'] },
  nextActionDate: { starts: ['next action'] },
} satisfies Record<string, Rule>

const LABELS: Record<string, string> = {
  client: 'Client', status: 'Status', vertical: 'Vertical', sector: 'Sector', apr: 'Apr', mar: 'Mar',
  invoiceNumber: 'Invoice No', invoiceAmountLakhs: 'Invoice Amount', invoiceDate: 'Invoice Date', fyTarget: 'FY Target',
}

// Rule order matters where headings share a prefix: more specific fields are
// listed first in the objects above only when that's needed — mapColumns
// takes each rule in order and skips columns already used, so e.g. "Invoice
// Date" must not be claimed by `invoiceNumber`'s plain "invoice". Hence the
// explicit orderings below.
const REGISTER_ORDER: (keyof typeof REGISTER_RULES)[] = [
  'invoiceDate', 'invoiceAmountLakhs', 'invoiceMonth', 'invoiceRaised', 'invoiceNumber',
  'paymentDate', 'paymentReceived', 'amountCollectedLakhs', 'balanceOutstandingLakhs', 'daysToCollect', 'dsoStatus',
  'nextActionDate', 'workCompletionDate', 'dueDate', 'currentManager', 'orderValueLakhs', 'poNumber',
  'serviceType', 'bmOwner', 'sector', 'client', 'location', 'tdsDeduction', 'remarks',
]
const PIPELINE_ORDER: (keyof typeof PIPELINE_RULES)[] = [
  'expectedClose', 'followUpDate', 'lastAction', 'flagAction', 'bmContact', 'owner', 'probabilityPct',
  'vertical', 'client', 'location', 'service', 'description', 'valueLakhs', 'currency', 'status', 'priority', 'notes',
]
const SUMMARY_ORDER: (keyof typeof SUMMARY_RULES)[] = [
  'fyTotal', 'fyTarget', 'achievementPct', 'q1Total', 'q2Total', 'q3Total', 'q4Total', ...MONTH_KEYS, 'sector', 'bmOwner', 'remarks',
]
const ordered = <K extends string>(rules: Record<K, Rule>, order: K[]) => Object.fromEntries(order.map(k => [k, rules[k]])) as Record<K, Rule>

export type TrackerSheetData = {
  pipeline: Prisma.PipelineTrackerItemCreateManyInput[]
  summary: Prisma.InvoiceSectorSummaryCreateManyInput[]
  register: Prisma.InvoiceRegisterItemCreateManyInput[]
}

const blank = (row: SheetRow) => Object.values(row).every(v => !v?.trim())

/** Reads the workbook's Pipeline and Invoice tabs. Throws SheetError if the layout can't be recognised. */
export function parseTrackerWorkbook(buf: Buffer): TrackerSheetData {
  const entries = readZipEntries(buf)
  const sharedStrings = entries['xl/sharedStrings.xml'] ? parseSharedStrings(entries['xl/sharedStrings.xml'].toString('utf8')) : []
  const tabs = workbookTabs(entries, sharedStrings)
  const tabList = [...tabs.keys()].map(n => `“${n}”`).join(', ')

  // ── Pipeline Tracker ──
  const pipeSheet = findTab(tabs, 'Pipeline Tracker', ['pipeline'])
  if (!pipeSheet) throw new SheetError(`No “Pipeline Tracker” tab in the workbook (it has ${tabList}).`)
  const pipeHeader = findHeaderRow(pipeSheet, [PIPELINE_RULES.client, PIPELINE_RULES.status])
  if (!pipeHeader) throw new SheetError('Pipeline Tracker: couldn’t find the heading row (with “Client” and “Status”).')
  const pc = mapColumns(pipeSheet.get(pipeHeader)!, ordered(PIPELINE_RULES, PIPELINE_ORDER))
  // The live sheet's first column (the vertical) has no proper heading — it's
  // the column just left of Client when nothing else claimed it.
  if (!pc.vertical && pc.client && colIndex(pc.client) > 1) {
    const left = String.fromCharCode(64 + colIndex(pc.client) - 1)
    if (colIndex(pc.client) <= 26 && !Object.values(pc).includes(left)) pc.vertical = left
  }
  requireColumns(pc, ['client', 'status', 'valueLakhs'], 'Pipeline Tracker', { ...LABELS, valueLakhs: 'Value' })

  const pipeline: TrackerSheetData['pipeline'] = []
  for (const r of rowsFrom(pipeSheet, pipeHeader + 1)) {
    const row = pipeSheet.get(r)!
    if (!str(row, pc.vertical) && !str(row, pc.client) && !str(row, pc.service)) continue // spacer / totals row
    pipeline.push({
      sortOrder: r,
      vertical: str(row, pc.vertical),
      client: str(row, pc.client),
      location: str(row, pc.location),
      service: str(row, pc.service),
      description: str(row, pc.description),
      valueLakhs: looseNum(row, pc.valueLakhs),
      currency: str(row, pc.currency),
      status: str(row, pc.status),
      probabilityPct: percent(row, pc.probabilityPct),
      expectedClose: expectedCloseText(row, pc.expectedClose),
      owner: str(row, pc.owner),
      bmContact: str(row, pc.bmContact),
      followUpDate: dateText(row, pc.followUpDate),
      lastAction: str(row, pc.lastAction),
      flagAction: str(row, pc.flagAction),
      priority: str(row, pc.priority),
      notes: str(row, pc.notes),
    })
  }

  // ── Invoice & Billing Tracker ──
  const invSheet = findTab(tabs, 'Invoice & Billing Tracker', ['invoice'])
  if (!invSheet) throw new SheetError(`No “Invoice & Billing Tracker” tab in the workbook (it has ${tabList}).`)

  // Section 1: the monthly-by-sector summary — heading row with Sector, Apr … Mar.
  const sumHeader = findHeaderRow(invSheet, [SUMMARY_RULES.sector, SUMMARY_RULES.apr, SUMMARY_RULES.mar])
  if (!sumHeader) throw new SheetError('Invoice & Billing Tracker: couldn’t find the sector summary’s heading row (with “Sector”, “Apr” … “Mar”).')
  const sc = mapColumns(invSheet.get(sumHeader)!, ordered(SUMMARY_RULES, SUMMARY_ORDER))
  requireColumns(sc, ['sector', ...MONTH_KEYS, 'fyTarget'], 'Invoice & Billing Tracker (summary)', LABELS)

  // Section 2: the invoice register — a later heading row with Invoice No and Invoice Amount.
  const regHeader = findHeaderRow(invSheet, [{ starts: ['invoice number', 'invoice no', 'inv no'] }, REGISTER_RULES.invoiceAmountLakhs], sumHeader + 1)
  if (!regHeader) throw new SheetError('Invoice & Billing Tracker: couldn’t find the invoice register’s heading row (with “Invoice No” and “Invoice Amount”).')
  const rc = mapColumns(invSheet.get(regHeader)!, ordered(REGISTER_RULES, REGISTER_ORDER))
  requireColumns(rc, ['client', 'invoiceNumber', 'invoiceAmountLakhs', 'invoiceDate'], 'Invoice & Billing Tracker (register)', LABELS)

  const summary: TrackerSheetData['summary'] = []
  for (const r of rowsFrom(invSheet, sumHeader + 1, regHeader - 1)) {
    const row = invSheet.get(r)!
    const sector = str(row, sc.sector)
    if (!sector) { if (summary.length) break; continue } // the section ends at its first blank row
    if (/^section\b/i.test(sector)) break
    summary.push({
      sortOrder: r,
      sector,
      bmOwner: str(row, sc.bmOwner),
      apr: money(row, sc.apr), may: money(row, sc.may), jun: money(row, sc.jun), q1Total: money(row, sc.q1Total),
      jul: money(row, sc.jul), aug: money(row, sc.aug), sep: money(row, sc.sep), q2Total: money(row, sc.q2Total),
      oct: money(row, sc.oct), nov: money(row, sc.nov), dec: money(row, sc.dec), q3Total: money(row, sc.q3Total),
      jan: money(row, sc.jan), feb: money(row, sc.feb), mar: money(row, sc.mar), q4Total: money(row, sc.q4Total),
      fyTotal: money(row, sc.fyTotal), fyTarget: money(row, sc.fyTarget), achievementPct: num(row, sc.achievementPct),
      remarks: str(row, sc.remarks),
    })
  }

  const register: TrackerSheetData['register'] = []
  for (const r of rowsFrom(invSheet, regHeader + 1)) {
    const row = invSheet.get(r)!
    if (blank(row)) continue
    if (!str(row, rc.sector) && !str(row, rc.client) && !str(row, rc.poNumber) && !str(row, rc.invoiceNumber)) continue // spacer / totals row
    register.push({
      sortOrder: r,
      sector: str(row, rc.sector),
      client: str(row, rc.client),
      location: str(row, rc.location),
      poNumber: str(row, rc.poNumber),
      orderValueLakhs: money(row, rc.orderValueLakhs),
      serviceType: str(row, rc.serviceType),
      bmOwner: str(row, rc.bmOwner),
      workCompletionDate: dateText(row, rc.workCompletionDate),
      invoiceRaised: str(row, rc.invoiceRaised),
      invoiceNumber: str(row, rc.invoiceNumber),
      invoiceDate: excelDate(row, rc.invoiceDate),
      invoiceAmountLakhs: money(row, rc.invoiceAmountLakhs),
      tdsDeduction: money(row, rc.tdsDeduction),
      invoiceMonth: str(row, rc.invoiceMonth),
      dueDate: dateText(row, rc.dueDate),
      paymentReceived: str(row, rc.paymentReceived),
      currentManager: str(row, rc.currentManager),
      paymentDate: excelDate(row, rc.paymentDate),
      amountCollectedLakhs: money(row, rc.amountCollectedLakhs),
      balanceOutstandingLakhs: money(row, rc.balanceOutstandingLakhs),
      daysToCollect: int(row, rc.daysToCollect),
      dsoStatus: str(row, rc.dsoStatus),
      remarks: str(row, rc.remarks),
      nextActionDate: dateText(row, rc.nextActionDate),
    })
  }

  if (!pipeline.length) throw new SheetError('Pipeline Tracker: no rows found under the heading row.')
  if (!summary.length) throw new SheetError('Invoice & Billing Tracker: the sector summary has no rows.')
  return { pipeline, summary, register }
}

/** For checking a workbook by hand: each tab's name and the headings found. */
export function describeWorkbook(buf: Buffer) {
  const entries = readZipEntries(buf)
  const sharedStrings = entries['xl/sharedStrings.xml'] ? parseSharedStrings(entries['xl/sharedStrings.xml'].toString('utf8')) : []
  return [...workbookTabs(entries, sharedStrings).entries()].map(([name, sheet]) => ({ name, rows: sheet.size, first: sheet }))
}

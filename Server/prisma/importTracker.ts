// One-time import of the FY2026–27 "LeadOps sheet.xlsx" (Server/prisma/data — kept out of the public web folder) into
// the tracker tables (see schema.prisma). Safe to re-run: it clears and
// re-inserts all three tables each time, so it stays in sync if the sheet is
// replaced later.
//
// .xlsx is just a zip of XML parts, and we only need to read three of them
// (sharedStrings.xml + the two sheetN.xml), so this parses the file by hand
// with Node's built-in `zlib` instead of adding the `xlsx` npm package —
// that package's only version on npm (0.18.5) carries unpatched
// prototype-pollution/ReDoS CVEs that aren't worth taking on for a script
// that runs once against a file we already trust.
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { prisma } from '../src/prisma'
import { Prisma } from '../src/generated/prisma/client'

const SHEET_PATH = path.join(__dirname, 'data', 'LeadOps sheet.xlsx')

// ─── minimal ZIP reader ─────────────────────────────────────────────────────
// Reads the End Of Central Directory, walks the Central Directory, and
// inflates each entry (STORED or DEFLATE). Good enough for the small,
// single-disk, non-zip64 archives Excel produces.
function readZipEntries(buf: Buffer): Record<string, Buffer> {
  const EOCD_SIG = 0x06054b50
  let eocdOffset = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocdOffset = i; break }
  }
  if (eocdOffset === -1) throw new Error('Not a valid zip (EOCD not found).')
  const entryCount = buf.readUInt16LE(eocdOffset + 10)
  const cdOffset = buf.readUInt32LE(eocdOffset + 16)

  const entries: Record<string, Buffer> = {}
  const CEN_SIG = 0x02014b50
  let offset = cdOffset
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(offset) !== CEN_SIG) throw new Error('Malformed zip central directory.')
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

// ─── XML → rows ─────────────────────────────────────────────────────────────

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

function parseSharedStrings(xml: string): string[] {
  const siBlocks = xml.match(/<si>[\s\S]*?<\/si>/g) ?? []
  return siBlocks.map(block => {
    const parts = [...block.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1])
    return decodeXmlEntities(parts.join(''))
  })
}

type SheetRow = Record<string, string>

// Row number (1-indexed, as Excel shows it) → column letter → cell text.
function parseSheet(xml: string, sharedStrings: string[]): Map<number, SheetRow> {
  const rows = new Map<number, SheetRow>()
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
      const type = attrs.match(/t="([a-z]+)"/)?.[1]
      const inlineStr = content.match(/<is>([\s\S]*?)<\/is>/)
      const value = content.match(/<v>([\s\S]*?)<\/v>/)
      if (inlineStr) {
        row[col] = decodeXmlEntities([...inlineStr[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(''))
      } else if (value) {
        row[col] = type === 's' ? (sharedStrings[Number(value[1])] ?? '') : value[1]
      }
    }
    rows.set(rowNum, row)
  }
  return rows
}

// ─── value coercion helpers ─────────────────────────────────────────────────

const str = (row: SheetRow, col: string): string | null => {
  const v = row[col]?.trim()
  return v ? v : null
}
const num = (row: SheetRow, col: string): number | null => {
  const v = row[col]
  if (v == null || v.trim() === '') return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}
// Money columns come out of Excel formulas with floating-point noise
// (e.g. 2.9959999999996101E-3) — round to paise/cents-equivalent (2dp, since
// values are in ₹ lakhs here).
const money = (row: SheetRow, col: string): number | null => {
  const n = num(row, col)
  return n == null ? null : Math.round(n * 100) / 100
}
const int = (row: SheetRow, col: string): number | null => {
  const n = num(row, col)
  return n == null ? null : Math.round(n)
}
// "Value (₹L)" and similar sometimes hold free text ("3 Lakhs", "Multi
// lakhs ") instead of a clean number — pull the leading number out if any.
const looseNum = (row: SheetRow, col: string): number | null => {
  const v = row[col]
  if (!v) return null
  const m = v.match(/-?\d+(\.\d+)?/)
  return m ? Number(m[0]) : null
}
// Probability was entered inconsistently across rows — sometimes a fraction
// (0.8), sometimes a whole percentage (80), sometimes with a stray "%" typo
// ("100%%"). Normalize all of it to a 0–100 integer.
const percent = (row: SheetRow, col: string): number | null => {
  const raw = row[col]?.replace(/%/g, '').trim()
  if (!raw) return null
  const n = Number(raw)
  if (Number.isNaN(n)) return null
  return Math.round(n <= 1 ? n * 100 : n)
}
// Excel date serial (days since 1899-12-30, accounting for its leap-year
// bug) → JS Date. Non-numeric cells (many "date" columns here actually hold
// text like "Done"/"Immediate"/"30 Days") are left as null.
const excelDate = (row: SheetRow, col: string): Date | null => {
  const n = num(row, col)
  if (n == null) return null
  return new Date(Date.UTC(1899, 11, 30) + n * 86400000)
}
// "Expected Close" is entered as free text in most rows ("Apr 2026", "Q3
// 2026", "Jun/July", …) but as an actual Excel date in others — those come
// through as a bare serial number ("46113") that needs converting back to
// something readable, rather than leaking through as-is.
const expectedCloseText = (row: SheetRow, col: string): string | null => {
  const raw = str(row, col)
  if (!raw || Number.isNaN(Number(raw))) return raw
  const d = excelDate(row, col)
  return d ? d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : raw
}

async function main() {
  if (!fs.existsSync(SHEET_PATH)) {
    throw new Error(`Sheet not found at ${SHEET_PATH}`)
  }
  const entries = readZipEntries(fs.readFileSync(SHEET_PATH))
  const sharedStrings = parseSharedStrings(entries['xl/sharedStrings.xml'].toString('utf8'))
  const sheet1 = parseSheet(entries['xl/worksheets/sheet1.xml'].toString('utf8'), sharedStrings)
  const sheet2 = parseSheet(entries['xl/worksheets/sheet2.xml'].toString('utf8'), sharedStrings)

  // ── Sheet1: Pipeline Tracker — header on row 2, data rows 3.. until blank ──
  const pipelineItems: Prisma.PipelineTrackerItemCreateManyInput[] = []
  for (let r = 3; sheet1.has(r); r++) {
    const row = sheet1.get(r)!
    if (!str(row, 'A') && !str(row, 'B') && !str(row, 'D')) continue // blank spacer row
    pipelineItems.push({
      sortOrder: r,
      vertical: str(row, 'A'),
      client: str(row, 'B'),
      location: str(row, 'C'),
      service: str(row, 'D'),
      description: str(row, 'E'),
      valueLakhs: looseNum(row, 'F'),
      currency: str(row, 'H'),
      status: str(row, 'I'),
      probabilityPct: percent(row, 'J'),
      expectedClose: expectedCloseText(row, 'K'),
      owner: str(row, 'L'),
      bmContact: str(row, 'M'),
      followUpDate: str(row, 'N'),
      lastAction: str(row, 'O'),
      flagAction: str(row, 'P'),
      priority: str(row, 'Q'),
      notes: str(row, 'R'),
    })
  }

  // ── Sheet2 Section 1: monthly-by-sector summary — header row 7, data 8..15 ──
  const summaryItems: Prisma.InvoiceSectorSummaryCreateManyInput[] = []
  for (let r = 8; sheet2.has(r); r++) {
    const row = sheet2.get(r)!
    if (!str(row, 'A')) break // ends right before "SECTION 2 —" header row
    summaryItems.push({
      sortOrder: r,
      sector: str(row, 'A'),
      bmOwner: str(row, 'B'),
      apr: money(row, 'C'), may: money(row, 'D'), jun: money(row, 'E'), q1Total: money(row, 'F'),
      jul: money(row, 'G'), aug: money(row, 'H'), sep: money(row, 'I'), q2Total: money(row, 'J'),
      oct: money(row, 'K'), nov: money(row, 'L'), dec: money(row, 'M'), q3Total: money(row, 'N'),
      jan: money(row, 'O'), feb: money(row, 'P'), mar: money(row, 'Q'), q4Total: money(row, 'R'),
      fyTotal: money(row, 'S'), fyTarget: money(row, 'T'), achievementPct: num(row, 'U'),
      remarks: str(row, 'V'),
    })
  }

  // ── Sheet2 Section 2: detailed invoice register — header row 19, data 20.. ──
  const registerItems: Prisma.InvoiceRegisterItemCreateManyInput[] = []
  for (let r = 20; sheet2.has(r); r++) {
    const row = sheet2.get(r)!
    if (!str(row, 'A') && !str(row, 'B') && !str(row, 'D')) continue // blank spacer row
    registerItems.push({
      sortOrder: r,
      sector: str(row, 'A'),
      client: str(row, 'B'),
      location: str(row, 'C'),
      poNumber: str(row, 'D'),
      orderValueLakhs: money(row, 'E'),
      serviceType: str(row, 'F'),
      bmOwner: str(row, 'G'),
      workCompletionDate: str(row, 'H'),
      invoiceRaised: str(row, 'I'),
      invoiceNumber: str(row, 'J'),
      invoiceDate: excelDate(row, 'K'),
      invoiceAmountLakhs: money(row, 'L'),
      tdsDeduction: money(row, 'M'),
      invoiceMonth: str(row, 'N'),
      dueDate: str(row, 'O'),
      paymentReceived: str(row, 'P'),
      currentManager: str(row, 'Q'),
      paymentDate: excelDate(row, 'R'),
      amountCollectedLakhs: money(row, 'S'),
      balanceOutstandingLakhs: money(row, 'T'),
      daysToCollect: int(row, 'U'),
      dsoStatus: str(row, 'V'),
      remarks: str(row, 'W'),
      nextActionDate: str(row, 'X'),
    })
  }

  await prisma.$transaction([
    prisma.pipelineTrackerItem.deleteMany(),
    prisma.invoiceRegisterItem.deleteMany(),
    prisma.invoiceSectorSummary.deleteMany(),
    prisma.pipelineTrackerItem.createMany({ data: pipelineItems }),
    prisma.invoiceRegisterItem.createMany({ data: registerItems }),
    prisma.invoiceSectorSummary.createMany({ data: summaryItems }),
  ])

  console.log(`Imported ${pipelineItems.length} pipeline rows, ${registerItems.length} invoice register rows, ${summaryItems.length} sector summary rows.`)
}

main()
  .catch(e => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())

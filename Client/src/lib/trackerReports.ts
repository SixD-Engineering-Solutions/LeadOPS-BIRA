import type { InvoiceRegisterItem, InvoiceSectorSummary, LeadStatus } from './api'
import { pipelineStageOf, outcomeOf, STAGE_GROUP } from './pipelineStatus'
import type { Outcome, StatusGroup } from './pipelineStatus'

export { STATUS_GROUPS } from './pipelineStatus'
export type { StatusGroup } from './pipelineStatus'

// Shared by the Tracker's Reports overview and its period Comparisons view,
// so both classify and total the same rows the same way.

// ─── financial year ─────────────────────────────────────────────────────────

// Indian financial year: April → March. The sector summary's month columns
// (apr … mar) are keyed the same way.
export type FyMonthKey = 'apr' | 'may' | 'jun' | 'jul' | 'aug' | 'sep' | 'oct' | 'nov' | 'dec' | 'jan' | 'feb' | 'mar'
const FY_FIRST_MONTH = 3 // April, as a JS month index
const MONTH_KEYS: FyMonthKey[] = ['apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'jan', 'feb', 'mar']
const monthName = (key: FyMonthKey) => key[0].toUpperCase() + key.slice(1)

export const FY_MONTHS: { key: FyMonthKey; label: string }[] = MONTH_KEYS.map(key => ({ key, label: monthName(key) }))

// Quarters are each run of three months, so their labels follow the months.
export const FY_QUARTERS: { key: string; label: string; months: FyMonthKey[] }[] = [0, 1, 2, 3].map(q => {
  const months = MONTH_KEYS.slice(q * 3, q * 3 + 3)
  return { key: `q${q + 1}`, label: `Q${q + 1} · ${monthName(months[0])}–${monthName(months[2])}`, months }
})

// The calendar year a financial year starts in, for a date.
export const fyStartOf = (d: Date) => (d.getMonth() >= FY_FIRST_MONTH ? d.getFullYear() : d.getFullYear() - 1)

// "FY2026–27"
export const fyLabel = (start: number) => `FY${start}–${String((start + 1) % 100).padStart(2, '0')}`

// Which financial year the tracker's data is for: the one most of its
// invoices are dated in (the sector summary has months but no year, and is
// for that same year). With no dated invoices yet, the current one.
export function trackerFyStart(register: InvoiceRegisterItem[], today = new Date()): number {
  const counts = new Map<number, number>()
  for (const r of register) {
    if (!r.invoiceDate) continue
    const y = fyStartOf(new Date(r.invoiceDate))
    counts.set(y, (counts.get(y) ?? 0) + 1)
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]
  return best ? best[0] : fyStartOf(today)
}

// The month of financial year `fyStart` a date falls in, or null if it's in
// another year.
export function fyMonthOf(iso: string, fyStart: number): FyMonthKey | null {
  const d = new Date(iso)
  return fyStartOf(d) === fyStart ? MONTH_KEYS[(d.getMonth() - FY_FIRST_MONTH + 12) % 12] : null
}

export const round2 = (n: number) => Math.round(n * 100) / 100

// ─── pipeline status ────────────────────────────────────────────────────────

// Won / Lost / Active, and the grouped sales stage — both from the one stage
// classification in pipelineStatus.ts (lead statuses by their category).
export const OUTCOMES: Outcome[] = ['Won', 'Active', 'Lost']
export const outcomeOfStatus = (status: string | null, leadStatuses: LeadStatus[]): Outcome =>
  outcomeOf(pipelineStageOf(status, leadStatuses))
export const groupOfStatus = (status: string | null, leadStatuses: LeadStatus[]): StatusGroup =>
  STAGE_GROUP[pipelineStageOf(status, leadStatuses)]

export const STATUS_COLORS: Record<string, string> = { Won: '#10b981', Lost: '#f43f5e', Active: '#0ea5e9' }
export const outcomeColor = (group: string) => STATUS_COLORS[group] ?? STATUS_COLORS.Active

// When a pipeline row is expected to close, within financial year `fyStart`.
// App rows carry an ISO date; the imported sheet's text is freehand ("May",
// "Jun/July", "Outages –Sept/Oct", "Q2 2026", "10.09.2026"), so the first
// month named wins and a bare "Qn" gives only the (financial-year) quarter.
// A date in another year, or text with no month at all ("WORKING NOT START"),
// gives nothing.
const MONTH_INDEX = Object.fromEntries(MONTH_KEYS.map((k, i) => [k, (i + FY_FIRST_MONTH) % 12])) as Record<FyMonthKey, number>
const quarterOf = (m: FyMonthKey) => Math.floor(MONTH_KEYS.indexOf(m) / 3) + 1

export function expectedClosePeriod(text: string | null, fyStart: number): { month: FyMonthKey | null; quarter: number } | null {
  const s = (text ?? '').trim().toLowerCase()
  if (!s) return null
  const withMonth = (m: FyMonthKey | null) => (m ? { month: m, quarter: quarterOf(m) } : null)

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return withMonth(fyMonthOf(`${iso[1]}-${iso[2]}-${iso[3]}`, fyStart))
  const dotted = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/) // dd.mm.yyyy
  if (dotted) return withMonth(fyMonthOf(`${dotted[3]}-${dotted[2].padStart(2, '0')}-01`, fyStart))

  const year = Number(s.match(/\b(20\d{2})\b/)?.[1] ?? 0)
  const found = MONTH_KEYS.map(m => ({ m, at: s.search(m) })).filter(x => x.at >= 0).sort((a, b) => a.at - b.at)[0]
  const q = s.match(/\bq([1-4])\b/)
  if (q && !found) {
    // "Qn <year>": Q1–Q3 fall in the year the financial year starts, Q4 in
    // the next — though "Q4 <start year>" is common shorthand, so accept both.
    const n = Number(q[1])
    const fits = !year || year === fyStart || (n === 4 && year === fyStart + 1)
    return fits ? { month: null, quarter: n } : null
  }
  if (!found) return null
  // A month with no year is taken to be in this financial year.
  if (year && fyStartOf(new Date(year, MONTH_INDEX[found.m], 1)) !== fyStart) return null
  return withMonth(found.m)
}

// ─── invoices ───────────────────────────────────────────────────────────────

// The sector summary's grand-total row, named so in the imported sheet. It's
// worked out from the sector rows, so it's never counted as a sector.
export const SUMMARY_TOTAL_SECTOR = 'TOTAL'
export const isSummaryTotal = (s: InvoiceSectorSummary) => (s.sector ?? '').trim().toUpperCase() === SUMMARY_TOTAL_SECTOR

export const DSO_COLORS: Record<string, string> = {
  '🟢 Collected': '#10b981',
  '🔴 Overdue': '#f43f5e',
  '🟡 Pending': '#f59e0b',
  '⬛ Not Invoiced': '#9ca3af',
}
export const PAYMENT_COLORS: Record<string, string> = { Yes: '#10b981', No: '#f43f5e', 'Not marked': '#9ca3af' }
export const PAYMENT_LABELS = ['Yes', 'No', 'Not marked'] as const

export const dsoLabel = (r: InvoiceRegisterItem) => r.dsoStatus?.trim() || 'Unspecified'
export function paymentLabel(r: InvoiceRegisterItem): (typeof PAYMENT_LABELS)[number] {
  const v = r.paymentReceived?.trim().toUpperCase()
  return v === 'YES' ? 'Yes' : v === 'NO' ? 'No' : 'Not marked'
}

// Collections from invoices paid in the app — added on top of the sheet's
// sector summary, by payment month and sector.
export const liveCollections = (register: InvoiceRegisterItem[]) =>
  register.filter(r => r.sourceInvoiceId && r.paymentDate && r.amountCollectedLakhs)

// Amount collected per sector per month of financial year `fyStart` (₹
// lakhs): the sheet's figures plus the app's. Sectors are matched
// case-insensitively; the total row is left out.
export function sectorMonthly(summary: InvoiceSectorSummary[], register: InvoiceRegisterItem[], fyStart: number) {
  const map = new Map<string, { sector: string; fyTarget: number; months: Record<FyMonthKey, number> }>()
  const blank = () => Object.fromEntries(MONTH_KEYS.map(m => [m, 0])) as Record<FyMonthKey, number>
  for (const s of summary.filter(s => !isSummaryTotal(s))) {
    const name = s.sector ?? '—'
    const months = blank()
    for (const key of MONTH_KEYS) months[key] = s[key] ?? 0
    map.set(name.toLowerCase(), { sector: name, fyTarget: s.fyTarget ?? 0, months })
  }
  for (const r of liveCollections(register)) {
    const m = fyMonthOf(r.paymentDate!, fyStart)
    if (!m) continue
    const name = r.sector?.trim() || 'Unspecified'
    const entry = map.get(name.toLowerCase()) ?? { sector: name, fyTarget: 0, months: blank() }
    entry.months[m] = round2(entry.months[m] + r.amountCollectedLakhs!)
    map.set(name.toLowerCase(), entry)
  }
  return [...map.values()]
}

// Total collected per month across every sector (₹ lakhs).
export function monthlyCollections(summary: InvoiceSectorSummary[], register: InvoiceRegisterItem[], fyStart: number): Record<FyMonthKey, number> {
  const total = summary.find(isSummaryTotal)
  const live = liveCollections(register)
  return Object.fromEntries(MONTH_KEYS.map(key => [
    key,
    round2(Number(total?.[key] ?? 0) + live.filter(r => fyMonthOf(r.paymentDate!, fyStart) === key).reduce((sum, r) => sum + r.amountCollectedLakhs!, 0)),
  ])) as Record<FyMonthKey, number>
}

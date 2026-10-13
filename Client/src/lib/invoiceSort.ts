import type { InvoiceRegisterItem } from './api'
import type { SortDirection } from './pipelineSort'

export type InvoiceSortKey = 'sheet' | 'date' | 'amount' | 'outstanding' | 'dso' | 'sector'

export const INVOICE_SORT_OPTIONS: { key: InvoiceSortKey; label: string; asc: string; desc: string }[] = [
  { key: 'sheet', label: 'Sheet order', asc: '', desc: '' },
  { key: 'date', label: 'Invoice date', asc: 'Oldest first', desc: 'Newest first' },
  { key: 'amount', label: 'Invoice amount', asc: 'Lowest first', desc: 'Highest first' },
  { key: 'outstanding', label: 'Balance outstanding', asc: 'Lowest first', desc: 'Highest first' },
  { key: 'dso', label: 'DSO status', asc: 'Overdue first', desc: 'Collected first' },
  { key: 'sector', label: 'Sector', asc: 'A → Z', desc: 'Z → A' },
]

// The direction each key starts in when picked: newest, biggest and most
// urgent first; sectors alphabetically.
export const DEFAULT_INVOICE_DIRECTION: Record<InvoiceSortKey, SortDirection> = {
  sheet: 'asc', date: 'desc', amount: 'desc', outstanding: 'desc', dso: 'asc', sector: 'asc',
}

// Most urgent first. Matched on the wording, not the emoji, so a hand-edited
// "Overdue" without its 🔴 still sorts with the rest.
function dsoRank(r: InvoiceRegisterItem): number | null {
  const s = (r.dsoStatus ?? '').toLowerCase()
  if (s.includes('overdue')) return 0
  if (s.includes('pending')) return 1
  if (s.includes('not invoiced')) return 2
  if (s.includes('collected')) return 3
  return null
}

const time = (ts: string | null) => (ts ? new Date(ts).getTime() : null)

// Compares two possibly-blank values: blanks always last, whatever the direction.
function compareNullable(a: number | string | null, b: number | string | null, dir: number): number {
  if (a == null || b == null) return (a == null ? 1 : 0) - (b == null ? 1 : 0)
  if (typeof a === 'string' && typeof b === 'string') return dir * a.localeCompare(b, undefined, { sensitivity: 'base' })
  return dir * ((a as number) - (b as number))
}

// Returns a sorted copy. Ties fall back to invoice amount (highest first);
// anything still tied keeps its original order (Array.prototype.sort is stable).
export function sortInvoices(rows: InvoiceRegisterItem[], key: InvoiceSortKey, direction: SortDirection): InvoiceRegisterItem[] {
  if (key === 'sheet') return rows
  const dir = direction === 'asc' ? 1 : -1
  const byAmount = (a: InvoiceRegisterItem, b: InvoiceRegisterItem) => compareNullable(a.invoiceAmountLakhs, b.invoiceAmountLakhs, -1)
  return [...rows].sort((a, b) => {
    switch (key) {
      case 'date': return compareNullable(time(a.invoiceDate), time(b.invoiceDate), dir) || byAmount(a, b)
      case 'amount': return compareNullable(a.invoiceAmountLakhs, b.invoiceAmountLakhs, dir)
      case 'outstanding': return compareNullable(a.balanceOutstandingLakhs, b.balanceOutstandingLakhs, dir) || byAmount(a, b)
      case 'dso': return compareNullable(dsoRank(a), dsoRank(b), dir) || byAmount(a, b)
      case 'sector': return compareNullable(a.sector?.trim() || null, b.sector?.trim() || null, dir) || byAmount(a, b)
    }
  })
}

import type { PipelineTrackerItem, InvoiceRegisterItem, LeadStatus } from './api'
import { pipelineStageOf, STAGE_RANK, STAGE_ON_HOLD } from './pipelineStatus'
import { isInrCurrency } from './format'
import { expectedClosePeriod, fyStartOf, FY_MONTHS } from './trackerReports'

// Orderings for the Tracker's sortable columns that a plain value can't
// express (see SortSpec.compare in useTableView). `dir` is 1 for the column's
// ascending order, -1 for descending.

// Value is in lakhs for INR rows but in plain units for any other currency,
// so the two can't be compared: INR rows sort among themselves first, then
// other currencies, then rows with no value — whichever way the column runs.
function valueGroup(r: PipelineTrackerItem): number {
  if (r.valueLakhs == null) return 2
  return isInrCurrency(r.currency) ? 0 : 1
}

export function comparePipelineValue(a: PipelineTrackerItem, b: PipelineTrackerItem, dir: number): number {
  const ga = valueGroup(a), gb = valueGroup(b)
  if (ga !== gb) return ga - gb
  if (ga === 2) return 0
  return dir * (a.valueLakhs! - b.valueLakhs!)
}

// By sales stage (shared with the Reports charts, see pipelineStatus.ts).
// Only the active stages flip with the direction; on hold, lost and unknown
// stay at the bottom in that order. Ties: biggest deal first.
export function comparePipelineStage(a: PipelineTrackerItem, b: PipelineTrackerItem, dir: number, leadStatuses: LeadStatus[]): number {
  const sa = STAGE_RANK[pipelineStageOf(a.status, leadStatuses)], sb = STAGE_RANK[pipelineStageOf(b.status, leadStatuses)]
  const diff = sa < STAGE_ON_HOLD && sb < STAGE_ON_HOLD ? dir * (sa - sb) : sa - sb
  return diff || comparePipelineValue(a, b, -1)
}

// When a row is expected to close, as a sortable number within this
// financial year (a bare "Q3" counts as the quarter's middle month); text
// that names no month or quarter has none.
export function expectedCloseOrder(r: PipelineTrackerItem): number | null {
  const at = expectedClosePeriod(r.expectedClose, fyStartOf(new Date()))
  if (!at) return null
  return at.month ? FY_MONTHS.findIndex(m => m.key === at.month) : at.quarter * 3 - 2
}

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, med: 1, low: 2 }
export const priorityOrder = (r: PipelineTrackerItem) => PRIORITY_RANK[(r.priority ?? '').trim().toLowerCase()] ?? null

// Collection status, most urgent first. Matched on the wording, not the
// emoji, so a hand-edited "Overdue" without its 🔴 still sorts with the rest.
export function dsoOrder(r: InvoiceRegisterItem): number | null {
  const s = (r.dsoStatus ?? '').toLowerCase()
  if (s.includes('overdue')) return 0
  if (s.includes('pending')) return 1
  if (s.includes('not invoiced')) return 2
  if (s.includes('collected')) return 3
  return null
}

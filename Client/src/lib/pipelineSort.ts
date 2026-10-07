import type { PipelineTrackerItem, LeadStatus } from './api'
import { pipelineStageOf, STAGE_RANK, STAGE_ON_HOLD } from './pipelineStatus'
import { isInrCurrency } from './format'

export type PipelineSortKey = 'sheet' | 'stage' | 'value' | 'vertical'
export type SortDirection = 'asc' | 'desc'

export const PIPELINE_SORT_OPTIONS: { key: PipelineSortKey; label: string; asc: string; desc: string }[] = [
  { key: 'sheet', label: 'Sheet order', asc: '', desc: '' },
  { key: 'stage', label: 'Stage', asc: 'Earliest stage first', desc: 'Furthest stage first' },
  { key: 'value', label: 'Value', asc: 'Lowest first', desc: 'Highest first' },
  { key: 'vertical', label: 'Vertical', asc: 'A → Z', desc: 'Z → A' },
]

// The direction each key starts in when picked — always descending: highest
// value first, closest to completion first.
export const DEFAULT_DIRECTION: Record<PipelineSortKey, SortDirection> = {
  sheet: 'asc', stage: 'desc', value: 'desc', vertical: 'desc',
}

// Value is in lakhs for INR rows but in plain units for any other currency,
// so the two can't be compared: INR rows sort among themselves first, then
// other currencies, then rows with no value.
function valueGroup(r: PipelineTrackerItem): number {
  if (r.valueLakhs == null) return 2
  return isInrCurrency(r.currency) ? 0 : 1
}

const verticalName = (r: PipelineTrackerItem) => (r.vertical ?? '').trim()

function compareValue(a: PipelineTrackerItem, b: PipelineTrackerItem, dir: number): number {
  const ga = valueGroup(a), gb = valueGroup(b)
  if (ga !== gb) return ga - gb
  if (ga === 2) return 0
  return dir * (a.valueLakhs! - b.valueLakhs!)
}

// Returns a sorted copy. Ties fall back to value (highest first) so rows in
// the same stage or vertical show the biggest deals first; anything still
// tied keeps its original order (Array.prototype.sort is stable).
export function sortPipeline(rows: PipelineTrackerItem[], key: PipelineSortKey, direction: SortDirection, leadStatuses: LeadStatus[] = []): PipelineTrackerItem[] {
  if (key === 'sheet') return rows
  const dir = direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    if (key === 'value') return compareValue(a, b, dir)
    if (key === 'stage') {
      const sa = STAGE_RANK[pipelineStageOf(a.status, leadStatuses)], sb = STAGE_RANK[pipelineStageOf(b.status, leadStatuses)]
      // The stage comes from pipelineStatus.ts (shared with the Reports
      // charts). Only the active stages flip with the direction; on hold,
      // lost and unknown stay at the bottom in that order.
      const diff = sa < STAGE_ON_HOLD && sb < STAGE_ON_HOLD ? dir * (sa - sb) : sa - sb
      return diff || compareValue(a, b, -1)
    }
    // vertical — blanks last; "SixDX" and "SIxDX" count as the same vertical
    const va = verticalName(a), vb = verticalName(b)
    if (!va || !vb) return (va ? 0 : 1) - (vb ? 0 : 1) || compareValue(a, b, -1)
    return dir * va.localeCompare(vb, undefined, { sensitivity: 'base' }) || compareValue(a, b, -1)
  })
}

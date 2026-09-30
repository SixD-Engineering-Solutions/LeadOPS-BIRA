import type { PipelineTrackerItem } from '../../lib/api'
import { Modal } from '../Modal'
import { formatLakhs, formatSheetValue, isInrCurrency } from '../../lib/format'

const fmtValue = (r: PipelineTrackerItem) => (r.valueLakhs == null ? null : formatSheetValue(r.valueLakhs, r.currency))
const isInr = (r: PipelineTrackerItem) => isInrCurrency(r.currency)
// expectedClose is freehand sheet text ("Q3", "Oct-26") as often as a date,
// so only reformat it when it actually parses.
const fmtClose = (v: string | null) => {
  if (!v?.trim()) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v.trim() : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// Opened by clicking a bar in "Pipeline by status" — lists the Tracker rows
// behind that bar, biggest value first. `showRowStatus` is for the chart's
// grouped view, where one bar mixes several exact statuses.
export default function PipelineStatusModal({ status, rows, showRowStatus = false, onClose }: {
  status: string
  rows: PipelineTrackerItem[]
  showRowStatus?: boolean
  onClose: () => void
}) {
  // INR rows by value first, then foreign-currency rows, then rows with no value.
  const rank = (r: PipelineTrackerItem) => (r.valueLakhs == null ? 2 : isInr(r) ? 0 : 1)
  const sorted = [...rows].sort((a, b) => rank(a) - rank(b) || (b.valueLakhs ?? 0) - (a.valueLakhs ?? 0))
  const totalLakhs = rows.filter(isInr).reduce((sum, r) => sum + (r.valueLakhs ?? 0), 0)
  const foreignTotals = new Map<string, number>()
  for (const r of rows) {
    if (isInr(r) || r.valueLakhs == null) continue
    const cur = r.currency!.trim().toUpperCase()
    foreignTotals.set(cur, (foreignTotals.get(cur) ?? 0) + r.valueLakhs)
  }
  const totals = [
    totalLakhs > 0 ? formatLakhs(Math.round(totalLakhs * 100) / 100) : null,
    ...[...foreignTotals].map(([cur, v]) => formatSheetValue(v, cur)),
  ].filter(Boolean).join(' + ')

  return (
    <Modal
      title={status}
      subtitle={`${rows.length} lead${rows.length === 1 ? '' : 's'}${totals ? ` · ${totals} total` : ''}`}
      onClose={onClose}
      width="lg"
      bodyClassName="px-5"
    >
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {sorted.map(r => {
          const where = [r.location, r.service, r.vertical].filter(Boolean).join(' · ')
          const meta = [
            r.owner && `Owner: ${r.owner}`,
            fmtClose(r.expectedClose) && `Close: ${fmtClose(r.expectedClose)}`,
            r.probabilityPct != null && `${Math.round(r.probabilityPct)}%`,
          ].filter(Boolean).join('  ·  ')
          return (
            <li key={r.id} className="py-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{r.client?.trim() || 'Unnamed client'}</p>
                {fmtValue(r) && (
                  <span className="shrink-0 text-sm font-semibold text-gray-700 dark:text-gray-200">{fmtValue(r)}</span>
                )}
              </div>
              {where && <p className="truncate text-xs text-gray-500 dark:text-gray-400">{where}</p>}
              {showRowStatus && (
                <span className="mt-1 inline-block rounded-full border border-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:border-gray-700 dark:text-gray-300">
                  {r.status?.trim() || 'Unspecified'}
                </span>
              )}
              {r.description?.trim() && <p className="mt-1 line-clamp-2 text-xs text-gray-600 dark:text-gray-300">{r.description.trim()}</p>}
              {meta && <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-400">{meta}</p>}
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}

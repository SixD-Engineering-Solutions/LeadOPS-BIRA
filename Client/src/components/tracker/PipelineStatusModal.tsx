import { useEffect } from 'react'
import type { PipelineTrackerItem } from '../../lib/api'

const fmtLakhs = (v: number | null) => (v == null ? null : `₹${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}L`)
// The sheet's value column is ₹ lakhs for INR rows, but a plain amount for
// foreign-currency rows (e.g. USD 277,800) — never mix the two.
const isInr = (r: PipelineTrackerItem) => !r.currency?.trim() || r.currency.trim().toUpperCase() === 'INR'
const fmtValue = (r: PipelineTrackerItem) =>
  r.valueLakhs == null ? null : isInr(r) ? fmtLakhs(r.valueLakhs) : `${r.currency!.trim().toUpperCase()} ${r.valueLakhs.toLocaleString()}`
// expectedClose is freehand sheet text ("Q3", "Oct-26") as often as a date,
// so only reformat it when it actually parses.
const fmtClose = (v: string | null) => {
  if (!v?.trim()) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v.trim() : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// Opened by clicking a bar in "Pipeline by status" — lists the Tracker rows
// behind that bar, biggest value first.
export default function PipelineStatusModal({ status, rows, onClose }: { status: string; rows: PipelineTrackerItem[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
    totalLakhs > 0 ? fmtLakhs(Math.round(totalLakhs * 100) / 100) : null,
    ...[...foreignTotals].map(([cur, v]) => `${cur} ${v.toLocaleString()}`),
  ].filter(Boolean).join(' + ')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl border border-gray-100 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold text-gray-900 dark:text-gray-100">{status}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {rows.length} lead{rows.length === 1 ? '' : 's'}
              {totals ? ` · ${totals} total` : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-base leading-none text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
            aria-label="Close"
          >✕</button>
        </div>

        <ul className="divide-y divide-gray-100 overflow-y-auto px-5 dark:divide-gray-800">
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
                {r.description?.trim() && <p className="mt-1 line-clamp-2 text-xs text-gray-600 dark:text-gray-300">{r.description.trim()}</p>}
                {meta && <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">{meta}</p>}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

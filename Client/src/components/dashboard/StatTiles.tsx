import type { LeadStats } from '../../hooks/useLeadStats'
import type { ProposalStats } from '../../hooks/useProposalStats'
import { ErrorBanner } from '../ErrorBanner'

// Thin upward line (2px, rounded ends) with a small end marker. Emerald = growth.
function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return <div className="h-6 w-[72px]" />
  const w = 72, h = 24
  const max = Math.max(...data), min = Math.min(...data)
  const range = max - min || 1
  const y = (v: number) => h - ((v - min) / range) * h
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={w} cy={y(data[data.length - 1])} r="2.5" fill="#10b981" />
    </svg>
  )
}

// Circular progress ring for a percentage. Track + orange arc.
function Ring({ pct }: { pct: number }) {
  const r = 15, c = 2 * Math.PI * r
  const dash = (Math.max(0, Math.min(pct, 100)) / 100) * c
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r={r} fill="none" stroke="#eef2f7" strokeWidth="4" />
      <circle cx="20" cy="20" r={r} fill="none" stroke="#f97316" strokeWidth="4" strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`} transform="rotate(-90 20 20)" />
    </svg>
  )
}

// The 5 stat tiles on the dashboard home view — lead stats (Total Leads,
// Conversion Rate) and proposal stats (Pipeline Value,
// Orders Received, Lost Deals). Each source fetches independently (see
// useLeadStats/useProposalStats), so one failing doesn't block the other —
// a failed source shows a dismissable-by-retry error banner above the grid
// instead of the tiles it feeds silently going stale.
export function StatTiles({
  stats, proposalStats, leadStatsError, proposalStatsError, onRetryLeadStats, onRetryProposalStats,
  onOpenAssignments, onOpenProposals,
}: {
  stats: LeadStats
  proposalStats: ProposalStats
  leadStatsError: string | null
  proposalStatsError: string | null
  onRetryLeadStats: () => void
  onRetryProposalStats: () => void
  onOpenAssignments: () => void
  onOpenProposals: () => void
}) {
  return (
    <>
      {leadStatsError && <ErrorBanner message={leadStatsError} onRetry={onRetryLeadStats} className="mb-4" />}
      {proposalStatsError && <ErrorBanner message={proposalStatsError} onRetry={onRetryProposalStats} className="mb-4" />}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
        {/* Total Leads — upward sparkline. Click to see who each lead is
            assigned to (admin), or the details of your own leads (employee). */}
        <button
          type="button"
          onClick={() => stats.loaded && onOpenAssignments()}
          disabled={!stats.loaded}
          className="w-full rounded-2xl border border-gray-100 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-md disabled:cursor-default disabled:hover:translate-y-0 disabled:hover:border-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-orange-900"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Total Leads</p>
            {stats.loaded && (
              <svg className="h-3.5 w-3.5 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            )}
          </div>
          <div className="mt-1 flex items-end justify-between gap-2">
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats.loaded ? stats.total.toLocaleString() : '—'}</p>
              <p className={`mt-0.5 text-[11px] font-medium ${stats.loaded && stats.weekAdded > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-500'}`}>
                {stats.loaded ? (stats.weekAdded > 0 ? `+${stats.weekAdded} this week` : 'No new this week') : ' '}
              </p>
            </div>
            <Sparkline data={stats.spark} />
          </div>
        </button>

        {/* Conversion Rate — circular progress ring */}
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Conversion Rate</p>
          <div className="mt-1 flex items-center justify-between gap-2">
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats.loaded ? `${stats.conversion}%` : '—'}</p>
              <p className="mt-0.5 text-[11px] font-medium text-gray-400 dark:text-gray-500">
                {stats.loaded ? `${stats.converted} of ${stats.total} converted` : ' '}
              </p>
            </div>
            <Ring pct={stats.loaded ? stats.conversion : 0} />
          </div>
        </div>

        {/* Pipeline Value — sum of open (not Won/Lost) proposal values */}
        <button
          type="button"
          onClick={() => proposalStats.loaded && onOpenProposals()}
          disabled={!proposalStats.loaded}
          className="w-full rounded-2xl border border-gray-100 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-md disabled:cursor-default disabled:hover:translate-y-0 disabled:hover:border-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-orange-900"
        >
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Pipeline Value</p>
          <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
            {proposalStats.loaded ? `₹${proposalStats.pendingValue.toLocaleString()}` : '—'}
          </p>
          <p className="mt-0.5 text-[11px] font-medium text-gray-400 dark:text-gray-500">
            {proposalStats.loaded ? `${proposalStats.pendingCount} open proposal${proposalStats.pendingCount === 1 ? '' : 's'}` : ' '}
          </p>
        </button>

        {/* Orders Received — sum of Won proposal values */}
        <button
          type="button"
          onClick={() => proposalStats.loaded && onOpenProposals()}
          disabled={!proposalStats.loaded}
          className="w-full rounded-2xl border border-gray-100 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-md disabled:cursor-default disabled:hover:translate-y-0 disabled:hover:border-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-orange-900"
        >
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Orders Received</p>
          <p className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {proposalStats.loaded ? `₹${proposalStats.wonValue.toLocaleString()}` : '—'}
          </p>
          <p className="mt-0.5 text-[11px] font-medium text-gray-400 dark:text-gray-500">
            {proposalStats.loaded ? `${proposalStats.wonCount} won proposal${proposalStats.wonCount === 1 ? '' : 's'}` : ' '}
          </p>
        </button>

        {/* Lost Deals — count + value of Lost proposals */}
        <button
          type="button"
          onClick={() => proposalStats.loaded && onOpenProposals()}
          disabled={!proposalStats.loaded}
          className="w-full rounded-2xl border border-gray-100 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-md disabled:cursor-default disabled:hover:translate-y-0 disabled:hover:border-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-orange-900"
        >
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Lost Deals</p>
          <p className="mt-1 text-2xl font-bold text-rose-500 dark:text-rose-400">
            {proposalStats.loaded ? String(proposalStats.lostCount) : '—'}
          </p>
          <p className="mt-0.5 text-[11px] font-medium text-gray-400 dark:text-gray-500">
            {proposalStats.loaded ? `₹${proposalStats.lostValue.toLocaleString()} lost value` : ' '}
          </p>
        </button>
      </div>
    </>
  )
}

import type { BillingStats } from '../../hooks/useBillingStats'
import { ErrorBanner } from '../ErrorBanner'
import { SkeletonRows } from '../Skeleton'
import { PendingPaymentsPanel } from './PendingPaymentsPanel'
import { formatINR, formatINRCompact } from '../../lib/format'

const tile = 'w-full rounded-2xl border border-gray-100 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-orange-900'

// What the Accounts team sees on the dashboard: projects waiting to be
// invoiced (completed by BD and handed over), money outstanding, what is
// overdue, and what came in this month.
export function AccountsDashboard({ stats, error, onRetry, onOpenProjects, onOpenInvoices }: {
  stats: BillingStats
  error: string | null
  onRetry: () => void
  onOpenProjects: () => void
  onOpenInvoices: () => void
}) {
  const count = (n: number) => (stats.loaded ? String(n) : '—')
  const money = (n: number) => (stats.loaded ? formatINRCompact(n) : '—')
  const invoices = (n: number) => `${n} invoice${n === 1 ? '' : 's'}`
  return (
    <>
      {error && <ErrorBanner message={error} onRetry={onRetry} className="mb-4" />}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <button type="button" onClick={onOpenProjects} className={tile}>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Ready to invoice</p>
          <p className="mt-1 text-2xl font-bold text-orange-500">{count(stats.ready.length)}</p>
          <p className="mt-0.5 text-[11px] font-medium text-gray-400">completed projects with no invoice yet</p>
        </button>
        <button type="button" onClick={onOpenInvoices} className={tile}>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Awaiting payment</p>
          <p className="mt-1 text-2xl font-bold text-indigo-600 dark:text-indigo-400" title={stats.loaded ? formatINR(stats.pendingAmount) : undefined}>{money(stats.pendingAmount)}</p>
          <p className="mt-0.5 text-[11px] font-medium text-gray-400">{stats.loaded ? `${invoices(stats.pending.length)} open` : ' '}</p>
        </button>
        <button type="button" onClick={onOpenInvoices} className={tile}>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Overdue</p>
          <p className="mt-1 text-2xl font-bold text-rose-500 dark:text-rose-400" title={stats.loaded ? formatINR(stats.overdueAmount) : undefined}>{money(stats.overdueAmount)}</p>
          <p className="mt-0.5 text-[11px] font-medium text-gray-400">{stats.loaded ? `${invoices(stats.overdueCount)} past due` : ' '}</p>
        </button>
        <button type="button" onClick={onOpenInvoices} className={tile}>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Collected this month</p>
          <p className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400" title={stats.loaded ? formatINR(stats.collectedThisMonth) : undefined}>{money(stats.collectedThisMonth)}</p>
          <p className="mt-0.5 text-[11px] font-medium text-gray-400">payments recorded</p>
        </button>
      </div>

      <div className="mt-6 grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
        <div className="h-full rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="border-b border-gray-100 px-5 py-3 dark:border-gray-800">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Ready to invoice</h3>
          </div>
          {!stats.loaded ? (
            <SkeletonRows rows={2} />
          ) : stats.ready.length === 0 ? (
            <p className="px-5 py-4 text-sm text-gray-500 dark:text-gray-400">Nothing waiting — projects show up here the moment they are completed.</p>
          ) : (
            <ul className="max-h-80 divide-y divide-gray-50 overflow-y-auto dark:divide-gray-800/60">
              {stats.ready.map(p => (
                <li key={p.id} onClick={onOpenInvoices} className="flex cursor-pointer items-center justify-between gap-3 px-5 py-3 hover:bg-gray-50/60 dark:hover:bg-gray-800/60">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{p.workOrderNo} — {p.projectName}</p>
                    <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{[p.lead?.plant?.client?.clientName, p.lead?.plant?.plantName].filter(Boolean).join(' · ') || '—'}</p>
                  </div>
                  {p.proposal?.value != null && <span className="shrink-0 text-xs font-semibold text-gray-700 dark:text-gray-200">{formatINRCompact(p.proposal.value)} order</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <PendingPaymentsPanel pendingInvoices={{ invoices: stats.pending, loaded: stats.loaded }} error={null} onRetry={onRetry} onOpenInvoices={onOpenInvoices} />
      </div>
    </>
  )
}

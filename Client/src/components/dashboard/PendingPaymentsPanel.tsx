import type { Invoice } from '../../lib/api'
import { ErrorBanner } from '../ErrorBanner'
import { formatINR } from '../../lib/format'
import { EmptyState } from '../EmptyState'
import { SkeletonRows } from '../Skeleton'
import { BADGE_TONES } from '../../lib/statusStyles'

const fmtDate = (ts: string) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

// Invoices with money still outstanding. Placeholder rows while loading and
// an empty state when everything's paid; on error, a retry.
export function PendingPaymentsPanel({ pendingInvoices, error, onRetry, onOpenInvoices }: {
  pendingInvoices: { invoices: Invoice[]; loaded: boolean }
  error: string | null
  onRetry: () => void
  onOpenInvoices: () => void
}) {
  if (error) return <ErrorBanner message={error} onRetry={onRetry} className="mt-6" />

  return (
    <div className="mt-6 rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="border-b border-gray-100 px-5 py-3 dark:border-gray-800">
        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Pending Payments</h3>
      </div>
      {!pendingInvoices.loaded ? (
        <SkeletonRows rows={2} />
      ) : pendingInvoices.invoices.length === 0 ? (
        <EmptyState compact icon="check" title="No payments pending" message="Every invoice raised so far has been paid in full." />
      ) : (
      <ul className="divide-y divide-gray-50 dark:divide-gray-800/60">
        {pendingInvoices.invoices.map(inv => {
          const outstanding = inv.amount - inv.payments.reduce((sum, p) => sum + p.amountReceived, 0)
          return (
            <li
              key={inv.id}
              onClick={onOpenInvoices}
              className="flex cursor-pointer items-center justify-between gap-3 px-5 py-3 hover:bg-gray-50/60 dark:hover:bg-gray-800/60"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{inv.invoiceNumber} — {inv.project?.projectName ?? '—'}</p>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Due {fmtDate(inv.dueDate ?? inv.createdAt)}</p>
              </div>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${BADGE_TONES.rose}`}>
                {formatINR(outstanding)} due
              </span>
            </li>
          )
        })}
      </ul>
      )}
    </div>
  )
}

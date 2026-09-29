import type { Invoice } from '../../lib/api'
import { ErrorBanner } from '../ErrorBanner'

const fmtDate = (ts: string) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

// Invoices with money still outstanding. Hidden entirely once loaded with
// nothing pending; on error, shows a retry instead of silently vanishing.
export function PendingPaymentsPanel({ pendingInvoices, error, onRetry, onOpenInvoices }: {
  pendingInvoices: { invoices: Invoice[]; loaded: boolean }
  error: string | null
  onRetry: () => void
  onOpenInvoices: () => void
}) {
  if (error) return <ErrorBanner message={error} onRetry={onRetry} className="mt-6" />
  if (!pendingInvoices.loaded || pendingInvoices.invoices.length === 0) return null

  return (
    <div className="mt-6 rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="border-b border-gray-100 px-5 py-3 dark:border-gray-800">
        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Pending Payments</h3>
      </div>
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
              <span className="shrink-0 rounded-full border border-rose-200 bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:border-rose-800 dark:bg-rose-900/40 dark:text-rose-300">
                ₹{outstanding.toLocaleString()} due
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

import type { InvoiceRegisterItem } from '../../lib/api'
import { Modal } from '../Modal'
import { formatLakhs } from '../../lib/format'
import { round2 } from '../../lib/trackerReports'

const fmtDate = (ts: string | null) => (ts ? new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null)
const time = (ts: string | null) => (ts ? new Date(ts).getTime() : 0)

// Opened by clicking a value in one of the Reports' invoice charts — lists the
// Invoice register rows behind it, newest first. `note` explains anything the
// list can't account for (e.g. a summary figure entered without invoice rows).
export default function InvoiceListModal({ title, rows, note, onClose }: {
  title: string
  rows: InvoiceRegisterItem[]
  note?: string
  onClose: () => void
}) {
  const sorted = [...rows].sort((a, b) => time(b.invoiceDate) - time(a.invoiceDate) || (b.invoiceAmountLakhs ?? 0) - (a.invoiceAmountLakhs ?? 0))
  const invoiced = round2(rows.reduce((s, r) => s + (r.invoiceAmountLakhs ?? 0), 0))
  const outstanding = round2(rows.reduce((s, r) => s + (r.balanceOutstandingLakhs ?? 0), 0))
  const subtitle = [
    `${rows.length} invoice${rows.length === 1 ? '' : 's'}`,
    invoiced > 0 && `${formatLakhs(invoiced)} invoiced`,
    outstanding > 0 && `${formatLakhs(outstanding)} outstanding`,
  ].filter(Boolean).join(' · ')

  return (
    <Modal title={title} subtitle={subtitle} onClose={onClose} width="lg" bodyClassName="px-5">
      {note && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{note}</p>}
      {sorted.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">No invoices in the register for this.</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {sorted.map(r => {
            const where = [r.sector, r.location, r.serviceType].map(v => v?.trim()).filter(Boolean).join(' · ')
            const meta = [
              r.invoiceNumber?.trim(),
              fmtDate(r.invoiceDate),
              r.bmOwner?.trim() && `BM: ${r.bmOwner.trim()}`,
              r.balanceOutstandingLakhs ? `${formatLakhs(r.balanceOutstandingLakhs)} outstanding` : null,
              r.daysToCollect != null && `${r.daysToCollect} days to collect`,
            ].filter(Boolean).join('  ·  ')
            return (
              <li key={r.id} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{r.client?.trim() || 'Unnamed client'}</p>
                  {r.invoiceAmountLakhs != null && (
                    <span className="shrink-0 text-sm font-semibold text-gray-700 dark:text-gray-200">{formatLakhs(r.invoiceAmountLakhs)}</span>
                  )}
                </div>
                {where && <p className="truncate text-xs text-gray-500 dark:text-gray-400">{where}</p>}
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {r.dsoStatus?.trim() && (
                    <span className="rounded-full border border-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:border-gray-700 dark:text-gray-300">{r.dsoStatus.trim()}</span>
                  )}
                  {r.sourceInvoiceId && (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">From the app</span>
                  )}
                </div>
                {meta && <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-400">{meta}</p>}
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}

import { useEffect, useState } from 'react'
import { api, INVOICE_SYNC_EVENT, INVOICE_STATUSES } from '../lib/api'
import type { Invoice, InvoiceStatus, Project } from '../lib/api'
import { ErrorBanner } from '../components/ErrorBanner'
import { INVOICE_STATUS_STYLES, DEFAULT_STATUS_STYLE } from '../lib/statusStyles'
import { formatINR } from '../lib/format'
import { EmptyState } from '../components/EmptyState'
import { focusCreateForm } from '../lib/focusCreateForm'
import { SkeletonRows } from '../components/Skeleton'
import { LeadDetailById } from '../components/LeadDetailModal'
import { useTableView } from '../lib/useTableView'
import { useConfirm } from '../lib/useConfirm'
import { DataGrid } from '../components/table/DataGrid'
import type { Column } from '../components/table/DataGrid'
import { TableToolbar, TableFooter, NoMatches, RefreshButton } from '../components/table/TableToolbar'
import { MenuSelect } from '../components/table/MenuSelect'
import { RowMenu } from '../components/table/RowMenu'
import { DueDate } from '../components/table/RelTime'
import { formatDate, formatRelative } from '../lib/relativeTime'

const statusStyle = (name: string) => INVOICE_STATUS_STYLES[name] ?? DEFAULT_STATUS_STYLE
const fmtMoney = formatINR
const paidOf = (inv: Invoice) => inv.payments.reduce((sum, p) => sum + p.amountReceived, 0)
const outstandingOf = (inv: Invoice) => Math.max(0, inv.amount - paidOf(inv))
const clientOf = (inv: Invoice) => inv.project?.lead?.plant?.client?.clientName ?? null
const plantOf = (inv: Invoice) => inv.project?.lead?.plant?.plantName ?? null
const isOverdue = (inv: Invoice) => inv.status === 'Overdue' || (outstandingOf(inv) > 0 && !!inv.dueDate && new Date(inv.dueDate).getTime() < Date.now())

const inputCls = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'
const emptyForm = { projectId: '', amount: '', invoiceDate: '', dueDate: '' }
const emptyPaymentForm = { amountReceived: '', paymentDate: new Date().toISOString().slice(0, 10), notes: '' }

export default function Invoices({ isAdmin }: { isAdmin: boolean }) {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({ ...emptyForm })
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [paymentForm, setPaymentForm] = useState({ ...emptyPaymentForm })
  const [payingId, setPayingId] = useState<string | null>(null)
  const [payError, setPayError] = useState<string | null>(null)
  const [voidingId, setVoidingId] = useState<string | null>(null)

  function load() {
    setLoading(true)
    api<{ invoices: Invoice[] }>('/invoices', { auth: true })
      .then(({ invoices }) => { setInvoices(invoices); setError(null) })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load invoices.'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    api<{ projects: Project[] }>('/projects', { auth: true }).then(({ projects }) => setProjects(projects)).catch(() => {})
  }, [])

  // Live updates — an invoice created/updated (including a payment logged by
  // anyone) resyncs this list.
  useEffect(() => {
    function onInvoiceSync() { load() }
    window.addEventListener(INVOICE_SYNC_EVENT, onInvoiceSync)
    return () => window.removeEventListener(INVOICE_SYNC_EVENT, onInvoiceSync)
  }, [])

  const projectLabel = (p: Project) => `${p.workOrderNo} — ${p.projectName}${p.lead?.plant?.client?.clientName ? ` (${p.lead.plant.client.clientName})` : ''}`

  async function createInvoice(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!form.projectId) { setFormError('Project is required.'); return }
    if (!form.amount || Number(form.amount) <= 0) { setFormError('Amount must be greater than 0.'); return }
    setCreating(true)
    try {
      const { invoice } = await api<{ invoice: Invoice }>('/invoices', {
        method: 'POST',
        auth: true,
        body: {
          projectId: form.projectId,
          amount: Number(form.amount),
          invoiceDate: form.invoiceDate || undefined,
          dueDate: form.dueDate || undefined,
        },
      })
      setInvoices(prev => [invoice, ...prev])
      setForm({ ...emptyForm })
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not create invoice.')
    } finally {
      setCreating(false)
    }
  }

  async function changeStatus(id: string, status: InvoiceStatus) {
    try {
      const { invoice } = await api<{ invoice: Invoice }>(`/invoices/${id}`, { method: 'PATCH', auth: true, body: { status } })
      setInvoices(prev => prev.map(i => (i.id === id ? invoice : i)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update status.')
    }
  }

  function toggleExpanded(id: string) {
    setExpandedId(prev => (prev === id ? null : id))
    setPaymentForm({ ...emptyPaymentForm })
    setPayError(null)
  }

  async function logPayment(e: React.FormEvent, invoiceId: string) {
    e.preventDefault()
    setPayError(null)
    if (!paymentForm.amountReceived || Number(paymentForm.amountReceived) <= 0) { setPayError('Amount must be greater than 0.'); return }
    setPayingId(invoiceId)
    try {
      const { invoice } = await api<{ invoice: Invoice }>(`/invoices/${invoiceId}/payments`, {
        method: 'POST',
        auth: true,
        body: {
          amountReceived: Number(paymentForm.amountReceived),
          paymentDate: paymentForm.paymentDate || undefined,
          notes: paymentForm.notes || undefined,
        },
      })
      setInvoices(prev => prev.map(i => (i.id === invoiceId ? invoice : i)))
      setPaymentForm({ ...emptyPaymentForm })
    } catch (e) {
      setPayError(e instanceof Error ? e.message : 'Could not record payment.')
    } finally {
      setPayingId(null)
    }
  }

  const [confirmDialog, confirm] = useConfirm()
  async function voidPayment(invoiceId: string, paymentId: string) {
    const ok = await confirm({
      title: 'Void this payment?',
      message: 'It stops counting toward what’s been paid. Record a corrected one afterwards if needed.',
      confirmLabel: 'Void payment',
      danger: true,
    })
    if (!ok) return
    setVoidingId(paymentId)
    try {
      const { invoice } = await api<{ invoice: Invoice }>(`/invoices/${invoiceId}/payments/${paymentId}`, { method: 'DELETE', auth: true })
      setInvoices(prev => prev.map(i => (i.id === invoiceId ? invoice : i)))
    } catch (e) {
      setPayError(e instanceof Error ? e.message : 'Could not void payment.')
    } finally {
      setVoidingId(null)
    }
  }

  const [openLeadId, setOpenLeadId] = useState<string | null>(null)

  const view = useTableView<Invoice>({
    id: 'invoices',
    rows: invoices,
    search: inv => [inv.invoiceNumber, inv.project?.workOrderNo, inv.project?.projectName, clientOf(inv), plantOf(inv), inv.status].join(' '),
    views: [
      { id: 'all', label: 'All' },
      { id: 'outstanding', label: 'Outstanding', match: inv => outstandingOf(inv) > 0 },
      { id: 'overdue', label: 'Overdue', match: isOverdue },
      { id: 'paid', label: 'Paid', match: inv => outstandingOf(inv) <= 0 },
    ],
    filters: [
      { id: 'status', label: 'Status', value: inv => inv.status, order: INVOICE_STATUSES },
      { id: 'client', label: 'Client', value: clientOf },
    ],
    sorts: {
      invoice: { value: inv => inv.invoiceNumber, firstDir: 'desc' },
      client: { value: clientOf },
      date: { value: inv => (inv.invoiceDate ? new Date(inv.invoiceDate).getTime() : null), firstDir: 'desc' },
      due: { value: inv => (inv.dueDate ? new Date(inv.dueDate).getTime() : null) },
      amount: { value: inv => inv.amount, firstDir: 'desc' },
      outstanding: { value: outstandingOf, firstDir: 'desc' },
      status: { value: inv => INVOICE_STATUSES.indexOf(inv.status as InvoiceStatus) },
    },
    defaultSort: { id: 'invoice', dir: 'desc' },
  })

  const columns: Column<Invoice>[] = [
    {
      id: 'invoice', header: 'Invoice', sticky: true, className: 'min-w-[230px] max-w-[300px]',
      cell: inv => (
        <div className="flex min-w-0 items-center gap-2">
          <svg className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform ${expandedId === inv.id ? 'rotate-90' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M7.2 14.8a1 1 0 010-1.4l3.4-3.4-3.4-3.4a1 1 0 011.4-1.4l4.1 4.1a1 1 0 010 1.4l-4.1 4.1a1 1 0 01-1.4 0z" clipRule="evenodd" />
          </svg>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{inv.invoiceNumber}</p>
            <p className="truncate text-xs text-gray-500 dark:text-gray-400">{inv.project?.workOrderNo} · {inv.project?.projectName}</p>
          </div>
        </div>
      ),
    },
    { id: 'client', header: 'Client', className: 'max-w-[180px]', cell: inv => <span className="block truncate text-gray-700 dark:text-gray-200">{clientOf(inv) ?? plantOf(inv) ?? '—'}</span> },
    { id: 'date', header: 'Invoice date', cell: inv => (inv.invoiceDate ? <span className="whitespace-nowrap text-gray-600 dark:text-gray-300" title={formatRelative(inv.invoiceDate)}>{formatDate(inv.invoiceDate)}</span> : <span className="text-gray-300 dark:text-gray-600">—</span>) },
    { id: 'due', header: 'Due', cell: inv => <DueDate ts={inv.dueDate} done={outstandingOf(inv) <= 0} /> },
    { id: 'amount', header: 'Amount', align: 'right', cell: inv => <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{fmtMoney(inv.amount)}</span> },
    {
      id: 'outstanding', header: 'Outstanding', align: 'right',
      cell: inv => outstandingOf(inv) > 0
        ? <span className="font-semibold text-rose-600 dark:text-rose-400">{fmtMoney(outstandingOf(inv))}</span>
        : <span className="text-emerald-600 dark:text-emerald-400">Paid in full</span>,
    },
    {
      id: 'status', header: 'Status',
      cell: inv => <MenuSelect variant="pill" label={`Status of ${inv.invoiceNumber}`} value={inv.status} options={INVOICE_STATUSES.map(s => ({ value: s, label: s }))} toneOf={statusStyle} onChange={v => changeStatus(inv.id, v as InvoiceStatus)} />,
    },
  ]

  // The payments panel under an opened invoice: log one, see and void them.
  const renderPayments = (inv: Invoice) => (
    <div className="max-w-3xl">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        <span>Invoiced <strong className="font-semibold tabular-nums text-gray-800 dark:text-gray-100">{fmtMoney(inv.amount)}</strong></span>
        <span>Received <strong className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{fmtMoney(paidOf(inv))}</strong></span>
        <span>Outstanding <strong className={`font-semibold tabular-nums ${outstandingOf(inv) > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-gray-800 dark:text-gray-100'}`}>{fmtMoney(outstandingOf(inv))}</strong></span>
      </div>

      <form onSubmit={e => logPayment(e, inv.id)} onClick={e => e.stopPropagation()} className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input type="number" value={paymentForm.amountReceived} onChange={e => setPaymentForm({ ...paymentForm, amountReceived: e.target.value })} placeholder="Amount received (₹)" aria-label="Amount received" className={inputCls} />
        <input type="date" value={paymentForm.paymentDate} onChange={e => setPaymentForm({ ...paymentForm, paymentDate: e.target.value })} aria-label="Payment date" className={inputCls} />
        <input value={paymentForm.notes} onChange={e => setPaymentForm({ ...paymentForm, notes: e.target.value })} placeholder="Notes" aria-label="Notes" className={inputCls} />
        <button disabled={payingId === inv.id} className="rounded-xl bg-gradient-to-r from-rose-400 to-orange-400 px-4 py-2 text-xs font-semibold text-white transition hover:from-rose-500 hover:to-orange-500 disabled:opacity-60">
          {payingId === inv.id ? 'Saving…' : 'Log payment'}
        </button>
      </form>
      {payError && <p className="mb-2 text-xs text-red-500 dark:text-red-400">{payError}</p>}

      {inv.payments.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500">No payments recorded yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
          {inv.payments.map(p => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-3.5 py-2 text-xs">
              <span className="min-w-0">
                <span className="font-semibold tabular-nums text-gray-800 dark:text-gray-100">{fmtMoney(p.amountReceived)}</span>
                <span className="text-gray-500 dark:text-gray-400"> · {formatDate(p.paymentDate)}{p.notes ? ` — ${p.notes}` : ''}</span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="text-gray-400 dark:text-gray-500">{p.recordedByUser ? (p.recordedByUser.userName || p.recordedByUser.email) : ''}</span>
                {isAdmin && (
                  <button type="button" onClick={e => { e.stopPropagation(); voidPayment(inv.id, p.id) }} disabled={voidingId === p.id} className="font-medium text-rose-500 hover:text-rose-700 disabled:opacity-50 dark:text-rose-400 dark:hover:text-rose-300">
                    {voidingId === p.id ? 'Voiding…' : 'Void'}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      <div className="mb-5">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Invoices</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Bill a project and track payments received against it.</p>
      </div>

      {/* create form */}
      <form onSubmit={createInvoice} className="mb-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h3 className="mb-3 text-sm font-bold text-gray-900 dark:text-gray-100">New invoice</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400 sm:col-span-2">
            Project *
            <select value={form.projectId} onChange={e => setForm({ ...form, projectId: e.target.value })} className={inputCls}>
              <option value="">Select a project…</option>
              {projects.map(p => <option key={p.id} value={p.id}>{projectLabel(p)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            Amount (₹) *
            <input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="e.g. 500000" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            Invoice date
            <input type="date" value={form.invoiceDate} onChange={e => setForm({ ...form, invoiceDate: e.target.value })} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            Due date
            <input type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} className={inputCls} />
          </label>
        </div>
        {formError && <p className="mt-2 text-xs text-red-500 dark:text-red-400">{formError}</p>}
        <div className="mt-3">
          <button type="submit" disabled={creating} className="rounded-xl bg-gradient-to-r from-rose-400 to-orange-400 px-5 py-2 text-sm font-semibold text-white transition hover:from-rose-500 hover:to-orange-500 disabled:opacity-60">
            {creating ? 'Saving…' : 'Add Invoice'}
          </button>
        </div>
      </form>

      {/* list */}
      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <TableToolbar view={view} noun="invoices" placeholder="Search invoice, work order, client…">
          <RefreshButton onClick={load} busy={loading} />
        </TableToolbar>

        {error && <ErrorBanner message={error} onRetry={load} />}

        {loading && invoices.length === 0 ? (
          <SkeletonRows />
        ) : invoices.length === 0 && !error ? (
          <EmptyState icon="receipt" title="No invoices yet" message="Bill a project, then log payments against it as they come in." action={{ label: 'Create invoice', onClick: focusCreateForm }} />
        ) : (
          <>
            <DataGrid
              columns={columns}
              rows={view.rows}
              getKey={inv => inv.id}
              view={view}
              onRowClick={inv => toggleExpanded(inv.id)}
              rowLabel={inv => `${expandedId === inv.id ? 'Hide' : 'Show'} payments for ${inv.invoiceNumber}`}
              expandedKey={expandedId}
              renderExpanded={renderPayments}
              actions={inv => (
                <RowMenu
                  label={inv.invoiceNumber}
                  actions={[
                    { label: expandedId === inv.id ? 'Hide payments' : 'Payments & log a payment', onSelect: () => toggleExpanded(inv.id) },
                    !!inv.project?.lead?.id && { label: 'Open lead', onSelect: () => setOpenLeadId(inv.project!.lead!.id) },
                  ]}
                />
              )}
              empty={<NoMatches noun="invoices" onClear={view.clearFilters} />}
              minWidth={980}
            />
            <TableFooter view={view} />
          </>
        )}
      </div>

      {openLeadId && <LeadDetailById leadId={openLeadId} onClose={() => setOpenLeadId(null)} />}
      {confirmDialog}
    </div>
  )
}

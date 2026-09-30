import { useEffect, useState } from 'react'
import { api, INVOICE_SYNC_EVENT, INVOICE_STATUSES } from '../lib/api'
import type { Invoice, InvoiceStatus, Project } from '../lib/api'
import { ErrorBanner } from '../components/ErrorBanner'
import { INVOICE_STATUS_STYLES, DEFAULT_STATUS_STYLE } from '../lib/statusStyles'
import { formatINR } from '../lib/format'
import { EmptyState } from '../components/EmptyState'
import { focusCreateForm } from '../lib/focusCreateForm'
import { SkeletonRows } from '../components/Skeleton'

const statusStyle = (name: string) => INVOICE_STATUS_STYLES[name] ?? DEFAULT_STATUS_STYLE
const fmtDate = (ts: string | null) => (ts ? new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—')
const fmtMoney = formatINR
const paidOf = (inv: Invoice) => inv.payments.reduce((sum, p) => sum + p.amountReceived, 0)

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

  async function voidPayment(invoiceId: string, paymentId: string) {
    if (!confirm('Void this payment? It will stop counting toward what\'s been paid — record a corrected one afterward if needed.')) return
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

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
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
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3 dark:border-gray-800">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Invoices {invoices.length > 0 && <span className="text-gray-400 dark:text-gray-400">({invoices.length})</span>}</h3>
          <button onClick={load} className="text-xs font-medium text-orange-500 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-300">Refresh</button>
        </div>

        {error && <ErrorBanner message={error} onRetry={load} />}

        {loading ? (
          <SkeletonRows />
        ) : invoices.length === 0 && !error ? (
          <EmptyState icon="receipt" title="No invoices yet" message="Bill a project, then log payments against it as they come in." action={{ label: 'Create invoice', onClick: focusCreateForm }} />
        ) : (
          <ul className="divide-y divide-gray-50 dark:divide-gray-800/60">
            {invoices.map(inv => {
              const paid = paidOf(inv)
              const outstanding = inv.amount - paid
              return (
                <li key={inv.id}>
                  <div onClick={() => toggleExpanded(inv.id)} className="flex cursor-pointer items-center justify-between gap-3 px-5 py-3 hover:bg-gray-50/60 dark:hover:bg-gray-800/60">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 dark:text-gray-100">{inv.invoiceNumber}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{inv.project?.workOrderNo} · {inv.project?.projectName}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-4">
                      <div className="text-right text-xs">
                        <p className="font-semibold text-gray-900 dark:text-gray-100">{fmtMoney(inv.amount)}</p>
                        <p className={outstanding > 0 ? 'text-rose-500 dark:text-rose-400' : 'text-emerald-500 dark:text-emerald-400'}>
                          {outstanding > 0 ? `${fmtMoney(outstanding)} due` : 'Fully paid'}
                        </p>
                      </div>
                      <select
                        value={inv.status}
                        onClick={e => e.stopPropagation()}
                        onChange={e => changeStatus(inv.id, e.target.value as InvoiceStatus)}
                        className={`rounded-lg border px-2 py-1 text-xs font-semibold outline-none focus:ring-2 focus:ring-orange-300 ${statusStyle(inv.status)}`}
                      >
                        {INVOICE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>

                  {expandedId === inv.id && (
                    <div className="border-t border-gray-50 bg-gray-50/60 px-5 py-4 dark:border-gray-800/60 dark:bg-gray-800/30">
                      <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
                        {fmtDate(inv.invoiceDate)} → due {fmtDate(inv.dueDate)}
                      </p>

                      <form onSubmit={e => logPayment(e, inv.id)} className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <input type="number" value={paymentForm.amountReceived} onChange={e => setPaymentForm({ ...paymentForm, amountReceived: e.target.value })} placeholder="Amount received (₹)" className={inputCls} />
                        <input type="date" value={paymentForm.paymentDate} onChange={e => setPaymentForm({ ...paymentForm, paymentDate: e.target.value })} className={inputCls} />
                        <input value={paymentForm.notes} onChange={e => setPaymentForm({ ...paymentForm, notes: e.target.value })} placeholder="Notes" className={`${inputCls} sm:col-span-1`} />
                        <button disabled={payingId === inv.id} className="rounded-xl bg-gradient-to-r from-rose-400 to-orange-400 px-4 py-2 text-xs font-semibold text-white transition hover:from-rose-500 hover:to-orange-500 disabled:opacity-60">
                          {payingId === inv.id ? 'Saving…' : 'Log payment'}
                        </button>
                      </form>
                      {payError && <p className="mb-2 text-xs text-red-500 dark:text-red-400">{payError}</p>}

                      {inv.payments.length === 0 ? (
                        <p className="text-xs text-gray-400 dark:text-gray-400">No payments recorded yet.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {inv.payments.map(p => (
                            <li key={p.id} className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-gray-400">
                              <span>{fmtMoney(p.amountReceived)} on {fmtDate(p.paymentDate)}{p.notes ? ` — ${p.notes}` : ''}</span>
                              <span className="flex shrink-0 items-center gap-2">
                                <span className="text-gray-400 dark:text-gray-400">{p.recordedByUser ? (p.recordedByUser.userName || p.recordedByUser.email) : ''}</span>
                                {isAdmin && (
                                  <button
                                    type="button"
                                    onClick={() => voidPayment(inv.id, p.id)}
                                    disabled={voidingId === p.id}
                                    className="font-medium text-red-400 hover:text-red-600 disabled:opacity-50 dark:text-red-500 dark:hover:text-red-400"
                                  >
                                    {voidingId === p.id ? 'Voiding…' : 'Void'}
                                  </button>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

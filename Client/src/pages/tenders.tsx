import { useEffect, useState } from 'react'
import { api, TENDER_STATUSES } from '../lib/api'
import type { Tender, TenderStatus, Client } from '../lib/api'

const STATUS_STYLES: Record<string, string> = {
  Identified: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
  Preparing: 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-900/40 dark:text-sky-300 dark:border-sky-800',
  Submitted: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800',
  'Under Evaluation': 'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/40 dark:text-violet-300 dark:border-violet-800',
  Won: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800',
  Lost: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/40 dark:text-rose-300 dark:border-rose-800',
}
const statusStyle = (name: string) => STATUS_STYLES[name] ?? 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'
const fmtDate = (ts: string | null) => (ts ? new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—')
const fmtValue = (v: number | null) => (v == null ? '—' : `₹${v.toLocaleString()}`)

const inputCls = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'
const emptyForm = { tenderNo: '', clientId: '', submissionDate: '', value: '' }

export default function Tenders() {
  const [tenders, setTenders] = useState<Tender[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({ ...emptyForm })
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  function load() {
    setLoading(true)
    api<{ tenders: Tender[] }>('/tenders', { auth: true })
      .then(({ tenders }) => { setTenders(tenders); setError(null) })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load tenders.'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    api<{ clients: Client[] }>('/clients', { auth: true }).then(({ clients }) => setClients(clients)).catch(() => {})
  }, [])

  async function createTender(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!form.tenderNo.trim()) { setFormError('Tender number is required.'); return }
    if (!form.clientId) { setFormError('Client is required.'); return }
    setCreating(true)
    try {
      const { tender } = await api<{ tender: Tender }>('/tenders', {
        method: 'POST',
        auth: true,
        body: {
          tenderNo: form.tenderNo.trim(),
          clientId: form.clientId,
          submissionDate: form.submissionDate || undefined,
          value: form.value ? Number(form.value) : undefined,
        },
      })
      setTenders(prev => [tender, ...prev])
      setForm({ ...emptyForm })
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not create tender.')
    } finally {
      setCreating(false)
    }
  }

  async function changeStatus(id: string, status: TenderStatus) {
    setSavingId(id)
    try {
      const { tender } = await api<{ tender: Tender }>(`/tenders/${id}`, { method: 'PATCH', auth: true, body: { status } })
      setTenders(prev => prev.map(t => (t.id === id ? tender : t)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update status.')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-5">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Tender Tracking</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Government/EPC tenders raised against a client.</p>
      </div>

      <form onSubmit={createTender} className="mb-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h3 className="mb-3 text-sm font-bold text-gray-900 dark:text-gray-100">New tender</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            Tender No. *
            <input value={form.tenderNo} onChange={e => setForm({ ...form, tenderNo: e.target.value })} placeholder="e.g. NIT/2026/0142" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            Client *
            <select value={form.clientId} onChange={e => setForm({ ...form, clientId: e.target.value })} className={inputCls}>
              <option value="">Select a client…</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.clientName}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            Submission date
            <input type="date" value={form.submissionDate} onChange={e => setForm({ ...form, submissionDate: e.target.value })} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            Value (₹)
            <input type="number" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} placeholder="e.g. 2500000" className={inputCls} />
          </label>
        </div>
        {formError && <p className="mt-2 text-xs text-red-500 dark:text-red-400">{formError}</p>}
        <div className="mt-3">
          <button type="submit" disabled={creating} className="rounded-xl bg-gradient-to-r from-rose-400 to-orange-400 px-5 py-2 text-sm font-semibold text-white transition hover:from-rose-500 hover:to-orange-500 disabled:opacity-60">
            {creating ? 'Saving…' : 'Add Tender'}
          </button>
        </div>
      </form>

      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3 dark:border-gray-800">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Tenders {tenders.length > 0 && <span className="text-gray-400 dark:text-gray-500">({tenders.length})</span>}</h3>
          <button onClick={load} className="text-xs font-medium text-orange-500 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-300">Refresh</button>
        </div>
        {error && <div className="m-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">{error}</div>}
        {loading ? (
          <p className="px-5 py-10 text-center text-sm text-gray-400 dark:text-gray-500">Loading…</p>
        ) : tenders.length === 0 && !error ? (
          <p className="px-5 py-10 text-center text-sm text-gray-400 dark:text-gray-500">No tenders yet. Create one above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs uppercase tracking-wider text-gray-400 dark:border-gray-800 dark:text-gray-500">
                  <th className="px-5 py-3 font-semibold">Tender No.</th>
                  <th className="px-3 py-3 font-semibold">Client</th>
                  <th className="px-3 py-3 font-semibold">Submission date</th>
                  <th className="px-3 py-3 font-semibold">Value</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {tenders.map(t => (
                  <tr key={t.id} className="border-b border-gray-50 dark:border-gray-800">
                    <td className="px-5 py-3 font-semibold text-gray-900 dark:text-gray-100">{t.tenderNo}</td>
                    <td className="px-3 py-3 text-xs text-gray-600 dark:text-gray-400">{t.client?.clientName ?? '—'}</td>
                    <td className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400">{fmtDate(t.submissionDate)}</td>
                    <td className="px-3 py-3 text-sm text-gray-700 dark:text-gray-300">{fmtValue(t.value)}</td>
                    <td className="px-3 py-3">
                      <select
                        value={t.status}
                        disabled={savingId === t.id}
                        onChange={e => changeStatus(t.id, e.target.value as TenderStatus)}
                        className={`rounded-lg border px-2 py-1 text-xs font-semibold outline-none focus:ring-2 focus:ring-orange-300 disabled:opacity-60 ${statusStyle(t.status)}`}
                      >
                        {TENDER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

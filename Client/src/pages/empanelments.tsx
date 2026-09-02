import { useEffect, useState } from 'react'
import { api, EMPANELMENT_STATUSES } from '../lib/api'
import type { Empanelment, EmpanelmentStatus, Client, ServiceType } from '../lib/api'

const STATUS_STYLES: Record<string, string> = {
  Applied: 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-900/40 dark:text-sky-300 dark:border-sky-800',
  'Under Review': 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800',
  Empanelled: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800',
  Rejected: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/40 dark:text-rose-300 dark:border-rose-800',
  Expired: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
}
const statusStyle = (name: string) => STATUS_STYLES[name] ?? 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'
const fmtDate = (ts: string | null) => (ts ? new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—')

const inputCls = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'
const emptyForm = { clientId: '', serviceTypeId: '', renewalDate: '' }

export default function Empanelments() {
  const [empanelments, setEmpanelments] = useState<Empanelment[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({ ...emptyForm })
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  function load() {
    setLoading(true)
    api<{ empanelments: Empanelment[] }>('/empanelments', { auth: true })
      .then(({ empanelments }) => { setEmpanelments(empanelments); setError(null) })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load empanelments.'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    api<{ clients: Client[] }>('/clients', { auth: true }).then(({ clients }) => setClients(clients)).catch(() => {})
    api<{ serviceTypes: ServiceType[] }>('/service-types', { auth: true }).then(({ serviceTypes }) => setServiceTypes(serviceTypes)).catch(() => {})
  }, [])

  async function createEmpanelment(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!form.clientId) { setFormError('Client is required.'); return }
    setCreating(true)
    try {
      const { empanelment } = await api<{ empanelment: Empanelment }>('/empanelments', {
        method: 'POST',
        auth: true,
        body: { clientId: form.clientId, serviceTypeId: form.serviceTypeId || undefined, renewalDate: form.renewalDate || undefined },
      })
      setEmpanelments(prev => [empanelment, ...prev])
      setForm({ ...emptyForm })
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not create empanelment.')
    } finally {
      setCreating(false)
    }
  }

  async function changeStatus(id: string, status: EmpanelmentStatus) {
    setSavingId(id)
    try {
      const { empanelment } = await api<{ empanelment: Empanelment }>(`/empanelments/${id}`, { method: 'PATCH', auth: true, body: { status } })
      setEmpanelments(prev => prev.map(e => (e.id === id ? empanelment : e)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update status.')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-5">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Empanelment Tracking</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Approved-vendor status per client and service category.</p>
      </div>

      <form onSubmit={createEmpanelment} className="mb-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h3 className="mb-3 text-sm font-bold text-gray-900 dark:text-gray-100">New empanelment</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            Client *
            <select value={form.clientId} onChange={e => setForm({ ...form, clientId: e.target.value })} className={inputCls}>
              <option value="">Select a client…</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.clientName}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            Service category
            <select value={form.serviceTypeId} onChange={e => setForm({ ...form, serviceTypeId: e.target.value })} className={inputCls}>
              <option value="">Select…</option>
              {serviceTypes.map(s => <option key={s.id} value={s.id}>{s.serviceTypeName}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            Renewal date
            <input type="date" value={form.renewalDate} onChange={e => setForm({ ...form, renewalDate: e.target.value })} className={inputCls} />
          </label>
        </div>
        {formError && <p className="mt-2 text-xs text-red-500 dark:text-red-400">{formError}</p>}
        <div className="mt-3">
          <button type="submit" disabled={creating} className="rounded-xl bg-gradient-to-r from-rose-400 to-orange-400 px-5 py-2 text-sm font-semibold text-white transition hover:from-rose-500 hover:to-orange-500 disabled:opacity-60">
            {creating ? 'Saving…' : 'Add Empanelment'}
          </button>
        </div>
      </form>

      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3 dark:border-gray-800">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Empanelments {empanelments.length > 0 && <span className="text-gray-400 dark:text-gray-500">({empanelments.length})</span>}</h3>
          <button onClick={load} className="text-xs font-medium text-orange-500 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-300">Refresh</button>
        </div>
        {error && <div className="m-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">{error}</div>}
        {loading ? (
          <p className="px-5 py-10 text-center text-sm text-gray-400 dark:text-gray-500">Loading…</p>
        ) : empanelments.length === 0 && !error ? (
          <p className="px-5 py-10 text-center text-sm text-gray-400 dark:text-gray-500">No empanelments yet. Create one above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs uppercase tracking-wider text-gray-400 dark:border-gray-800 dark:text-gray-500">
                  <th className="px-5 py-3 font-semibold">Client</th>
                  <th className="px-3 py-3 font-semibold">Category</th>
                  <th className="px-3 py-3 font-semibold">Renewal date</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {empanelments.map(e => (
                  <tr key={e.id} className="border-b border-gray-50 dark:border-gray-800">
                    <td className="px-5 py-3 font-semibold text-gray-900 dark:text-gray-100">{e.client?.clientName ?? '—'}</td>
                    <td className="px-3 py-3 text-xs text-gray-600 dark:text-gray-400">{e.serviceType?.serviceTypeName ?? '—'}</td>
                    <td className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400">{fmtDate(e.renewalDate)}</td>
                    <td className="px-3 py-3">
                      <select
                        value={e.status}
                        disabled={savingId === e.id}
                        onChange={ev => changeStatus(e.id, ev.target.value as EmpanelmentStatus)}
                        className={`rounded-lg border px-2 py-1 text-xs font-semibold outline-none focus:ring-2 focus:ring-orange-300 disabled:opacity-60 ${statusStyle(e.status)}`}
                      >
                        {EMPANELMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
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

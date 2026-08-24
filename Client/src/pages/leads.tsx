import { useEffect, useState } from 'react'
import { api, LEAD_SYNC_EVENT } from '../lib/api'
import type { Lead, EmployeeUser } from '../lib/api'
import LeadDetailModal from '../components/LeadDetailModal'

// Fixed status options.
const STATUSES = ['Submitted', 'In Process', 'Dead'] as const

const STATUS_STYLES: Record<string, string> = {
  Submitted: 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-900/40 dark:text-sky-300 dark:border-sky-800',
  'In Process': 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800',
  Dead: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/40 dark:text-rose-300 dark:border-rose-800',
}
const statusStyle = (name: string | null | undefined) => STATUS_STYLES[name ?? ''] ?? 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'
const fmt = (ts: string) => new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const inputCls = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'
const emptyForm = { plantName: '', city: '', contactName: '', contactEmail: '', contactNumber: '', verticalName: '', sectorName: '', assignedToName: '', remark: '', statusName: 'Submitted' }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function Leads({ isAdmin = false }: { isAdmin?: boolean }) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [employees, setEmployees] = useState<EmployeeUser[]>([])

  const [form, setForm] = useState({ ...emptyForm })
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)

  async function load() {
    setLoading(true)
    try {
      const { leads } = await api<{ leads: Lead[] }>('/leads', { auth: true })
      setLeads(leads)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load leads.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  // Live updates — any lead created/updated/deleted by anyone (not just leads
  // assigned to us) pings every connected client over SSE (see NotificationBell).
  // Re-fetch just that one lead and upsert it into the list — or drop it if it's
  // gone (deleted, or no longer visible) — so the list stays live for every
  // viewer without anyone having to refresh the page.
  useEffect(() => {
    function onLeadSync(e: Event) {
      const leadId = (e as CustomEvent<{ leadId: string }>).detail?.leadId
      if (!leadId) return
      api<{ lead: Lead }>(`/leads/${leadId}`, { auth: true })
        .then(({ lead }) => {
          setLeads(prev => (prev.some(l => l.id === lead.id) ? prev.map(l => (l.id === lead.id ? lead : l)) : [lead, ...prev]))
          setSelectedLead(prev => (prev && prev.id === lead.id ? lead : prev))
        })
        .catch(() => {
          setLeads(prev => prev.filter(l => l.id !== leadId))
          setSelectedLead(prev => (prev && prev.id === leadId ? null : prev))
        })
    }
    window.addEventListener(LEAD_SYNC_EVENT, onLeadSync)
    return () => window.removeEventListener(LEAD_SYNC_EVENT, onLeadSync)
  }, [])

  // Employees, for the assignment dropdown — keyed by email so two people who
  // happen to share a name can never be confused with each other. Admins are
  // excluded: leads are worked by employees, not assigned to admin accounts.
  useEffect(() => {
    api<{ users: EmployeeUser[] }>('/users', { auth: true })
      .then(({ users }) => setEmployees(users.filter(u => u.role !== 'admin')))
      .catch(() => {})
  }, [])
  const employeeLabel = (u: EmployeeUser) => `${u.userName || u.email} — ${u.email}`

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }))

  async function createLead(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!form.plantName.trim()) { setFormError('Plant is required.'); return }
    if (form.contactEmail.trim() && !EMAIL_RE.test(form.contactEmail.trim())) {
      setFormError('Contact email must look like username@gmail.com.')
      return
    }
    setCreating(true)
    try {
      const { lead } = await api<{ lead: Lead }>('/leads', { method: 'POST', auth: true, body: form })
      setLeads(prev => [lead, ...prev])
      setForm({ ...emptyForm })
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not create lead.')
    } finally {
      setCreating(false)
    }
  }

  async function changeStatus(id: string, statusName: string) {
    setSavingId(id)
    try {
      const { lead } = await api<{ lead: Lead }>(`/leads/${id}`, { method: 'PATCH', auth: true, body: { statusName } })
      setLeads(prev => prev.map(l => (l.id === id ? lead : l)))
      setSelectedLead(prev => (prev && prev.id === id ? lead : prev))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update status.')
    } finally {
      setSavingId(null)
    }
  }

  async function reassign(id: string, assignedToUserId: string) {
    setSavingId(id)
    try {
      const { lead } = await api<{ lead: Lead }>(`/leads/${id}`, { method: 'PATCH', auth: true, body: { assignedToUserId: assignedToUserId || null } })
      setLeads(prev => prev.map(l => (l.id === id ? lead : l)))
      setSelectedLead(prev => (prev && prev.id === id ? lead : prev))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reassign lead.')
    } finally {
      setSavingId(null)
    }
  }

  async function removeLead(id: string) {
    setSavingId(id)
    try {
      await api(`/leads/${id}`, { method: 'DELETE', auth: true })
      setLeads(prev => prev.filter(l => l.id !== id))
      setSelectedLead(prev => (prev && prev.id === id ? null : prev))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete lead.')
    } finally {
      setSavingId(null)
    }
  }

  const field = (label: string, key: keyof typeof form, placeholder: string, span = '', type = 'text') => (
    <label className={`flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400 ${span}`}>
      {label}
      <input type={type} value={form[key]} onChange={set(key)} placeholder={placeholder} className={inputCls} />
    </label>
  )

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-5">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Leads</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Type in the lead details — matching plants, contacts, verticals and sectors are reused or created automatically. Available to all team members.</p>
      </div>

      {/* create form */}
      <form onSubmit={createLead} className="mb-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h3 className="mb-3 text-sm font-bold text-gray-900 dark:text-gray-100">New lead</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {field('Plant *', 'plantName', 'e.g. Bhilai Steel Plant')}
          {field('City', 'city', 'e.g. Bhilai')}
          {field('Contact', 'contactName', 'Contact person name')}
          {field('Contact email', 'contactEmail', 'e.g. name@gmail.com', '', 'email')}
          {field('Contact phone', 'contactNumber', 'e.g. 98765 43210', '', 'tel')}
          {field('Vertical', 'verticalName', 'e.g. AI Automation')}
          {field('Sector', 'sectorName', 'e.g. Steel')}
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            Assign to
            <select value={form.assignedToName} onChange={set('assignedToName')} className={inputCls}>
              <option value="">Unassigned</option>
              {employees.map(u => <option key={u.id} value={u.email}>{employeeLabel(u)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            Status
            <select value={form.statusName} onChange={set('statusName')} className={inputCls}>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          {field('Remark', 'remark', 'Optional note', 'sm:col-span-2 lg:col-span-2')}
        </div>
        {formError && <p className="mt-2 text-xs text-red-500 dark:text-red-400">{formError}</p>}
        <div className="mt-3">
          <button type="submit" disabled={creating} className="rounded-xl bg-gradient-to-r from-rose-400 to-orange-400 px-5 py-2 text-sm font-semibold text-white transition hover:from-rose-500 hover:to-orange-500 disabled:opacity-60">
            {creating ? 'Saving…' : 'Add Lead'}
          </button>
        </div>
      </form>

      {/* list */}
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3 dark:border-gray-800">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Leads {leads.length > 0 && <span className="text-gray-400 dark:text-gray-500">({leads.length})</span>}</h3>
          <button onClick={load} className="text-xs font-medium text-orange-500 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-300">Refresh</button>
        </div>

        {error && <div className="m-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">{error}</div>}

        {loading ? (
          <p className="px-5 py-10 text-center text-sm text-gray-400 dark:text-gray-500">Loading…</p>
        ) : leads.length === 0 && !error ? (
          <p className="px-5 py-10 text-center text-sm text-gray-400 dark:text-gray-500">No leads yet. Create one above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs uppercase tracking-wider text-gray-400 dark:border-gray-800 dark:text-gray-500">
                  <th className="px-5 py-3 font-semibold">Plant / Contact</th>
                  <th className="px-3 py-3 font-semibold">Vertical / Sector</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                  <th className="px-3 py-3 font-semibold">Assigned to</th>
                  <th className="px-3 py-3 font-semibold">Assigned by</th>
                  <th className="px-3 py-3 font-semibold">Updated</th>
                  {isAdmin && <th className="px-3 py-3 font-semibold"></th>}
                </tr>
              </thead>
              <tbody>
                {leads.map(lead => (
                  <tr
                    key={lead.id}
                    onClick={() => setSelectedLead(lead)}
                    className="cursor-pointer border-b border-gray-50 hover:bg-gray-50/60 dark:border-gray-800 dark:hover:bg-gray-800/60"
                  >
                    <td className="px-5 py-3">
                      <p className="font-semibold text-gray-900 dark:text-gray-100">{lead.plant?.plantName ?? '—'}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{lead.contact?.contactPersonName ?? 'No contact'}{lead.plant?.location ? ` · ${lead.plant.location.city}` : ''}</p>
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-600 dark:text-gray-400">
                      <p>{lead.vertical?.verticalName ?? '—'}</p>
                      <p className="text-gray-400 dark:text-gray-500">{lead.sector?.sectorName ?? '—'}</p>
                    </td>
                    <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                      <select
                        value={lead.status?.statusName ?? 'Submitted'}
                        disabled={savingId === lead.id}
                        onChange={e => changeStatus(lead.id, e.target.value)}
                        className={`rounded-lg border px-2 py-1 text-xs font-semibold outline-none focus:ring-2 focus:ring-orange-300 disabled:opacity-60 ${statusStyle(lead.status?.statusName)}`}
                      >
                        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-600 dark:text-gray-400" onClick={e => e.stopPropagation()}>
                      <select
                        value={lead.assignedToUserId ?? ''}
                        disabled={savingId === lead.id}
                        onChange={e => reassign(lead.id, e.target.value)}
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-orange-300 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                      >
                        <option value="">Unassigned</option>
                        {employees.map(u => <option key={u.id} value={u.id}>{u.userName || u.email}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-600 dark:text-gray-400">{lead.assignedByUser ? (lead.assignedByUser.userName || lead.assignedByUser.email) : '—'}</td>
                    <td className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400">{fmt(lead.updatedAt)}</td>
                    {isAdmin && (
                      <td className="px-3 py-3 text-right" onClick={e => e.stopPropagation()}>
                        <button onClick={() => removeLead(lead.id)} disabled={savingId === lead.id} className="text-xs font-medium text-red-400 hover:text-red-600 disabled:opacity-50 dark:text-red-500 dark:hover:text-red-400">Delete</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* detail modal */}
      {selectedLead && <LeadDetailModal lead={selectedLead} onClose={() => setSelectedLead(null)} />}
    </div>
  )
}

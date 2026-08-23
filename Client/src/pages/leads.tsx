import { useEffect, useState } from 'react'
import { api, LEAD_SYNC_EVENT } from '../lib/api'
import type { Lead, EmployeeUser } from '../lib/api'

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
const emptyForm = { plantName: '', city: '', contactName: '', contactEmail: '', verticalName: '', sectorName: '', assignedToName: '', remark: '', statusName: 'Submitted' }
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
  // happen to share a name can never be confused with each other.
  useEffect(() => {
    api<{ users: EmployeeUser[] }>('/users', { auth: true })
      .then(({ users }) => setEmployees(users))
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
      {selectedLead && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
          onClick={() => setSelectedLead(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-gray-100 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900"
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
              <div>
                <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{selectedLead.plant?.plantName ?? 'Lead details'}</h3>
                <span className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusStyle(selectedLead.status?.statusName)}`}>
                  {selectedLead.status?.statusName ?? 'Submitted'}
                </span>
              </div>
              <button
                onClick={() => setSelectedLead(null)}
                className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 text-base leading-none"
                aria-label="Close"
              >✕</button>
            </div>

            <div className="overflow-y-auto px-5 py-4">
              <DetailSection title="Plant">
                <DetailRow label="Name" value={selectedLead.plant?.plantName} />
                <DetailRow label="Company" value={selectedLead.plant?.companyName} />
                <DetailRow label="Plant code" value={selectedLead.plant?.plantCode} />
                <DetailRow label="City" value={selectedLead.plant?.location?.city} />
                <DetailRow label="State" value={selectedLead.plant?.location?.state} />
                <DetailRow label="Country" value={selectedLead.plant?.location?.country} />
                <DetailRow label="Address" value={selectedLead.plant?.location?.address} />
              </DetailSection>

              <DetailSection title="Contact person">
                <DetailRow label="Name" value={selectedLead.contact?.contactPersonName} />
                <DetailRow label="Designation" value={selectedLead.contact?.designation} />
                <DetailRow label="Email" value={selectedLead.contact?.mailId} isEmail />
                <DetailRow label="Phone" value={selectedLead.contact?.contactPersonNumber} />
                <DetailRow label="Alternate phone" value={selectedLead.contact?.alternateNumber} />
                <DetailRow label="Primary contact" value={selectedLead.contact ? (selectedLead.contact.isPrimaryContact ? 'Yes' : 'No') : undefined} />
              </DetailSection>

              <DetailSection title="Classification">
                <DetailRow label="Vertical" value={selectedLead.vertical?.verticalName} />
                <DetailRow label="Sector" value={selectedLead.sector?.sectorName} />
              </DetailSection>

              <DetailSection title="Ownership">
                <DetailRow label="Assigned to" value={selectedLead.assignedToUser ? (selectedLead.assignedToUser.userName || selectedLead.assignedToUser.email) : undefined} />
                <DetailRow label="Assigned by" value={selectedLead.assignedByUser ? (selectedLead.assignedByUser.userName || selectedLead.assignedByUser.email) : undefined} />
                <DetailRow label="Created by" value={selectedLead.createdByUser ? (selectedLead.createdByUser.userName || selectedLead.createdByUser.email) : undefined} />
              </DetailSection>

              <DetailSection title="Notes & timeline" last>
                <DetailRow label="Remark" value={selectedLead.remark} />
                <DetailRow label="Created" value={fmt(selectedLead.createdAt)} />
                <DetailRow label="Updated" value={fmt(selectedLead.updatedAt)} />
              </DetailSection>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DetailSection({ title, children, last = false }: { title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`${last ? '' : 'mb-4 border-b border-gray-50 pb-4 dark:border-gray-800/60'}`}>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function DetailRow({ label, value, isEmail = false }: { label: string; value?: string | null; isEmail?: boolean }) {
  if (!value) return null
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="shrink-0 text-gray-500 dark:text-gray-400">{label}</span>
      {isEmail ? (
        <a href={`mailto:${value}`} className="truncate text-right font-medium text-orange-500 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-300">{value}</a>
      ) : (
        <span className="truncate text-right font-medium text-gray-900 dark:text-gray-100">{value}</span>
      )}
    </div>
  )
}

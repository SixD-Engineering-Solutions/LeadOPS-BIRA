import { useEffect, useState } from 'react'
import { api, PROJECT_SYNC_EVENT, INVOICE_SYNC_EVENT, PROJECT_STATUSES, BILLING_STAGES } from '../lib/api'
import type { Project, ProjectStatus, BillingStage, Lead, Location, EmployeeUser, Invoice } from '../lib/api'

const STATUS_STYLES: Record<string, string> = {
  'Not Started': 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
  'In Progress': 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800',
  'On Hold': 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-800',
  Completed: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800',
}
const statusStyle = (name: string) => STATUS_STYLES[name] ?? 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'
const fmtDate = (ts: string | null) => (ts ? new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—')

const inputCls = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'
const emptyForm = { leadId: '', projectName: '', locationId: '', startDate: '', completionDate: '', responsibleUserId: '' }

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [employees, setEmployees] = useState<EmployeeUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({ ...emptyForm })
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  function load() {
    setLoading(true)
    api<{ projects: Project[] }>('/projects', { auth: true })
      .then(({ projects }) => { setProjects(projects); setError(null) })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load projects.'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    api<{ leads: Lead[] }>('/leads', { auth: true }).then(({ leads }) => setLeads(leads)).catch(() => {})
    api<{ locations: Location[] }>('/locations', { auth: true }).then(({ locations }) => setLocations(locations)).catch(() => {})
    api<{ users: EmployeeUser[] }>('/users', { auth: true }).then(({ users }) => setEmployees(users.filter(u => u.role !== 'admin'))).catch(() => {})
  }, [])

  // Live updates — a project created/updated by anyone (including the
  // auto-create when a proposal is marked Won) resyncs this list.
  useEffect(() => {
    function onProjectSync() { load() }
    window.addEventListener(PROJECT_SYNC_EVENT, onProjectSync)
    return () => window.removeEventListener(PROJECT_SYNC_EVENT, onProjectSync)
  }, [])

  // Invoices, just for the per-project billing summary column below.
  const [invoices, setInvoices] = useState<Invoice[]>([])
  function loadInvoices() {
    api<{ invoices: Invoice[] }>('/invoices', { auth: true }).then(({ invoices }) => setInvoices(invoices)).catch(() => {})
  }
  useEffect(() => { loadInvoices() }, [])
  useEffect(() => {
    function onInvoiceSync() { loadInvoices() }
    window.addEventListener(INVOICE_SYNC_EVENT, onInvoiceSync)
    return () => window.removeEventListener(INVOICE_SYNC_EVENT, onInvoiceSync)
  }, [])
  function billingSummary(projectId: string): { label: string; overdue: boolean } {
    const projectInvoices = invoices.filter(i => i.projectId === projectId)
    if (projectInvoices.length === 0) return { label: 'No invoices', overdue: false }
    const outstanding = projectInvoices.reduce((sum, i) => sum + (i.amount - i.payments.reduce((s, p) => s + p.amountReceived, 0)), 0)
    if (outstanding <= 0) return { label: 'Fully paid', overdue: false }
    return { label: `₹${outstanding.toLocaleString()} due`, overdue: true }
  }

  const leadLabel = (l: Lead) => `${l.plant?.plantName ?? 'Unnamed plant'}${l.plant?.client?.clientName ? ` — ${l.plant.client.clientName}` : ''}`

  async function createProject(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!form.leadId) { setFormError('Lead is required.'); return }
    if (!form.projectName.trim()) { setFormError('Project name is required.'); return }
    setCreating(true)
    try {
      const { project } = await api<{ project: Project }>('/projects', {
        method: 'POST',
        auth: true,
        body: {
          leadId: form.leadId,
          projectName: form.projectName.trim(),
          locationId: form.locationId || undefined,
          startDate: form.startDate || undefined,
          completionDate: form.completionDate || undefined,
          responsibleUserId: form.responsibleUserId || undefined,
        },
      })
      setProjects(prev => [project, ...prev])
      setForm({ ...emptyForm })
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not create project.')
    } finally {
      setCreating(false)
    }
  }

  async function patchProject(id: string, body: object) {
    setSavingId(id)
    try {
      const { project } = await api<{ project: Project }>(`/projects/${id}`, { method: 'PATCH', auth: true, body })
      setProjects(prev => prev.map(p => (p.id === id ? project : p)))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update project.')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-5">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Projects</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Work orders raised directly, or auto-created when a proposal is marked Won.</p>
      </div>

      {/* create form */}
      <form onSubmit={createProject} className="mb-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h3 className="mb-3 text-sm font-bold text-gray-900 dark:text-gray-100">New project</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            Lead *
            <select value={form.leadId} onChange={e => setForm({ ...form, leadId: e.target.value })} className={inputCls}>
              <option value="">Select a lead…</option>
              {leads.map(l => <option key={l.id} value={l.id}>{leadLabel(l)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            Project name *
            <input value={form.projectName} onChange={e => setForm({ ...form, projectName: e.target.value })} placeholder="e.g. Plant-wide laser scan" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            Location
            <select value={form.locationId} onChange={e => setForm({ ...form, locationId: e.target.value })} className={inputCls}>
              <option value="">Select…</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.city}{l.state ? `, ${l.state}` : ''}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            Responsible engineer
            <select value={form.responsibleUserId} onChange={e => setForm({ ...form, responsibleUserId: e.target.value })} className={inputCls}>
              <option value="">Unassigned</option>
              {employees.map(u => <option key={u.id} value={u.id}>{u.userName || u.email}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            Start date
            <input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            Completion date
            <input type="date" value={form.completionDate} onChange={e => setForm({ ...form, completionDate: e.target.value })} className={inputCls} />
          </label>
        </div>
        {formError && <p className="mt-2 text-xs text-red-500 dark:text-red-400">{formError}</p>}
        <div className="mt-3">
          <button type="submit" disabled={creating} className="rounded-xl bg-gradient-to-r from-rose-400 to-orange-400 px-5 py-2 text-sm font-semibold text-white transition hover:from-rose-500 hover:to-orange-500 disabled:opacity-60">
            {creating ? 'Saving…' : 'Add Project'}
          </button>
        </div>
      </form>

      {/* list */}
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3 dark:border-gray-800">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Projects {projects.length > 0 && <span className="text-gray-400 dark:text-gray-500">({projects.length})</span>}</h3>
          <button onClick={load} className="text-xs font-medium text-orange-500 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-300">Refresh</button>
        </div>

        {error && <div className="m-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">{error}</div>}

        {loading ? (
          <p className="px-5 py-10 text-center text-sm text-gray-400 dark:text-gray-500">Loading…</p>
        ) : projects.length === 0 && !error ? (
          <p className="px-5 py-10 text-center text-sm text-gray-400 dark:text-gray-500">No projects yet. Create one above, or mark a proposal Won.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs uppercase tracking-wider text-gray-400 dark:border-gray-800 dark:text-gray-500">
                  <th className="px-5 py-3 font-semibold">Work Order</th>
                  <th className="px-3 py-3 font-semibold">Lead</th>
                  <th className="px-3 py-3 font-semibold">Engineer</th>
                  <th className="px-3 py-3 font-semibold">Dates</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                  <th className="px-3 py-3 font-semibold">Billing stage</th>
                  <th className="px-3 py-3 font-semibold">Invoicing</th>
                </tr>
              </thead>
              <tbody>
                {projects.map(p => (
                  <tr key={p.id} className="border-b border-gray-50 dark:border-gray-800">
                    <td className="px-5 py-3">
                      <p className="font-semibold text-gray-900 dark:text-gray-100">{p.workOrderNo}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{p.projectName}{p.proposal ? ` · from ${p.proposal.proposalNumber}` : ''}</p>
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-600 dark:text-gray-400">
                      <p>{p.lead?.plant?.plantName ?? '—'}</p>
                      <p className="text-gray-400 dark:text-gray-500">{p.lead?.plant?.client?.clientName ?? ''}</p>
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-600 dark:text-gray-400">{p.responsibleUser ? (p.responsibleUser.userName || p.responsibleUser.email) : 'Unassigned'}</td>
                    <td className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400">{fmtDate(p.startDate)} → {fmtDate(p.completionDate)}</td>
                    <td className="px-3 py-3">
                      <select
                        value={p.status}
                        disabled={savingId === p.id}
                        onChange={e => patchProject(p.id, { status: e.target.value as ProjectStatus })}
                        className={`rounded-lg border px-2 py-1 text-xs font-semibold outline-none focus:ring-2 focus:ring-orange-300 disabled:opacity-60 ${statusStyle(p.status)}`}
                      >
                        {PROJECT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={p.billingStage}
                        disabled={savingId === p.id}
                        onChange={e => patchProject(p.id, { billingStage: e.target.value as BillingStage })}
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-orange-300 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                      >
                        {BILLING_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {(() => {
                        const b = billingSummary(p.id)
                        return <span className={b.overdue ? 'font-semibold text-rose-500 dark:text-rose-400' : 'text-gray-500 dark:text-gray-400'}>{b.label}</span>
                      })()}
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

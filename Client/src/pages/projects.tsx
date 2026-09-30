import { useEffect, useState } from 'react'
import { api, PROJECT_SYNC_EVENT, INVOICE_SYNC_EVENT, PROJECT_STATUSES, BILLING_STAGES } from '../lib/api'
import type { Project, ProjectStatus, BillingStage, Lead, Location, EmployeeUser, Invoice } from '../lib/api'
import { ErrorBanner } from '../components/ErrorBanner'
import { PROJECT_STATUS_STYLES, DEFAULT_STATUS_STYLE } from '../lib/statusStyles'
import { formatINR } from '../lib/format'
import { EmptyState } from '../components/EmptyState'
import { focusCreateForm } from '../lib/focusCreateForm'
import { SkeletonRows } from '../components/Skeleton'

const statusStyle = (name: string) => PROJECT_STATUS_STYLES[name] ?? DEFAULT_STATUS_STYLE
// A stored date as the YYYY-MM-DD a date input expects ('' when unset).
const toDateInput = (ts: string | null) => (ts ? ts.slice(0, 10) : '')
const cellInputCls = 'rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-orange-300 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'
// A mandatory field still empty (projects from before engineer/dates were required).
const missingCls = '!border-rose-400 dark:!border-rose-500'

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
    return { label: `${formatINR(outstanding)} due`, overdue: true }
  }

  const leadLabel = (l: Lead) => `${l.plant?.plantName ?? 'Unnamed plant'}${l.plant?.client?.clientName ? ` — ${l.plant.client.clientName}` : ''}`
  // One project per lead (enforced server-side too) — a lead that already has
  // one, including one auto-created from a Won proposal, isn't offered again.
  const leadsWithProject = new Set(projects.map(p => p.leadId))
  const availableLeads = leads.filter(l => !leadsWithProject.has(l.id))

  async function createProject(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!form.leadId) { setFormError('Lead is required.'); return }
    if (!form.projectName.trim()) { setFormError('Project name is required.'); return }
    if (!form.responsibleUserId) { setFormError('Responsible engineer is required.'); return }
    if (!form.startDate || !form.completionDate) { setFormError('Start and completion dates are required.'); return }
    if (form.completionDate < form.startDate) { setFormError('Completion date can’t be before the start date.'); return }
    setCreating(true)
    try {
      const { project } = await api<{ project: Project }>('/projects', {
        method: 'POST',
        auth: true,
        body: {
          leadId: form.leadId,
          projectName: form.projectName.trim(),
          locationId: form.locationId || undefined,
          startDate: form.startDate,
          completionDate: form.completionDate,
          responsibleUserId: form.responsibleUserId,
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
              <option value="">{leads.length > 0 && availableLeads.length === 0 ? 'Every lead already has a project' : 'Select a lead…'}</option>
              {availableLeads.map(l => <option key={l.id} value={l.id}>{leadLabel(l)}</option>)}
            </select>
            <span className="text-[11px] font-normal text-gray-400 dark:text-gray-400">Only leads without a project are listed — one project per lead.</span>
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
            Responsible engineer *
            <select value={form.responsibleUserId} onChange={e => setForm({ ...form, responsibleUserId: e.target.value })} className={inputCls}>
              <option value="">Select an engineer…</option>
              {employees.map(u => <option key={u.id} value={u.id}>{u.userName || u.email}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            Start date *
            <input type="date" value={form.startDate} max={form.completionDate || undefined} onChange={e => setForm({ ...form, startDate: e.target.value })} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            Completion date *
            <input type="date" value={form.completionDate} min={form.startDate || undefined} onChange={e => setForm({ ...form, completionDate: e.target.value })} className={inputCls} />
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
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Projects {projects.length > 0 && <span className="text-gray-400 dark:text-gray-400">({projects.length})</span>}</h3>
          <button onClick={load} className="text-xs font-medium text-orange-500 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-300">Refresh</button>
        </div>

        {error && <ErrorBanner message={error} onRetry={load} />}

        {loading ? (
          <SkeletonRows />
        ) : projects.length === 0 && !error ? (
          <EmptyState icon="briefcase" title="No projects yet" message="Marking a proposal Won creates its project automatically — or add one by hand." action={{ label: 'Create project', onClick: focusCreateForm }} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1150px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs uppercase tracking-wider text-gray-400 dark:border-gray-800 dark:text-gray-400">
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
                      <p className="text-gray-400 dark:text-gray-400">{p.lead?.plant?.client?.clientName ?? ''}</p>
                    </td>
                    {/* Engineer and dates are editable here, not just at creation —
                        a project auto-created from a Won proposal starts with neither. */}
                    <td className="px-3 py-3">
                      <select
                        value={p.responsibleUserId ?? ''}
                        disabled={savingId === p.id}
                        onChange={e => e.target.value && patchProject(p.id, { responsibleUserId: e.target.value })}
                        className={`${cellInputCls} ${p.responsibleUserId ? '' : missingCls}`}
                        aria-label={`Engineer for ${p.workOrderNo}`}
                      >
                        {/* Mandatory: can be changed, not cleared — the blank
                            choice only exists while none is set yet. */}
                        {!p.responsibleUserId && <option value="" disabled>Assign engineer *</option>}
                        {employees.map(u => <option key={u.id} value={u.id}>{u.userName || u.email}</option>)}
                        {/* keep a current assignee who's no longer in the list selectable */}
                        {p.responsibleUser && p.responsibleUserId && !employees.some(u => u.id === p.responsibleUserId) && (
                          <option value={p.responsibleUserId}>{p.responsibleUser.userName || p.responsibleUser.email}</option>
                        )}
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="date"
                          value={toDateInput(p.startDate)}
                          max={toDateInput(p.completionDate) || undefined}
                          disabled={savingId === p.id}
                          required
                          onChange={e => e.target.value && patchProject(p.id, { startDate: e.target.value })}
                          className={`${cellInputCls} ${p.startDate ? '' : missingCls}`}
                          aria-label={`Start date for ${p.workOrderNo}`}
                          title="Start date"
                        />
                        <span className="text-xs text-gray-400">→</span>
                        <input
                          type="date"
                          value={toDateInput(p.completionDate)}
                          min={toDateInput(p.startDate) || undefined}
                          disabled={savingId === p.id}
                          required
                          onChange={e => e.target.value && patchProject(p.id, { completionDate: e.target.value })}
                          className={`${cellInputCls} ${p.completionDate ? '' : missingCls}`}
                          aria-label={`Completion date for ${p.workOrderNo}`}
                          title="Completion date"
                        />
                      </div>
                    </td>
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

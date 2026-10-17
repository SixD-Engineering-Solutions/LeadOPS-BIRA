import { useEffect, useState } from 'react'
import { api, PROJECT_SYNC_EVENT, INVOICE_SYNC_EVENT, PROJECT_STATUSES, BILLING_STAGES } from '../lib/api'
import type { Project, ProjectStatus, BillingStage, Lead, Location, EmployeeUser, Invoice } from '../lib/api'
import { ErrorBanner } from '../components/ErrorBanner'
import { PROJECT_STATUS_STYLES, DEFAULT_STATUS_STYLE } from '../lib/statusStyles'
import { formatINR } from '../lib/format'
import { EmptyState } from '../components/EmptyState'
import { PageHeader, NewButton } from '../components/PageHeader'
import { CreatePanel } from '../components/CreatePanel'
import { PAGE_CLASS } from '../lib/pageChrome'
import { SkeletonRows } from '../components/Skeleton'
import { Modal } from '../components/Modal'
import { LeadDetailById } from '../components/LeadDetailModal'
import { useTableView } from '../lib/useTableView'
import { DataGrid } from '../components/table/DataGrid'
import type { Column } from '../components/table/DataGrid'
import { TableToolbar, TableFooter, NoMatches, RefreshButton } from '../components/table/TableToolbar'
import { MenuSelect } from '../components/table/MenuSelect'
import { RowMenu } from '../components/table/RowMenu'
import { formatDate, daysFromToday } from '../lib/relativeTime'
import { BADGE_TONES } from '../lib/statusStyles'

const statusStyle = (name: string) => PROJECT_STATUS_STYLES[name] ?? DEFAULT_STATUS_STYLE
// Billing stages run left to right, so their colours do too: grey → done green.
const BILLING_TONES: Record<string, string> = {
  'Not Started': BADGE_TONES.gray, 'Advance Received': BADGE_TONES.sky, 'Partial Billing': BADGE_TONES.amber, 'Final Billing': BADGE_TONES.violet, 'Fully Billed': BADGE_TONES.emerald,
}
const billingStyle = (name: string) => BILLING_TONES[name] ?? DEFAULT_STATUS_STYLE
// A stored date as the YYYY-MM-DD a date input expects ('' when unset).
const toDateInput = (ts: string | null) => (ts ? ts.slice(0, 10) : '')
const person = (u?: { userName: string | null; email: string } | null) => (u ? u.userName || u.email : null)

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
  const [showCreate, setShowCreate] = useState(false)
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
  // What's still owed on a project's invoices (null when it has none yet).
  function outstandingOf(projectId: string): number | null {
    const projectInvoices = invoices.filter(i => i.projectId === projectId)
    if (projectInvoices.length === 0) return null
    return projectInvoices.reduce((sum, i) => sum + (i.amount - i.payments.reduce((s, p) => s + p.amountReceived, 0)), 0)
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
      setShowCreate(false)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not create project.')
    } finally {
      setCreating(false)
    }
  }

  // `rethrow`: for the edit dialog, which shows the error itself and stays open.
  async function patchProject(id: string, body: object, rethrow = false) {
    setSavingId(id)
    try {
      const { project } = await api<{ project: Project }>(`/projects/${id}`, { method: 'PATCH', auth: true, body })
      setProjects(prev => prev.map(p => (p.id === id ? project : p)))
      setError(null)
    } catch (e) {
      if (rethrow) throw e
      setError(e instanceof Error ? e.message : 'Could not update project.')
    } finally {
      setSavingId(null)
    }
  }

  const [openLeadId, setOpenLeadId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Project | null>(null)
  const plantOf = (p: Project) => p.lead?.plant?.plantName ?? null
  const clientOf = (p: Project) => p.lead?.plant?.client?.clientName ?? null
  const missing = (p: Project) => !p.responsibleUserId || !p.startDate || !p.completionDate

  const view = useTableView<Project>({
    id: 'projects',
    rows: projects,
    search: p => [p.workOrderNo, p.projectName, plantOf(p), clientOf(p), person(p.responsibleUser), p.status, p.billingStage, p.proposal?.proposalNumber].join(' '),
    views: [
      { id: 'all', label: 'All' },
      { id: 'active', label: 'Active', match: p => p.status === 'Not Started' || p.status === 'In Progress' },
      { id: 'owed', label: 'Money owed', match: p => (outstandingOf(p.id) ?? 0) > 0 },
      { id: 'incomplete', label: 'Missing details', match: missing },
      { id: 'completed', label: 'Completed', match: p => p.status === 'Completed' },
    ],
    filters: [
      { id: 'status', label: 'Status', value: p => p.status, order: PROJECT_STATUSES },
      { id: 'billing', label: 'Billing stage', value: p => p.billingStage, order: BILLING_STAGES },
      { id: 'engineer', label: 'Engineer', value: p => person(p.responsibleUser) },
      { id: 'client', label: 'Client', value: clientOf },
    ],
    sorts: {
      wo: { value: p => p.workOrderNo, firstDir: 'desc' },
      lead: { value: plantOf },
      engineer: { value: p => person(p.responsibleUser) },
      dates: { value: p => (p.completionDate ? new Date(p.completionDate).getTime() : null) },
      status: { value: p => PROJECT_STATUSES.indexOf(p.status as ProjectStatus) },
      billing: { value: p => BILLING_STAGES.indexOf(p.billingStage as BillingStage) },
      owed: { value: p => outstandingOf(p.id), firstDir: 'desc' },
    },
    defaultSort: { id: 'wo', dir: 'desc' },
  })

  const employeeOptions = (p: Project) => [
    ...employees.map(u => ({ value: u.id, label: u.userName || u.email, hint: u.email })),
    // keep a current engineer who's no longer in the list
    ...(p.responsibleUser && p.responsibleUserId && !employees.some(u => u.id === p.responsibleUserId)
      ? [{ value: p.responsibleUserId, label: person(p.responsibleUser)!, hint: p.responsibleUser.email }] : []),
  ]

  const columns: Column<Project>[] = [
    {
      id: 'wo', header: 'Work order', sticky: true, className: 'min-w-[230px] max-w-[300px]',
      cell: p => (
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{p.workOrderNo}</p>
          <p className="truncate text-xs text-gray-500 dark:text-gray-400">{p.projectName}{p.proposal ? ` · from ${p.proposal.proposalNumber}` : ''}</p>
        </div>
      ),
    },
    {
      id: 'lead', header: 'Lead', className: 'max-w-[200px]',
      cell: p => (
        <>
          <p className="truncate text-gray-700 dark:text-gray-200">{plantOf(p) ?? '—'}</p>
          <p className="truncate text-gray-400 dark:text-gray-500">{clientOf(p) ?? ''}</p>
        </>
      ),
    },
    {
      id: 'engineer', header: 'Engineer',
      // Mandatory: can be changed, not cleared.
      cell: p => p.responsibleUserId ? (
        <MenuSelect variant="person" label={`Engineer for ${p.workOrderNo}`} value={p.responsibleUserId} options={employeeOptions(p)} busy={savingId === p.id} onChange={v => v && patchProject(p.id, { responsibleUserId: v })} />
      ) : (
        <button type="button" onClick={e => { e.stopPropagation(); setEditing(p) }} className="rounded-full border border-dashed border-rose-300 px-2.5 py-0.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-500/50 dark:text-rose-400 dark:hover:bg-rose-500/10">
          Assign engineer
        </button>
      ),
    },
    {
      id: 'dates', header: 'Dates',
      cell: p => {
        if (!p.startDate || !p.completionDate) {
          return (
            <button type="button" onClick={e => { e.stopPropagation(); setEditing(p) }} className="rounded-full border border-dashed border-rose-300 px-2.5 py-0.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-500/50 dark:text-rose-400 dark:hover:bg-rose-500/10">
              Set {p.startDate ? 'completion date' : p.completionDate ? 'start date' : 'dates'}
            </button>
          )
        }
        const days = daysFromToday(p.completionDate)
        const late = p.status !== 'Completed' && days < 0
        return (
          <span className="whitespace-nowrap">
            <span className="text-gray-700 dark:text-gray-200">{formatDate(p.startDate).replace(/, \d{4}$/, '')} → {formatDate(p.completionDate)}</span>
            {p.status !== 'Completed' && (
              <span className={`block text-[11px] ${late ? 'text-rose-500 dark:text-rose-400' : 'text-gray-400 dark:text-gray-500'}`}>
                {late ? `${-days} day${days === -1 ? '' : 's'} past completion date` : days === 0 ? 'due today' : `${days} day${days === 1 ? '' : 's'} left`}
              </span>
            )}
          </span>
        )
      },
    },
    {
      id: 'status', header: 'Status',
      cell: p => <MenuSelect variant="pill" label={`Status of ${p.workOrderNo}`} value={p.status} options={PROJECT_STATUSES.map(s => ({ value: s, label: s }))} toneOf={statusStyle} busy={savingId === p.id} onChange={v => patchProject(p.id, { status: v as ProjectStatus })} />,
    },
    {
      id: 'billing', header: 'Billing stage',
      cell: p => <MenuSelect variant="pill" label={`Billing stage of ${p.workOrderNo}`} value={p.billingStage} options={BILLING_STAGES.map(s => ({ value: s, label: s }))} toneOf={billingStyle} busy={savingId === p.id} onChange={v => patchProject(p.id, { billingStage: v as BillingStage })} />,
    },
    {
      id: 'owed', header: 'Outstanding', align: 'right',
      cell: p => {
        const o = outstandingOf(p.id)
        if (o == null) return <span className="text-gray-400 dark:text-gray-500">No invoices</span>
        return o > 0 ? <span className="font-semibold text-rose-600 dark:text-rose-400">{formatINR(o)}</span> : <span className="text-emerald-600 dark:text-emerald-400">Paid in full</span>
      },
    },
  ]

  return (
    <div className={PAGE_CLASS}>
      <PageHeader title="Projects" subtitle="Work orders raised directly, or auto-created when a proposal is marked Won.">
        <NewButton label="New project" onClick={() => setShowCreate(true)} />
      </PageHeader>

      {/* list */}
      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <TableToolbar view={view} noun="projects" placeholder="Search work order, project, client…">
          <RefreshButton onClick={load} busy={loading} />
        </TableToolbar>

        {error && <ErrorBanner message={error} onRetry={load} />}

        {loading && projects.length === 0 ? (
          <SkeletonRows />
        ) : projects.length === 0 && !error ? (
          <EmptyState icon="briefcase" title="No projects yet" message="Marking a proposal Won creates its project automatically — or add one by hand." action={{ label: 'Create project', onClick: () => setShowCreate(true) }} />
        ) : (
          <>
            <DataGrid
              columns={columns}
              rows={view.rows}
              getKey={p => p.id}
              view={view}
              onRowClick={p => setOpenLeadId(p.leadId)}
              rowLabel={p => `Open the lead for ${p.workOrderNo}`}
              actions={p => (
                <RowMenu
                  label={p.workOrderNo}
                  actions={[
                    { label: 'Edit engineer & dates', onSelect: () => setEditing(p) },
                    { label: 'Open lead', onSelect: () => setOpenLeadId(p.leadId) },
                  ]}
                />
              )}
              empty={<NoMatches noun="projects" onClear={view.clearFilters} />}
              minWidth={1080}
            />
            <TableFooter view={view} />
          </>
        )}
      </div>

      {openLeadId && <LeadDetailById leadId={openLeadId} onClose={() => setOpenLeadId(null)} />}
      {editing && (
        <EditProjectModal
          project={editing}
          employees={employees}
          onClose={() => setEditing(null)}
          onSave={async body => { await patchProject(editing.id, body, true); setEditing(null) }}
        />
      )}
      {showCreate && (
        <CreatePanel
          title="New project"
          subtitle="Marking a proposal Won creates its project automatically — use this for work orders raised directly."
          onClose={() => setShowCreate(false)}
          onSubmit={createProject}
          saving={creating}
          submitLabel="Add project"
          savingLabel="Saving…"
          error={formError}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        </CreatePanel>
      )}
    </div>
  )
}

// Engineer and dates, edited in a dialog rather than inside the table row —
// a project auto-created from a Won proposal may still be missing them, and
// all three are required.
function EditProjectModal({ project, employees, onClose, onSave }: {
  project: Project
  employees: EmployeeUser[]
  onClose: () => void
  onSave: (body: { responsibleUserId: string; startDate: string; completionDate: string }) => Promise<void>
}) {
  const [form, setForm] = useState({ responsibleUserId: project.responsibleUserId ?? '', startDate: toDateInput(project.startDate), completionDate: toDateInput(project.completionDate) })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.responsibleUserId) { setError('Responsible engineer is required.'); return }
    if (!form.startDate || !form.completionDate) { setError('Start and completion dates are required.'); return }
    if (form.completionDate < form.startDate) { setError('Completion date can’t be before the start date.'); return }
    setSaving(true)
    try {
      await onSave(form)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the project.')
      setSaving(false)
    }
  }

  const label = 'flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400'
  return (
    <Modal title={`Edit ${project.workOrderNo}`} subtitle={project.projectName} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className={label}>
          Responsible engineer *
          <select value={form.responsibleUserId} onChange={e => setForm({ ...form, responsibleUserId: e.target.value })} className={inputCls} autoFocus>
            <option value="">Select an engineer…</option>
            {employees.map(u => <option key={u.id} value={u.id}>{u.userName || u.email}</option>)}
            {project.responsibleUser && project.responsibleUserId && !employees.some(u => u.id === project.responsibleUserId) && (
              <option value={project.responsibleUserId}>{project.responsibleUser.userName || project.responsibleUser.email}</option>
            )}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            Start date *
            <input type="date" value={form.startDate} max={form.completionDate || undefined} onChange={e => setForm({ ...form, startDate: e.target.value })} className={inputCls} />
          </label>
          <label className={label}>
            Completion date *
            <input type="date" value={form.completionDate} min={form.startDate || undefined} onChange={e => setForm({ ...form, completionDate: e.target.value })} className={inputCls} />
          </label>
        </div>
        {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-xl bg-gradient-to-r from-rose-400 to-orange-400 px-5 py-2 text-sm font-semibold text-white transition hover:from-rose-500 hover:to-orange-500 disabled:opacity-60">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

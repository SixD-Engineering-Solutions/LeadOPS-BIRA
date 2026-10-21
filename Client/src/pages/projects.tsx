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
import { Field } from '../components/form/Field'
import { SearchSelect } from '../components/form/SearchSelect'
import { inputCls as fieldCls, focusFirstInvalid } from '../lib/formStyles'
import type { FieldErrors } from '../lib/formStyles'
import { toast } from '../lib/toast'
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
import { btn } from '../lib/ui'
import { DatePicker } from '../components/form/DatePicker'

const statusStyle = (name: string) => PROJECT_STATUS_STYLES[name] ?? DEFAULT_STATUS_STYLE
// Billing stages run left to right, so their colours do too: grey → done green.
const BILLING_TONES: Record<string, string> = {
  'Not Started': BADGE_TONES.gray, 'Advance Received': BADGE_TONES.sky, 'Partial Billing': BADGE_TONES.amber, 'Final Billing': BADGE_TONES.violet, 'Fully Billed': BADGE_TONES.emerald,
}
const billingStyle = (name: string) => BILLING_TONES[name] ?? DEFAULT_STATUS_STYLE
// A stored date as the YYYY-MM-DD a date input expects ('' when unset).
const toDateInput = (ts: string | null) => (ts ? ts.slice(0, 10) : '')
const person = (u?: { userName: string | null; email: string } | null) => (u ? u.userName || u.email : null)

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
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<'leadId' | 'projectName' | 'responsibleUserId' | 'startDate' | 'completionDate'>>({})
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

  // One project per lead (enforced server-side too) — a lead that already has
  // one, including one auto-created from a Won proposal, isn't offered again.
  const leadsWithProject = new Set(projects.map(p => p.leadId))
  const availableLeads = leads.filter(l => !leadsWithProject.has(l.id))

  async function createProject(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    const errs: typeof fieldErrors = {}
    if (!form.leadId) errs.leadId = 'Choose the lead this project is for.'
    if (!form.projectName.trim()) errs.projectName = 'Project name is required.'
    if (!form.responsibleUserId) errs.responsibleUserId = 'Choose the engineer running it.'
    if (!form.startDate) errs.startDate = 'Start date is required.'
    if (!form.completionDate) errs.completionDate = 'Completion date is required.'
    else if (form.startDate && form.completionDate < form.startDate) errs.completionDate = 'Can’t be before the start date.'
    setFieldErrors(errs)
    if (Object.keys(errs).length) { focusFirstInvalid(); return }
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
      toast(`Project ${project.workOrderNo} created`, { action: { label: 'View', onClick: () => setOpenLeadId(project.leadId) } })
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not create project.')
    } finally {
      setCreating(false)
    }
  }

  // `rethrow`: for the edit dialog, which shows the error itself and stays open.
  async function patchProject(id: string, body: Record<string, unknown>, rethrow = false, undoable = true) {
    const old = projects.find(p => p.id === id) as Record<string, unknown> | undefined
    // What to send to put it back: the old value of each changed field.
    const before = Object.fromEntries(Object.keys(body).map(k => [k, typeof old?.[k] === 'string' && /Date$/.test(k) ? (old[k] as string).slice(0, 10) : old?.[k] ?? null]))
    setSavingId(id)
    try {
      const { project } = await api<{ project: Project }>(`/projects/${id}`, { method: 'PATCH', auth: true, body })
      setProjects(prev => prev.map(p => (p.id === id ? project : p)))
      setError(null)
      const what = 'status' in body ? `marked ${String(body.status)}` : 'billingStage' in body ? `billing stage: ${String(body.billingStage)}` : 'updated'
      const canUndo = undoable && Object.values(before).every(v => v != null)
      toast(`${project.workOrderNo} ${what}`, canUndo ? { action: { label: 'Undo', onClick: () => patchProject(id, before, false, false) } } : {})
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
            <Field label="Lead" required error={fieldErrors.leadId} hint="Only leads without a project are listed — one project per lead.">
              <SearchSelect
                value={form.leadId}
                onChange={v => { setForm({ ...form, leadId: v }); setFieldErrors(p => ({ ...p, leadId: undefined })) }}
                options={availableLeads.map(l => ({ value: l.id, label: l.plant?.plantName ?? 'Unnamed plant', hint: l.plant?.client?.clientName ?? undefined }))}
                emptyLabel={leads.length > 0 && availableLeads.length === 0 ? 'Every lead already has a project' : 'Select a lead…'}
                invalid={!!fieldErrors.leadId}
                label="Lead"
              />
            </Field>
            <Field label="Project name" required error={fieldErrors.projectName}>
              <input value={form.projectName} onChange={e => { setForm({ ...form, projectName: e.target.value }); setFieldErrors(p => ({ ...p, projectName: undefined })) }} placeholder="e.g. Plant-wide laser scan" aria-invalid={!!fieldErrors.projectName || undefined} className={fieldCls(!!fieldErrors.projectName)} />
            </Field>
            <Field label="Location">
              <SearchSelect value={form.locationId} onChange={v => setForm({ ...form, locationId: v })} options={locations.map(l => ({ value: l.id, label: `${l.city}${l.state ? `, ${l.state}` : ''}` }))} emptyLabel="Select…" allowEmpty label="Location" />
            </Field>
            <Field label="Responsible engineer" required error={fieldErrors.responsibleUserId}>
              <SearchSelect value={form.responsibleUserId} onChange={v => { setForm({ ...form, responsibleUserId: v }); setFieldErrors(p => ({ ...p, responsibleUserId: undefined })) }} options={employees.map(u => ({ value: u.id, label: u.userName || u.email, hint: u.email }))} emptyLabel="Select an engineer…" invalid={!!fieldErrors.responsibleUserId} label="Responsible engineer" />
            </Field>
            <Field label="Start date" required error={fieldErrors.startDate}>
              <DatePicker value={form.startDate} max={form.completionDate || undefined} onChange={v => { setForm({ ...form, startDate: v }); setFieldErrors(p => ({ ...p, startDate: undefined })) }} invalid={!!fieldErrors.startDate} />
            </Field>
            <Field label="Completion date" required error={fieldErrors.completionDate}>
              <DatePicker value={form.completionDate} min={form.startDate || undefined} onChange={v => { setForm({ ...form, completionDate: v }); setFieldErrors(p => ({ ...p, completionDate: undefined })) }} invalid={!!fieldErrors.completionDate} />
            </Field>
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
          <SearchSelect
            value={form.responsibleUserId}
            onChange={v => setForm({ ...form, responsibleUserId: v })}
            options={[
              ...employees.map(u => ({ value: u.id, label: u.userName || u.email, hint: u.email })),
              ...(project.responsibleUser && project.responsibleUserId && !employees.some(u => u.id === project.responsibleUserId)
                ? [{ value: project.responsibleUserId, label: project.responsibleUser.userName || project.responsibleUser.email }] : []),
            ]}
            emptyLabel="Select an engineer…"
            label="Responsible engineer"
            autoFocus
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            Start date *
            <DatePicker value={form.startDate} max={form.completionDate || undefined} onChange={v => setForm({ ...form, startDate: v })} />
          </label>
          <label className={label}>
            Completion date *
            <DatePicker value={form.completionDate} min={form.startDate || undefined} onChange={v => setForm({ ...form, completionDate: v })} />
          </label>
        </div>
        {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btn('secondary', 'md')}>Cancel</button>
          <button type="submit" disabled={saving} className={btn('primary', 'md')}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

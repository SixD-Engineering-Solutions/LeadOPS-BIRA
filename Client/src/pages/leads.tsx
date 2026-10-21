import { useEffect, useState } from 'react'
import { api, LEAD_SYNC_EVENT } from '../lib/api'
import type { Lead, EmployeeUser } from '../lib/api'
import LeadDetailModal from '../components/LeadDetailModal'
import { LostReasonModal } from '../components/LostReasonModal'
import { ErrorBanner } from '../components/ErrorBanner'
import { LEAD_STATUS_STYLES, DEFAULT_STATUS_STYLE } from '../lib/statusStyles'
import { EmptyState } from '../components/EmptyState'
import { PageHeader, NewButton } from '../components/PageHeader'
import { CreatePanel } from '../components/CreatePanel'
import { PAGE_CLASS } from '../lib/pageChrome'
import { Field } from '../components/form/Field'
import { Combobox } from '../components/form/Combobox'
import { SearchSelect } from '../components/form/SearchSelect'
import { inputCls as fieldCls, focusFirstInvalid } from '../lib/formStyles'
import type { FieldErrors } from '../lib/formStyles'
import { useLookups } from '../hooks/useLookups'
import { toast } from '../lib/toast'
import { SkeletonRows } from '../components/Skeleton'
import { useTableView } from '../lib/useTableView'
import { useConfirm } from '../lib/useConfirm'
import { DataGrid } from '../components/table/DataGrid'
import type { Column } from '../components/table/DataGrid'
import { TableToolbar, TableFooter, NoMatches, RefreshButton } from '../components/table/TableToolbar'
import { MenuSelect, PersonChip } from '../components/table/MenuSelect'
import { RowMenu } from '../components/table/RowMenu'
import { RelTime } from '../components/table/RelTime'

// Fixed status options.
const STATUSES = ['Submitted', 'In Process', 'Dead'] as const

const statusStyle = (name: string | null | undefined) => LEAD_STATUS_STYLES[name ?? ''] ?? DEFAULT_STATUS_STYLE
const person = (u?: { userName: string | null; email: string } | null) => (u ? u.userName || u.email : null)
const statusOf = (l: Lead) => l.status?.statusName ?? 'Submitted'

const inputCls = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'
const emptyForm = { plantName: '', clientName: '', city: '', contactName: '', contactEmail: '', contactNumber: '', verticalName: '', sectorName: '', sourceName: '', serviceTypeName: '', bmUserId: '', assignedToName: '', remark: '', statusName: 'Submitted', lostReason: '' }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function Leads({ isAdmin = false, currentUserId }: { isAdmin?: boolean; currentUserId?: string }) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [team, setTeam] = useState<EmployeeUser[]>([])

  const [form, setForm] = useState({ ...emptyForm })
  const [creating, setCreating] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<'plantName' | 'contactEmail' | 'lostReason'>>({})
  const lookups = useLookups(showCreate)
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

  // Team members, for the assignment and branch-manager dropdowns — keyed by
  // email so two people who happen to share a name can never be confused with
  // each other. Admins are excluded from assignment (leads are worked by
  // employees, not assigned to admin accounts) but can be a lead's BM.
  useEffect(() => {
    api<{ users: EmployeeUser[] }>('/users', { auth: true })
      .then(({ users }) => setTeam(users))
      .catch(() => {})
  }, [])
  const employees = team.filter(u => u.role !== 'admin')

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }))

  // Each problem shows under its own field; the first one gets focus.
  function validate() {
    const errs: typeof fieldErrors = {}
    if (!form.plantName.trim()) errs.plantName = 'Plant is required.'
    if (form.contactEmail.trim() && !EMAIL_RE.test(form.contactEmail.trim())) errs.contactEmail = 'Enter an email like name@company.com.'
    if (form.statusName === 'Dead' && form.lostReason.trim().length < 3) errs.lostReason = 'Say why it was lost (at least 3 characters).'
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function createLead(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!validate()) { focusFirstInvalid(); return }
    setCreating(true)
    try {
      const { lead } = await api<{ lead: Lead }>('/leads', { method: 'POST', auth: true, body: form })
      setLeads(prev => [lead, ...prev])
      setForm({ ...emptyForm })
      setFieldErrors({})
      setShowCreate(false)
      toast(`Lead added · ${lead.plant?.plantName ?? 'new lead'}`, { action: { label: 'View', onClick: () => setSelectedLead(lead) } })
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not create lead.')
    } finally {
      setCreating(false)
    }
  }

  async function changeStatus(id: string, statusName: string, lostReason?: string, undoable = true) {
    const before = leads.find(l => l.id === id)?.status?.statusName ?? null
    setSavingId(id)
    try {
      const { lead } = await api<{ lead: Lead }>(`/leads/${id}`, { method: 'PATCH', auth: true, body: { statusName, lostReason } })
      setLeads(prev => prev.map(l => (l.id === id ? lead : l)))
      setSelectedLead(prev => (prev && prev.id === id ? lead : prev))
      setError(null)
      const canUndo = undoable && before && before !== statusName && before !== 'Dead' && statusName !== 'Dead'
      toast(`Status changed to ${statusName}`, canUndo ? { action: { label: 'Undo', onClick: () => changeStatus(id, before!, undefined, false) } } : {})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update status.')
    } finally {
      setSavingId(null)
    }
  }

  // Marking a lead Dead asks why first (mandatory); the status only changes
  // once a reason is given.
  const [lostFor, setLostFor] = useState<Lead | null>(null)
  function onStatusSelect(lead: Lead, statusName: string) {
    if (statusName === 'Dead' && lead.status?.statusName !== 'Dead') setLostFor(lead)
    else changeStatus(lead.id, statusName)
  }

  async function reassign(id: string, assignedToUserId: string, undoable = true) {
    const before = leads.find(l => l.id === id)?.assignedToUserId ?? ''
    setSavingId(id)
    try {
      const { lead } = await api<{ lead: Lead }>(`/leads/${id}`, { method: 'PATCH', auth: true, body: { assignedToUserId: assignedToUserId || null } })
      setLeads(prev => prev.map(l => (l.id === id ? lead : l)))
      setSelectedLead(prev => (prev && prev.id === id ? lead : prev))
      setError(null)
      toast(lead.assignedToUser ? `Assigned to ${person(lead.assignedToUser)}` : 'Lead unassigned', undoable ? { action: { label: 'Undo', onClick: () => reassign(id, before, false) } } : {})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reassign lead.')
    } finally {
      setSavingId(null)
    }
  }

  async function setBm(id: string, bmUserId: string, undoable = true) {
    const before = leads.find(l => l.id === id)?.bmUserId ?? ''
    setSavingId(id)
    try {
      const { lead } = await api<{ lead: Lead }>(`/leads/${id}`, { method: 'PATCH', auth: true, body: { bmUserId: bmUserId || null } })
      setLeads(prev => prev.map(l => (l.id === id ? lead : l)))
      setSelectedLead(prev => (prev && prev.id === id ? lead : prev))
      setError(null)
      toast(lead.bmUser ? `BM set to ${person(lead.bmUser)}` : 'BM cleared', undoable ? { action: { label: 'Undo', onClick: () => setBm(id, before, false) } } : {})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not set the branch manager.')
    } finally {
      setSavingId(null)
    }
  }

  const [confirmDialog, confirm] = useConfirm()
  async function removeLead(lead: Lead) {
    const ok = await confirm({
      title: `Delete ${lead.plant?.plantName ?? 'this lead'}?`,
      message: 'Its proposal, project, invoices, payments and documents are deleted with it. This can’t be undone.',
      confirmLabel: 'Delete lead',
      danger: true,
    })
    if (!ok) return
    const id = lead.id
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

  const view = useTableView<Lead>({
    id: 'leads',
    rows: leads,
    search: l => [l.plant?.plantName, l.plant?.client?.clientName, l.contact?.contactPersonName, l.plant?.location?.city, l.vertical?.verticalName,
      l.sector?.sectorName, l.source?.sourceName, l.serviceType?.serviceTypeName, person(l.assignedToUser), person(l.bmUser), statusOf(l), l.remark].join(' '),
    views: [
      { id: 'all', label: 'All' },
      ...(!isAdmin && currentUserId ? [{ id: 'mine', label: 'Assigned to me', match: (l: Lead) => l.assignedToUserId === currentUserId }] : []),
      { id: 'open', label: 'Open', match: l => statusOf(l) !== 'Dead' },
      { id: 'unassigned', label: 'Unassigned', match: l => !l.assignedToUserId },
      { id: 'dead', label: 'Dead', match: l => statusOf(l) === 'Dead' },
    ],
    filters: [
      { id: 'status', label: 'Status', value: statusOf, order: STATUSES },
      { id: 'assigned', label: 'Assigned to', value: l => person(l.assignedToUser) },
      { id: 'sector', label: 'Sector', value: l => l.sector?.sectorName },
      { id: 'vertical', label: 'Vertical', value: l => l.vertical?.verticalName },
      { id: 'bm', label: 'BM', value: l => person(l.bmUser) },
      { id: 'source', label: 'Source', value: l => l.source?.sourceName },
    ],
    sorts: {
      plant: { value: l => l.plant?.plantName },
      classification: { value: l => l.vertical?.verticalName },
      status: { value: l => STATUSES.indexOf(statusOf(l) as (typeof STATUSES)[number]) },
      assigned: { value: l => person(l.assignedToUser) },
      assignedBy: { value: l => person(l.assignedByUser) },
      bm: { value: l => person(l.bmUser) },
      updated: { value: l => new Date(l.updatedAt).getTime(), firstDir: 'desc' },
    },
    defaultSort: { id: 'updated', dir: 'desc' },
  })

  const employeeOptions = employees.map(u => ({ value: u.id, label: u.userName || u.email, hint: u.email }))
  // Keep a BM who has since left the team visible rather than silently showing "None".
  const bmOptionsFor = (l: Lead) => [
    ...(l.bmUser && !team.some(u => u.id === l.bmUser!.id) ? [{ value: l.bmUser.id, label: person(l.bmUser)!, hint: l.bmUser.email }] : []),
    ...team.map(u => ({ value: u.id, label: u.userName || u.email, hint: u.email })),
  ]

  const columns: Column<Lead>[] = [
    {
      id: 'plant', header: 'Plant / Contact', sticky: true, className: 'min-w-[240px] max-w-[300px]',
      cell: l => (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{l.plant?.plantName ?? '—'}</p>
          <p className="truncate text-xs text-gray-500 dark:text-gray-400">{[l.plant?.client?.clientName, l.contact?.contactPersonName ?? 'No contact', l.plant?.location?.city].filter(Boolean).join(' · ')}</p>
        </div>
      ),
    },
    {
      id: 'classification', header: 'Vertical / Sector',
      cell: l => (
        <>
          <p className="text-gray-700 dark:text-gray-200">{l.vertical?.verticalName ?? '—'}</p>
          <p className="text-gray-400 dark:text-gray-500">{l.sector?.sectorName ?? '—'}</p>
        </>
      ),
    },
    {
      id: 'status', header: 'Status',
      cell: l => (
        <>
          <MenuSelect
            variant="pill"
            label={`Status of ${l.plant?.plantName ?? 'lead'}`}
            value={statusOf(l)}
            options={STATUSES.map(s => ({ value: s, label: s }))}
            toneOf={statusStyle}
            busy={savingId === l.id}
            onChange={v => onStatusSelect(l, v)}
          />
          {l.lostReason && <p className="mt-1 max-w-[180px] truncate text-[11px] text-rose-500 dark:text-rose-400" title={l.lostReason}>Lost: {l.lostReason}</p>}
        </>
      ),
    },
    {
      id: 'assigned', header: 'Assigned to',
      cell: l => (
        <MenuSelect
          variant="person"
          allowEmpty
          label={`Assignee of ${l.plant?.plantName ?? 'lead'}`}
          value={l.assignedToUserId ?? ''}
          options={employeeOptions}
          busy={savingId === l.id}
          onChange={v => reassign(l.id, v)}
        />
      ),
    },
    { id: 'assignedBy', header: 'Assigned by', cell: l => <PersonChip name={person(l.assignedByUser)} empty="—" /> },
    {
      id: 'bm', header: 'BM/Contact',
      cell: l => (
        <MenuSelect
          variant="person"
          allowEmpty
          emptyLabel="None"
          label={`Branch manager of ${l.plant?.plantName ?? 'lead'}`}
          value={l.bmUserId ?? ''}
          options={bmOptionsFor(l)}
          busy={savingId === l.id}
          onChange={v => setBm(l.id, v)}
        />
      ),
    },
    { id: 'updated', header: 'Updated', align: 'right', cell: l => <span className="text-gray-500 dark:text-gray-400"><RelTime ts={l.updatedAt} /></span> },
  ]

  const field = (label: string, key: keyof typeof form, placeholder: string, span = '', type = 'text') => (
    <label className={`flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400 ${span}`}>
      {label}
      <input type={type} value={form[key]} onChange={set(key)} placeholder={placeholder} className={inputCls} />
    </label>
  )

  return (
    <div className={PAGE_CLASS}>
      <PageHeader title="Leads" subtitle="Matching plants, contacts, verticals and sectors are reused or created automatically.">
        <NewButton label="New lead" onClick={() => setShowCreate(true)} />
      </PageHeader>

      {/* list */}
      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <TableToolbar view={view} noun="leads" placeholder="Search plant, client, contact, city…">
          <RefreshButton onClick={load} busy={loading} />
        </TableToolbar>

        {error && <ErrorBanner message={error} onRetry={load} />}

        {loading && leads.length === 0 ? (
          <SkeletonRows />
        ) : leads.length === 0 && !error ? (
          <EmptyState icon="users" title="No leads yet" message="Raise your first lead — it will also appear in the Tracker’s pipeline." action={{ label: 'Create lead', onClick: () => setShowCreate(true) }} />
        ) : (
          <>
            <DataGrid
              columns={columns}
              rows={view.rows}
              getKey={l => l.id}
              view={view}
              onRowClick={setSelectedLead}
              rowLabel={l => `Open ${l.plant?.plantName ?? 'lead'}`}
              actions={l => (
                <RowMenu
                  label={l.plant?.plantName ?? 'lead'}
                  actions={[
                    { label: 'Open lead', onSelect: () => setSelectedLead(l) },
                    isAdmin && { label: 'Delete lead', danger: true, disabled: savingId === l.id, onSelect: () => removeLead(l) },
                  ]}
                />
              )}
              empty={<NoMatches noun="leads" onClear={view.clearFilters} />}
              minWidth={1000}
            />
            <TableFooter view={view} />
          </>
        )}
      </div>

      {/* detail modal */}
      {selectedLead && <LeadDetailModal lead={selectedLead} onClose={() => setSelectedLead(null)} />}

      {confirmDialog}

      {lostFor && (
        <LostReasonModal
          title="Why was this lead lost?"
          subject={`Marking ${lostFor.plant?.plantName ?? 'this lead'} as Dead — the reason is required.`}
          onCancel={() => setLostFor(null)}
          onConfirm={async reason => {
            const { lead } = await api<{ lead: Lead }>(`/leads/${lostFor.id}`, { method: 'PATCH', auth: true, body: { statusName: 'Dead', lostReason: reason } })
            setLeads(prev => prev.map(l => (l.id === lead.id ? lead : l)))
            setSelectedLead(prev => (prev && prev.id === lead.id ? lead : prev))
            setLostFor(null)
          }}
        />
      )}
      {showCreate && (
        <CreatePanel
          title="New lead"
          subtitle="Matching plants, contacts, verticals and sectors are reused or created automatically."
          onClose={() => setShowCreate(false)}
          onSubmit={createLead}
          saving={creating}
          submitLabel="Add lead"
          savingLabel="Saving…"
          error={formError}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Client" hint="Suggests existing clients as you type">
              <Combobox value={form.clientName} onChange={v => setForm(p => ({ ...p, clientName: v }))} options={lookups.clients} placeholder="e.g. SAIL" noun="client" />
            </Field>
            <Field label="Plant" required error={fieldErrors.plantName}>
              <input value={form.plantName} onChange={e => { set('plantName')(e); setFieldErrors(p => ({ ...p, plantName: undefined })) }} placeholder="e.g. Bhilai Steel Plant" aria-invalid={!!fieldErrors.plantName || undefined} className={fieldCls(!!fieldErrors.plantName)} />
            </Field>
            {field('City', 'city', 'e.g. Bhilai')}
            {field('Contact', 'contactName', 'Contact person name')}
            <Field label="Contact email" error={fieldErrors.contactEmail}>
              <input
                type="email"
                value={form.contactEmail}
                onChange={e => { set('contactEmail')(e); setFieldErrors(p => ({ ...p, contactEmail: undefined })) }}
                onBlur={() => form.contactEmail.trim() && !EMAIL_RE.test(form.contactEmail.trim()) && setFieldErrors(p => ({ ...p, contactEmail: 'Enter an email like name@company.com.' }))}
                placeholder="e.g. name@company.com"
                aria-invalid={!!fieldErrors.contactEmail || undefined}
                className={fieldCls(!!fieldErrors.contactEmail)}
              />
            </Field>
            {field('Contact phone', 'contactNumber', 'e.g. 98765 43210', '', 'tel')}
            <Field label="Vertical">
              <Combobox value={form.verticalName} onChange={v => setForm(p => ({ ...p, verticalName: v }))} options={lookups.verticals} placeholder="e.g. AI Automation" noun="vertical" />
            </Field>
            <Field label="Sector">
              <Combobox value={form.sectorName} onChange={v => setForm(p => ({ ...p, sectorName: v }))} options={lookups.sectors} placeholder="e.g. Steel" noun="sector" />
            </Field>
            <Field label="Source">
              <Combobox value={form.sourceName} onChange={v => setForm(p => ({ ...p, sourceName: v }))} options={lookups.sources} placeholder="e.g. Expo / Reference / Website" noun="source" />
            </Field>
            <Field label="Service type">
              <Combobox value={form.serviceTypeName} onChange={v => setForm(p => ({ ...p, serviceTypeName: v }))} options={lookups.serviceTypes} placeholder="e.g. Laser scanning / BIM" noun="service type" />
            </Field>
            <Field label="BM/Contact (branch manager)">
              <SearchSelect value={form.bmUserId} onChange={v => setForm(p => ({ ...p, bmUserId: v }))} options={team.map(u => ({ value: u.id, label: u.userName || u.email, hint: u.email }))} emptyLabel="None" allowEmpty label="Branch manager" />
            </Field>
            <Field label="Assign to">
              <SearchSelect value={form.assignedToName} onChange={v => setForm(p => ({ ...p, assignedToName: v }))} options={employees.map(u => ({ value: u.email, label: u.userName || u.email, hint: u.email }))} emptyLabel="Unassigned" allowEmpty label="Assign to" />
            </Field>
            <Field label="Status">
              <SearchSelect value={form.statusName} onChange={v => setForm(p => ({ ...p, statusName: v }))} options={STATUSES.map(st => ({ value: st, label: st }))} label="Status" />
            </Field>
            <Field label="Remark" className="sm:col-span-2">
              <textarea value={form.remark} onChange={set('remark')} placeholder="Optional note — one point per line" rows={2} className={`${inputCls} resize-none`} />
            </Field>
            {form.statusName === 'Dead' && (
              <Field label="Reason lost" required error={fieldErrors.lostReason} className="sm:col-span-2">
                <textarea value={form.lostReason} onChange={e => { set('lostReason')(e); setFieldErrors(p => ({ ...p, lostReason: undefined })) }} placeholder="Why was this lead lost? e.g. budget cut, went with a competitor" rows={2} aria-invalid={!!fieldErrors.lostReason || undefined} className={`${fieldCls(!!fieldErrors.lostReason)} resize-none`} />
              </Field>
            )}
          </div>
        </CreatePanel>
      )}
    </div>
  )
}

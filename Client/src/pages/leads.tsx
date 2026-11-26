import { isAssignableRole } from '../lib/roles'
import { useEffect, useRef, useState } from 'react'
import { api, uploadDocument, LEAD_SYNC_EVENT } from '../lib/api'
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
const STATUSES = ['Cold call', 'Warm', 'Hot', 'Qualified', 'Follow-up', 'Lost'] as const

const statusStyle = (name: string | null | undefined) => LEAD_STATUS_STYLES[name ?? ''] ?? DEFAULT_STATUS_STYLE
const person = (u?: { userName: string | null; email: string } | null) => (u ? u.userName || u.email : null)
const statusOf = (l: Lead) => l.status?.statusName ?? 'Cold call'

const inputCls = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'
const emptyForm = { plantName: '', clientName: '', city: '', state: '', country: '', contactName: '', contactDesignation: '', contactDepartment: '', contactEmail: '', contactNumber: '', verticalName: '', sectorName: '', sourceName: '', serviceTypeName: '', bmUserId: '', assignedToName: '', remark: '', statusName: 'Cold call', lostReason: '' }
const INDIAN_STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Kept in sync with the server's ALLOWED_EXTENSIONS in routes/documents.ts.
const DOC_EXTENSIONS = ['.pdf', '.xlsx', '.xls', '.csv']
type ExtraContact = { name: string; designation: string; department: string; email: string; phone: string }
const emptyExtra: ExtraContact = { name: '', designation: '', department: '', email: '', phone: '' }
const MAX_EXTRA_CONTACTS = 10

export default function Leads({ isAdmin = false, currentUserId }: { isAdmin?: boolean; currentUserId?: string }) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [team, setTeam] = useState<EmployeeUser[]>([])

  const [form, setForm] = useState({ ...emptyForm })
  // "More than one person contacted" — extra people beyond the main contact.
  const [multiContact, setMultiContact] = useState(false)
  const [extras, setExtras] = useState<ExtraContact[]>([{ ...emptyExtra }])
  const [extraErrors, setExtraErrors] = useState<{ name?: string; email?: string }[]>([])
  // Documents attached while raising the lead; uploaded right after it's saved.
  const [files, setFiles] = useState<File[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [creating, setCreating] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<'plantName' | 'contactEmail' | 'lostReason' | 'bmUserId' | 'assignedToName'>>({})
  const lookups = useLookups(showCreate)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  // The lead being corrected in the panel (null = the panel is "New lead").
  const [editing, setEditing] = useState<Lead | null>(null)

  function load() {
    return api<{ leads: Lead[] }>('/leads', { auth: true })
      .then(({ leads }) => { setLeads(leads); setError(null) })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load leads.'))
      .finally(() => setLoading(false))
  }
  // First load: `loading` starts true. Refreshes show the spinner again.
  const reload = () => { setLoading(true); load() }
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
  const employees = team.filter(u => isAssignableRole(u.role))

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }))

  // Each problem shows under its own field; the first one gets focus.
  function validate() {
    const errs: typeof fieldErrors = {}
    if (!form.plantName.trim()) errs.plantName = 'Plant is required.'
    // BM and assignee are chosen when a lead is created; afterwards they can be changed but not cleared.
    if (!editing && !form.bmUserId) errs.bmUserId = 'Choose the BM (business manager).'
    if (!editing && !form.assignedToName) errs.assignedToName = 'Choose who this lead is assigned to.'
    if (form.contactEmail.trim() && !EMAIL_RE.test(form.contactEmail.trim())) errs.contactEmail = 'Enter an email like name@company.com.'
    if (form.statusName === 'Lost' && form.lostReason.trim().length < 3) errs.lostReason = 'Say why it was lost (at least 3 characters).'
    // Every additional person needs a name; a half-filled row is not ignored.
    const exErrs = multiContact
      ? extras.map(c => {
          const started = c.name.trim() || c.email.trim() || c.phone.trim()
          return {
            name: started && !c.name.trim() ? 'Enter this person’s name.' : undefined,
            email: c.email.trim() && !EMAIL_RE.test(c.email.trim()) ? 'Enter an email like name@company.com.' : undefined,
          }
        })
      : []
    setExtraErrors(exErrs)
    setFieldErrors(errs)
    return Object.keys(errs).length === 0 && !exErrs.some(x => x.name || x.email)
  }

  const setExtra = (i: number, k: keyof ExtraContact, v: string) => {
    setExtras(prev => prev.map((c, j) => (j === i ? { ...c, [k]: v } : c)))
    if (k !== 'phone' && k !== 'designation' && k !== 'department') setExtraErrors(prev => prev.map((x, j) => (j === i ? { ...x, [k]: undefined } : x)))
  }

  function addFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    if (fileInputRef.current) fileInputRef.current.value = ''
    const bad = picked.find(f => !DOC_EXTENSIONS.some(ext => f.name.toLowerCase().endsWith(ext)))
      ? 'Only PDF, Excel (.xlsx/.xls) or CSV files are accepted.'
      : picked.find(f => f.size > 10 * 1024 * 1024) ? 'Each file must be 10MB or smaller.' : null
    setFileError(bad)
    if (bad) return
    setFiles(prev => [...prev, ...picked.filter(f => !prev.some(p => p.name === f.name && p.size === f.size))].slice(0, 10))
  }

  function resetForm() {
    setForm({ ...emptyForm })
    setMultiContact(false)
    setExtras([{ ...emptyExtra }])
    setExtraErrors([])
    setFieldErrors({})
    setFormError(null)
    setFiles([])
    setFileError(null)
  }
  function openCreate() {
    if (editing) { setEditing(null); resetForm() }
    setShowCreate(true)
  }
  // Opens the panel filled with the lead's current values so a mistake can be fixed.
  function openEdit(lead: Lead) {
    const others = (lead.extraContacts ?? []).map(x => ({ name: x.contact.contactPersonName ?? '', designation: x.contact.designation ?? '', department: x.contact.department ?? '', email: x.contact.mailId ?? '', phone: x.contact.contactPersonNumber ?? '' }))
    resetForm()
    setForm({
      ...emptyForm,
      plantName: lead.plant?.plantName ?? '',
      clientName: lead.plant?.client?.clientName ?? '',
      city: lead.plant?.location?.city ?? '',
      state: lead.plant?.location?.state ?? '',
      country: lead.plant?.location?.country ?? '',
      contactName: lead.contact?.contactPersonName ?? '',
      contactDesignation: lead.contact?.designation ?? '',
      contactDepartment: lead.contact?.department ?? '',
      contactEmail: lead.contact?.mailId ?? '',
      contactNumber: lead.contact?.contactPersonNumber ?? '',
      verticalName: lead.vertical?.verticalName ?? '',
      sectorName: lead.sector?.sectorName ?? '',
      sourceName: lead.source?.sourceName ?? '',
      serviceTypeName: lead.serviceType?.serviceTypeName ?? '',
      remark: lead.remark ?? '',
    })
    setMultiContact(others.length > 0)
    setExtras(others.length ? others : [{ ...emptyExtra }])
    setEditing(lead)
    setShowCreate(true)
  }
  function closePanel() {
    setShowCreate(false)
    if (editing) { setEditing(null); resetForm() }
  }

  async function saveEdit() {
    if (!editing) return
    setFormError(null)
    if (!validate()) { focusFirstInvalid(); return }
    setCreating(true)
    try {
      const { lead } = await api<{ lead: Lead }>(`/leads/${editing.id}`, {
        method: 'PATCH', auth: true,
        body: {
          plantName: form.plantName, clientName: form.clientName, city: form.city, state: form.state, country: form.country,
          contactName: form.contactName, contactDesignation: form.contactDesignation, contactDepartment: form.contactDepartment, contactEmail: form.contactEmail, contactNumber: form.contactNumber,
          extraContacts: multiContact ? extras.filter(c => c.name.trim() || c.email.trim() || c.phone.trim()) : [],
          verticalName: form.verticalName, sectorName: form.sectorName, sourceName: form.sourceName, serviceTypeName: form.serviceTypeName,
          remark: form.remark.trim() ? form.remark : null,
        },
      })
      setLeads(prev => prev.map(l => (l.id === lead.id ? lead : l)))
      setSelectedLead(prev => (prev && prev.id === lead.id ? lead : prev))
      setEditing(null)
      resetForm()
      setShowCreate(false)
      toast(`Lead updated · ${lead.plant?.plantName ?? 'lead'}`)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not update lead.')
    } finally {
      setCreating(false)
    }
  }

  async function createLead(e: React.FormEvent) {
    e.preventDefault()
    if (editing) { await saveEdit(); return }
    setFormError(null)
    if (!validate()) { focusFirstInvalid(); return }
    setCreating(true)
    try {
      const { lead } = await api<{ lead: Lead }>('/leads', { method: 'POST', auth: true, body: { ...form, extraContacts: multiContact ? extras.filter(c => c.name.trim()) : [] } })
      setLeads(prev => [lead, ...prev])
      // The lead exists now — attach the chosen documents to it.
      const failed: string[] = []
      for (const f of files) {
        try { await uploadDocument(lead.id, f) } catch { failed.push(f.name) }
      }
      if (failed.length) toast(`Lead added, but these files didn’t upload: ${failed.join(', ')}. Add them from the lead’s Documents tab.`, { tone: 'error' })
      setFiles([])
      setFileError(null)
      setForm({ ...emptyForm })
      setMultiContact(false)
      setExtras([{ ...emptyExtra }])
      setExtraErrors([])
      setFieldErrors({})
      setShowCreate(false)
      if (!failed.length) toast(`Lead added · ${lead.plant?.plantName ?? 'new lead'}${files.length ? ` · ${files.length} document${files.length > 1 ? 's' : ''} attached` : ''}`, { action: { label: 'View', onClick: () => setSelectedLead(lead) } })
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
      const canUndo = undoable && before && before !== statusName && before !== 'Lost' && statusName !== 'Lost'
      toast(`Status changed to ${statusName}`, canUndo ? { action: { label: 'Undo', onClick: () => changeStatus(id, before!, undefined, false) } } : {})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update status.')
    } finally {
      setSavingId(null)
    }
  }

  // Marking a lead Lost asks why first (mandatory); the status only changes
  // once a reason is given.
  const [lostFor, setLostFor] = useState<Lead | null>(null)
  function onStatusSelect(lead: Lead, statusName: string) {
    if (statusName === 'Lost' && lead.status?.statusName !== 'Lost') setLostFor(lead)
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
      toast(lead.bmUser ? `BM set to ${person(lead.bmUser)}` : 'BM changed', undoable ? { action: { label: 'Undo', onClick: () => setBm(id, before, false) } } : {})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not set the BM.')
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
    search: l => [l.plant?.plantName, l.plant?.client?.clientName, l.contact?.contactPersonName, l.plant?.location?.city, l.plant?.location?.state, l.plant?.location?.country, l.vertical?.verticalName,
      l.sector?.sectorName, l.source?.sourceName, l.serviceType?.serviceTypeName, person(l.assignedToUser), person(l.bmUser), statusOf(l), l.remark].join(' '),
    views: [
      { id: 'all', label: 'All' },
      ...(!isAdmin && currentUserId ? [{ id: 'mine', label: 'Assigned to me', match: (l: Lead) => l.assignedToUserId === currentUserId }] : []),
      { id: 'open', label: 'Open', match: l => statusOf(l) !== 'Lost' },
      { id: 'unassigned', label: 'Unassigned', match: l => !l.assignedToUserId && statusOf(l) !== 'Lost' },
      { id: 'lost', label: 'Lost', match: l => statusOf(l) === 'Lost' },
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
      id: 'plant', header: 'Client / Plant', sticky: true, className: 'min-w-[240px] max-w-[300px]',
      cell: l => (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{l.plant?.client?.clientName ?? l.plant?.plantName ?? '—'}</p>
          <p className="truncate text-xs text-gray-500 dark:text-gray-400">{[l.plant?.plantName, l.contact?.contactPersonName ?? 'No contact', [l.plant?.location?.city, l.plant?.location?.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</p>
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
          emptyLabel="Choose a BM"
          label={`BM (business manager) of ${l.plant?.plantName ?? 'lead'}`}
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
      <PageHeader title="Leads">
        <NewButton label="New lead" onClick={openCreate} />
      </PageHeader>

      {/* list */}
      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <TableToolbar view={view} noun="leads" exportCsv={{ filename: 'leads', columns: columns }} placeholder="Search plant, client, contact, city…">
          <RefreshButton onClick={reload} busy={loading} />
        </TableToolbar>

        {error && <ErrorBanner message={error} onRetry={reload} />}

        {loading && leads.length === 0 ? (
          <SkeletonRows />
        ) : leads.length === 0 && !error ? (
          <EmptyState icon="users" title="No leads yet" message="Raise your first lead — it will also appear in the Tracker’s pipeline." action={{ label: 'Create lead', onClick: openCreate }} />
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
                    { label: 'Edit lead', disabled: savingId === l.id, onSelect: () => openEdit(l) },
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
          subject={`Marking ${lostFor.plant?.plantName ?? 'this lead'} as Lost — the reason is required.`}
          onCancel={() => setLostFor(null)}
          onConfirm={async reason => {
            const { lead } = await api<{ lead: Lead }>(`/leads/${lostFor.id}`, { method: 'PATCH', auth: true, body: { statusName: 'Lost', lostReason: reason } })
            setLeads(prev => prev.map(l => (l.id === lead.id ? lead : l)))
            setSelectedLead(prev => (prev && prev.id === lead.id ? lead : prev))
            setLostFor(null)
          }}
        />
      )}
      {showCreate && (
        <CreatePanel
          title={editing ? (editing.plant?.plantName ?? 'Lead') : 'New lead'}
          onClose={closePanel}
          onSubmit={createLead}
          saving={creating}
          submitLabel={editing ? 'Save changes' : 'Add lead'}
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
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
              State
              <input list="lead-states" value={form.state} onChange={set('state')} placeholder="e.g. Chhattisgarh" className={inputCls} />
              <datalist id="lead-states">{INDIAN_STATES.map(st => <option key={st} value={st} />)}</datalist>
            </label>
            {field('Country', 'country', 'e.g. India')}
            {field('Contact', 'contactName', 'Contact person name')}
            {field('Contact designation', 'contactDesignation', 'e.g. DGM')}
            {field('Contact department', 'contactDepartment', 'e.g. Maintenance')}
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
            <div className="sm:col-span-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={multiContact} onChange={e => setMultiContact(e.target.checked)} className="h-4 w-4 accent-orange-400" />
                More than one person contacted
              </label>
              {multiContact && (
                <div className="mt-3 space-y-3">
                  {extras.map((c, i) => (
                    <div key={i} className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Contact person {i + 2}</p>
                        {extras.length > 1 && (
                          <button type="button" onClick={() => { setExtras(prev => prev.filter((_, j) => j !== i)); setExtraErrors(prev => prev.filter((_, j) => j !== i)) }} className="text-xs text-red-500 hover:underline">Remove</button>
                        )}
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label="Name" required error={extraErrors[i]?.name} className="sm:col-span-2">
                          <input value={c.name} onChange={e => setExtra(i, 'name', e.target.value)} placeholder="Contact person name" aria-invalid={!!extraErrors[i]?.name || undefined} className={fieldCls(!!extraErrors[i]?.name)} />
                        </Field>
                        <Field label="Designation">
                          <input value={c.designation} onChange={e => setExtra(i, 'designation', e.target.value)} placeholder="e.g. DGM" className={fieldCls(false)} />
                        </Field>
                        <Field label="Department">
                          <input value={c.department} onChange={e => setExtra(i, 'department', e.target.value)} placeholder="e.g. Maintenance" className={fieldCls(false)} />
                        </Field>
                        <Field label="Email" error={extraErrors[i]?.email}>
                          <input type="email" value={c.email} onChange={e => setExtra(i, 'email', e.target.value)} placeholder="e.g. name@company.com" aria-invalid={!!extraErrors[i]?.email || undefined} className={fieldCls(!!extraErrors[i]?.email)} />
                        </Field>
                        <Field label="Phone">
                          <input type="tel" value={c.phone} onChange={e => setExtra(i, 'phone', e.target.value)} placeholder="e.g. 98765 43210" className={fieldCls(false)} />
                        </Field>
                      </div>
                    </div>
                  ))}
                  {extras.length < MAX_EXTRA_CONTACTS && (
                    <button type="button" onClick={() => setExtras(prev => [...prev, { ...emptyExtra }])} className="text-sm font-medium text-orange-600 hover:underline">+ Add another person</button>
                  )}
                </div>
              )}
            </div>
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
            {!editing && <>
            <Field label="BM (business manager)" required error={fieldErrors.bmUserId}>
              <SearchSelect value={form.bmUserId} onChange={v => { setForm(p => ({ ...p, bmUserId: v })); setFieldErrors(p => ({ ...p, bmUserId: undefined })) }} options={team.map(u => ({ value: u.id, label: u.userName || u.email, hint: u.email }))} emptyLabel="Choose a BM" label="BM (business manager)" />
            </Field>
            <Field label="Assign to" required error={fieldErrors.assignedToName}>
              <SearchSelect value={form.assignedToName} onChange={v => { setForm(p => ({ ...p, assignedToName: v })); setFieldErrors(p => ({ ...p, assignedToName: undefined })) }} options={employees.map(u => ({ value: u.email, label: u.userName || u.email, hint: u.email }))} emptyLabel="Choose who to assign to" label="Assign to" />
            </Field>
            <Field label="Status">
              <SearchSelect value={form.statusName} onChange={v => setForm(p => ({ ...p, statusName: v }))} options={STATUSES.map(st => ({ value: st, label: st }))} label="Status" />
            </Field>
            </>}
            <Field label="Remark" className="sm:col-span-2">
              <textarea value={form.remark} onChange={set('remark')} placeholder="Optional note — one point per line" rows={2} className={`${inputCls} resize-none`} />
            </Field>
            {!editing && <div className="sm:col-span-2">
              <input ref={fileInputRef} type="file" multiple accept={DOC_EXTENSIONS.join(',')} onChange={addFiles} className="sr-only" tabIndex={-1} aria-hidden="true" />
              <button type="button" onClick={() => fileInputRef.current?.click()} className="rounded-xl border border-dashed border-orange-300 bg-orange-50/60 px-4 py-2 text-sm font-semibold text-orange-600 outline-none hover:bg-orange-50 focus-visible:ring-2 focus-visible:ring-orange-300 dark:border-orange-800 dark:bg-orange-950/20 dark:text-orange-300">
                + Add documentation
              </button>
              <span className="ml-2 text-[11px] text-gray-400">PDF, Excel or CSV, up to 10MB each.</span>
              {fileError && <p role="alert" className="mt-1 text-xs text-red-500 dark:text-red-400">{fileError}</p>}
              {files.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {files.map((f, i) => (
                    <li key={`${f.name}:${f.size}`} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-1.5 text-xs dark:bg-gray-800/60">
                      <span className="min-w-0 truncate font-medium text-gray-800 dark:text-gray-100">{f.name}</span>
                      <button type="button" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} className="shrink-0 font-semibold text-red-500 hover:text-red-600">Remove</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>}
            {!editing && form.statusName === 'Lost' && (
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

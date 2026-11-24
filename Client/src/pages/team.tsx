import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import type { EmployeeUser, Lead } from '../lib/api'
import LeadDetailModal from '../components/LeadDetailModal'
import { ErrorBanner } from '../components/ErrorBanner'
import { EmptyState } from '../components/EmptyState'
import { SkeletonRows } from '../components/Skeleton'
import { LEAD_STATUS_STYLES, DEFAULT_STATUS_STYLE } from '../lib/statusStyles'
import { PageHeader, NewButton } from '../components/PageHeader'
import { CreatePanel } from '../components/CreatePanel'
import { Drawer } from '../components/Drawer'
import { Modal } from '../components/Modal'
import { DataGrid } from '../components/table/DataGrid'
import type { Column } from '../components/table/DataGrid'
import { RowMenu } from '../components/table/RowMenu'
import type { RowAction } from '../components/table/RowMenu'
import { Avatar } from '../components/table/MenuSelect'
import { RelTime } from '../components/table/RelTime'
import { TableToolbar, TableFooter, NoMatches, RefreshButton } from '../components/table/TableToolbar'
import { useTableView } from '../lib/useTableView'
import { useConfirm } from '../lib/useConfirm'
import { Field } from '../components/form/Field'
import { SearchSelect } from '../components/form/SearchSelect'
import { inputCls, focusFirstInvalid } from '../lib/formStyles'
import type { FieldErrors } from '../lib/formStyles'
import { PAGE_CLASS } from '../lib/pageChrome'
import { btn } from '../lib/ui'
import { toast } from '../lib/toast'
import { ROLES, ROLE_INFO, ROLE_LIST, DEFAULT_ROLE, isAssignableRole } from '../lib/roles'
import type { Role } from '../lib/roles'

/** Turn an email into a display name: "jane.doe@x.com" -> "Jane Doe". */
function displayName(email: string): string {
  const raw = email.split('@')[0].replace(/[._-]+/g, ' ').trim()
  return raw.replace(/\b\w/g, c => c.toUpperCase()) || 'User'
}

const nameOf = (u: EmployeeUser) => u.userName || displayName(u.email)
const statusStyle = (name: string | null | undefined) => LEAD_STATUS_STYLES[name ?? ''] ?? DEFAULT_STATUS_STYLE
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const emptyEmpForm = { email: '', userName: '', role: DEFAULT_ROLE as Role, department: '', phoneNumber: '' }

const TONES: Record<Role, { pill: string; dot: string }> = {
  admin: { pill: 'bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-300', dot: 'bg-orange-500' },
  bd: { pill: 'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300', dot: 'bg-sky-500' },
  accounts: { pill: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300', dot: 'bg-emerald-500' },
}

function RolePill({ role }: { role: string }) {
  const tone = TONES[role as Role] ?? TONES[ROLES.bd]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {ROLE_INFO[role as Role]?.label ?? role}
    </span>
  )
}

export default function Team({ currentUserId }: { currentUserId: string }) {
  // Includes removed (isActive: false) accounts too — this page is admin-only,
  // and an admin needs to see who's removed in order to reactivate them.
  const [users, setUsers] = useState<EmployeeUser[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [emailFor, setEmailFor] = useState<EmployeeUser | null>(null)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [confirmDialog, confirm] = useConfirm()

  const [empForm, setEmpForm] = useState({ ...emptyEmpForm })
  const [creatingEmp, setCreatingEmp] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [empError, setEmpError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<'email'>>({})

  function load() {
    return Promise.all([
      api<{ users: EmployeeUser[] }>('/users?includeInactive=true', { auth: true }),
      api<{ leads: Lead[] }>('/leads', { auth: true }),
    ])
      .then(([{ users }, { leads }]) => { setUsers(users); setLeads(leads); setError(null) })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load employees.'))
      .finally(() => setLoading(false))
  }
  // First load: `loading` starts true. Refreshes show the spinner again.
  const reload = () => { setLoading(true); load() }
  useEffect(() => { load() }, [])

  // Assigned leads grouped by whoever they're currently assigned to.
  const leadsByUser = useMemo(() => {
    const map = new Map<string, Lead[]>()
    for (const lead of leads) {
      if (!lead.assignedToUserId) continue
      const bucket = map.get(lead.assignedToUserId)
      if (bucket) bucket.push(lead)
      else map.set(lead.assignedToUserId, [lead])
    }
    return map
  }, [leads])
  const assignedTo = (u: EmployeeUser) => leadsByUser.get(u.id) ?? []
  const activeCount = users.filter(u => u.isActive).length
  const unassignedCount = leads.filter(l => !l.assignedToUserId).length

  async function createEmployee(e: React.FormEvent) {
    e.preventDefault()
    setEmpError(null)
    const email = empForm.email.trim()
    const errs: typeof fieldErrors = {}
    if (!email) errs.email = 'Email is required.'
    else if (!EMAIL_RE.test(email)) errs.email = 'Enter an email like name@company.com.'
    setFieldErrors(errs)
    if (Object.keys(errs).length) { focusFirstInvalid(); return }
    setCreatingEmp(true)
    try {
      const { user } = await api<{ user: EmployeeUser }>('/users', {
        method: 'POST',
        auth: true,
        body: {
          email,
          userName: empForm.userName.trim() || undefined,
          role: empForm.role,
          department: empForm.department.trim() || undefined,
          phoneNumber: empForm.phoneNumber.trim() || undefined,
        },
      })
      setUsers(prev => [user, ...prev])
      setEmpForm({ ...emptyEmpForm })
      setShowCreate(false)
      toast(`${nameOf(user)} added to the team`, { action: { label: 'View', onClick: () => setOpenId(user.id) } })
    } catch (e) {
      setEmpError(e instanceof Error ? e.message : 'Could not add employee.')
    } finally {
      setCreatingEmp(false)
    }
  }

  async function removeEmployee(u: EmployeeUser) {
    const ok = await confirm({
      title: `Remove ${nameOf(u)}?`,
      message: 'They’ll be signed out and can no longer log in. Their lead history is kept, and you can reactivate them later.',
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!ok) return
    setBusyId(u.id)
    try {
      await api(`/users/${u.id}`, { method: 'DELETE', auth: true })
      setUsers(prev => prev.map(x => (x.id === u.id ? { ...x, isActive: false } : x)))
      setError(null)
      toast(`${nameOf(u)} removed`, { action: { label: 'Undo', onClick: () => reactivateEmployee(u, false) } })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove employee.')
    } finally {
      setBusyId(null)
    }
  }

  async function reactivateEmployee(u: EmployeeUser, announce = true) {
    setBusyId(u.id)
    try {
      const { user } = await api<{ user: EmployeeUser }>(`/users/${u.id}/reactivate`, { method: 'POST', auth: true })
      setUsers(prev => prev.map(x => (x.id === u.id ? user : x)))
      setError(null)
      if (announce) toast(`${nameOf(user)} can sign in again`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reactivate employee.')
    } finally {
      setBusyId(null)
    }
  }

  // Three roles (lib/roles.ts): admin (full access), BD (their own assigned
  // work) and Accounts (invoicing). The server enforces it on every request;
  // this just asks for it. Moving someone to admin or Accounts unassigns their
  // leads (only BD are assignees) — the prompt says so first; the server
  // refuses if they still hold open tasks/projects.
  async function changeRole(u: EmployeeUser, role: Role) {
    const name = nameOf(u)
    const assignedCount = assignedTo(u).length
    const info = ROLE_INFO[role]
    const unassigns = !isAssignableRole(role) && assignedCount > 0
    const ok = await confirm({
      title: `Make ${name} ${info.article}?`,
      message: (
        <>
          <p>{role === ROLES.admin
            ? 'They’ll get full admin access: every lead, Reports, Team, deleting records and managing roles.'
            : role === ROLES.accounts
              ? 'They’ll work on invoicing and payments for completed projects, and lose access to leads and proposals.'
              : 'They’ll lose any admin or accounts access and work on the leads assigned to them.'}</p>
          {unassigns && (
            <p className="mt-2">Their {assignedCount} assigned lead{assignedCount === 1 ? '' : 's'} will become Unassigned — only BD team members are assigned leads — so you can hand {assignedCount === 1 ? 'it' : 'them'} to someone else.</p>
          )}
        </>
      ),
      confirmLabel: `Make ${info.label}`,
    })
    if (!ok) return
    setBusyId(u.id)
    try {
      const res = await api<{ user: EmployeeUser; unassignedLeads: number }>(`/users/${u.id}/role`, { method: 'PATCH', auth: true, body: { role } })
      setUsers(prev => prev.map(x => (x.id === u.id ? res.user : x)))
      if (res.unassignedLeads > 0) {
        // Their leads are now unassigned — refresh so the counts are right.
        const { leads } = await api<{ leads: Lead[] }>('/leads', { auth: true })
        setLeads(leads)
      }
      setError(null)
      toast(`${name} is now ${info.article}${res.unassignedLeads > 0 ? ` · ${res.unassignedLeads} lead${res.unassignedLeads === 1 ? '' : 's'} unassigned` : ''}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the role.')
    } finally {
      setBusyId(null)
    }
  }

  async function removeLead(lead: Lead) {
    const ok = await confirm({ title: 'Delete this lead?', message: `“${lead.plant?.plantName ?? 'This lead'}” and its history will be deleted. This can’t be undone.`, confirmLabel: 'Delete lead', danger: true })
    if (!ok) return
    setBusyId(lead.id)
    try {
      await api(`/leads/${lead.id}`, { method: 'DELETE', auth: true })
      setLeads(prev => prev.filter(l => l.id !== lead.id))
      setSelectedLead(prev => (prev && prev.id === lead.id ? null : prev))
      setError(null)
      toast('Lead deleted')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete lead.')
    } finally {
      setBusyId(null)
    }
  }

  const view = useTableView<EmployeeUser>({
    id: 'team',
    rows: users,
    search: u => [nameOf(u), u.email, u.department, u.phoneNumber, u.role].join(' '),
    views: [
      { id: 'active', label: 'Active', match: u => u.isActive },
      { id: 'removed', label: 'Removed', match: u => !u.isActive },
      { id: 'all', label: 'All' },
    ],
    filters: [
      { id: 'role', label: 'Role', value: u => ROLE_INFO[u.role as Role]?.label ?? u.role, order: ROLE_LIST.map(r => ROLE_INFO[r].label) },
      { id: 'department', label: 'Department', value: u => u.department },
    ],
    sorts: {
      person: { value: u => nameOf(u) },
      department: { value: u => u.department },
      role: { value: u => u.role },
      leads: { value: u => assignedTo(u).length, firstDir: 'desc' },
    },
    defaultSort: { id: 'person', dir: 'asc' },
  })

  const columns: Column<EmployeeUser>[] = [
    {
      id: 'person', header: 'Person', sticky: true, className: 'min-w-[240px]',
      cell: u => (
        <div className={`flex min-w-0 items-center gap-2.5 ${u.isActive ? '' : 'opacity-60'}`}>
          <Avatar name={nameOf(u)} size={30} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
              {nameOf(u)}
              {u.id === currentUserId && <span className="ml-1.5 text-xs font-normal text-gray-400">(you)</span>}
            </p>
            <p className="truncate text-xs text-gray-500 dark:text-gray-400">{u.email}</p>
          </div>
        </div>
      ),
    },
    { id: 'department', header: 'Department', cell: u => u.department || <span className="text-gray-400">—</span> },
    { id: 'role', header: 'Role', cell: u => (u.isActive ? <RolePill role={u.role} /> : <span className="text-xs font-medium text-gray-400">Removed</span>) },
    {
      id: 'leads', header: 'Leads', align: 'right',
      cell: u => {
        const n = assignedTo(u).length
        return n ? n : <span className="text-gray-300 dark:text-gray-600">0</span>
      },
    },
  ]

  const open = users.find(u => u.id === openId) ?? null

  const actionsFor = (u: EmployeeUser): (RowAction | false)[] => u.isActive ? [
    { label: 'Change email…', onSelect: () => setEmailFor(u) },
    ...(u.id !== currentUserId ? ROLE_LIST.filter(r => r !== u.role).map(r => ({ label: `Make ${ROLE_INFO[r].label}`, disabled: busyId === u.id, onSelect: () => changeRole(u, r) })) : []),
    u.role !== ROLES.admin && { label: 'Remove…', danger: true, disabled: busyId === u.id, onSelect: () => removeEmployee(u) },
  ] : [
    { label: 'Reactivate', disabled: busyId === u.id, onSelect: () => reactivateEmployee(u) },
  ]

  return (
    <div className={PAGE_CLASS}>
      <PageHeader
        title="Team"
        subtitle={loading ? 'Loading…' : `${activeCount} registered employee${activeCount === 1 ? '' : 's'}${unassignedCount > 0 ? ` · ${unassignedCount} lead${unassignedCount === 1 ? '' : 's'} unassigned` : ''}`}
      >
        <NewButton label="Add employee" onClick={() => setShowCreate(true)} />
      </PageHeader>

      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <TableToolbar view={view} noun="people" exportCsv={{ filename: 'team', columns: columns }} placeholder="Search name, email, department…">
          <RefreshButton onClick={reload} busy={loading} />
        </TableToolbar>

        {error && <ErrorBanner message={error} onRetry={reload} />}

        {loading && users.length === 0 ? (
          <SkeletonRows rows={4} />
        ) : users.length === 0 && !error ? (
          <EmptyState icon="users" title="No employees registered yet" message="Add your sales team, then assign them leads." action={{ label: 'Add employee', onClick: () => setShowCreate(true) }} />
        ) : (
          <>
            <DataGrid
              columns={columns}
              rows={view.rows}
              getKey={u => u.id}
              view={view}
              onRowClick={u => setOpenId(u.id)}
              rowLabel={u => `Open ${nameOf(u)}`}
              actions={u => <RowMenu label={nameOf(u)} actions={actionsFor(u)} />}
              empty={<NoMatches noun="people" onClear={view.clearFilters} />}
              minWidth={640}
            />
            <TableFooter view={view} />
          </>
        )}
      </div>

      {open && (
        <Drawer
          label={nameOf(open)}
          onClose={() => setOpenId(null)}
          size="md"
          header={
            <div className="flex items-center gap-3 pr-10">
              <Avatar name={nameOf(open)} size={44} />
              <div className="min-w-0">
                <h2 className="truncate text-lg font-bold text-gray-900 dark:text-gray-100">{nameOf(open)}</h2>
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  {open.isActive ? <RolePill role={open.role} /> : <span className="text-xs font-medium text-gray-400">Removed — can’t sign in</span>}
                  {open.department && <span className="text-xs text-gray-500 dark:text-gray-400">{open.department}</span>}
                </div>
              </div>
            </div>
          }
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              {actionsFor(open).filter((a): a is RowAction => !!a).map(a => (
                <button key={a.label} type="button" disabled={a.disabled} onClick={a.onSelect} className={btn(a.danger ? 'danger' : a.label === 'Reactivate' ? 'primary' : 'secondary', 'md')}>
                  {a.label.replace('…', '')}
                </button>
              ))}
            </div>
          }
        >
          <div className="px-6 py-5">
          <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-2.5 text-sm">
            <dt className="text-gray-500 dark:text-gray-400">Email</dt>
            <dd className="break-all text-gray-900 dark:text-gray-100">{open.email}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Phone</dt>
            <dd className="text-gray-900 dark:text-gray-100">{open.phoneNumber || <span className="text-gray-400">—</span>}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Department</dt>
            <dd className="text-gray-900 dark:text-gray-100">{open.department || <span className="text-gray-400">—</span>}</dd>
          </dl>

          <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Assigned leads · {assignedTo(open).length}
          </h3>
          {assignedTo(open).length === 0 ? (
            <p className="rounded-xl bg-gray-50 px-3 py-3 text-sm text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
              {!isAssignableRole(open.role) ? `${ROLE_INFO[open.role as Role]?.label ?? 'This role'} team members aren’t assigned leads.` : 'No leads assigned yet.'}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100 dark:divide-gray-800 dark:border-gray-800">
              {assignedTo(open).map(lead => (
                <li key={lead.id} className="flex items-center gap-3 px-3 py-2.5">
                  <button type="button" onClick={() => setSelectedLead(lead)} className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-orange-300">
                    <p className="truncate text-sm font-medium text-gray-800 hover:text-orange-600 dark:text-gray-200 dark:hover:text-orange-300">{lead.plant?.plantName ?? '—'}</p>
                    <p className="truncate text-xs text-gray-400">{lead.plant?.client?.clientName ? `${lead.plant.client.clientName} · ` : ''}Updated <RelTime ts={lead.updatedAt} /></p>
                  </button>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusStyle(lead.status?.statusName)}`}>
                    {lead.status?.statusName ?? 'Cold call'}
                  </span>
                  <RowMenu label={lead.plant?.plantName ?? 'lead'} actions={[
                    { label: 'Open lead', onSelect: () => setSelectedLead(lead) },
                    { label: 'Delete lead…', danger: true, disabled: busyId === lead.id, onSelect: () => removeLead(lead) },
                  ]} />
                </li>
              ))}
            </ul>
          )}
          </div>
        </Drawer>
      )}

      {emailFor && (
        <ChangeEmailModal
          user={emailFor}
          onClose={() => setEmailFor(null)}
          onSaved={user => { setUsers(prev => prev.map(u => (u.id === user.id ? user : u))); setEmailFor(null); toast(`Email changed to ${user.email}`) }}
        />
      )}

      {selectedLead && <LeadDetailModal lead={selectedLead} onClose={() => setSelectedLead(null)} />}
      {confirmDialog}

      {showCreate && (
        <CreatePanel
          title="Add employee"
          subtitle="They can sign in straight away — with Microsoft, using this email address."
          onClose={() => { setShowCreate(false); setFieldErrors({}) }}
          onSubmit={createEmployee}
          saving={creatingEmp}
          submitLabel="Add employee"
          savingLabel="Adding…"
          error={empError}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Email" required error={fieldErrors.email}>
              <input type="email" value={empForm.email} onChange={e => { setEmpForm({ ...empForm, email: e.target.value }); setFieldErrors({}) }} placeholder="name@company.com" aria-invalid={!!fieldErrors.email || undefined} className={inputCls(!!fieldErrors.email)} />
            </Field>
            <Field label="Name">
              <input value={empForm.userName} onChange={e => setEmpForm({ ...empForm, userName: e.target.value })} placeholder="Full name" className={inputCls()} />
            </Field>
            <Field label="Role">
              <SearchSelect value={empForm.role} onChange={v => setEmpForm({ ...empForm, role: v as Role })} options={ROLE_LIST.map(r => ({ value: r, label: ROLE_INFO[r].label, hint: ROLE_INFO[r].hint }))} label="Role" />
            </Field>
            <Field label="Department">
              <input value={empForm.department} onChange={e => setEmpForm({ ...empForm, department: e.target.value })} placeholder="e.g. Sales" className={inputCls()} />
            </Field>
            <Field label="Phone">
              <input value={empForm.phoneNumber} onChange={e => setEmpForm({ ...empForm, phoneNumber: e.target.value })} placeholder="+91-…" className={inputCls()} />
            </Field>
          </div>
        </CreatePanel>
      )}
    </div>
  )
}

// Changing someone's email — mainly moving people onto their company
// Microsoft address, which "Sign in with Microsoft" matches on.
function ChangeEmailModal({ user, onClose, onSaved }: { user: EmployeeUser; onClose: () => void; onSaved: (user: EmployeeUser) => void }) {
  const [email, setEmail] = useState(user.email)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const next = email.trim()
    if (!EMAIL_RE.test(next)) { setError('Enter an email like name@company.com.'); focusFirstInvalid(); return }
    setSaving(true)
    setError(null)
    try {
      const { user: saved } = await api<{ user: EmployeeUser }>(`/users/${user.id}/email`, { method: 'PATCH', auth: true, body: { email: next } })
      onSaved(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the email.')
      setSaving(false)
    }
  }

  return (
    <Modal title="Change email" subtitle={nameOf(user)} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="New email" error={error ?? undefined} hint="They’ll sign in with this address from now on. Any Microsoft account already linked to them is unlinked.">
          <input type="email" value={email} onChange={e => { setEmail(e.target.value); setError(null) }} placeholder="name@sixdengineering.com" autoFocus aria-invalid={!!error || undefined} className={inputCls(!!error)} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btn('secondary', 'md')}>Cancel</button>
          <button type="submit" disabled={saving || email.trim() === user.email} className={btn('primary', 'md')}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  )
}

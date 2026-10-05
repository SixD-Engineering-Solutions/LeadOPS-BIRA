import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import type { EmployeeUser, Lead } from '../lib/api'
import LeadDetailModal from '../components/LeadDetailModal'
import { ErrorBanner } from '../components/ErrorBanner'
import { EmptyState } from '../components/EmptyState'
import { SkeletonRows } from '../components/Skeleton'
import { LEAD_STATUS_STYLES, DEFAULT_STATUS_STYLE } from '../lib/statusStyles'

/** Turn an email into a display name: "jane.doe@x.com" -> "Jane Doe". */
function displayName(email: string): string {
  const raw = email.split('@')[0].replace(/[._-]+/g, ' ').trim()
  return raw.replace(/\b\w/g, c => c.toUpperCase()) || 'User'
}

function initials(name: string): string {
  const parts = name.split(' ').filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'U'
}

const statusStyle = (name: string | null | undefined) => LEAD_STATUS_STYLES[name ?? ''] ?? DEFAULT_STATUS_STYLE
const fmt = (ts: string) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const inputCls = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'
const emptyEmpForm = { email: '', userName: '', role: 'employee' as 'employee' | 'admin', department: '', phoneNumber: '' }

export default function Team({ currentUserId }: { currentUserId: string }) {
  // Includes removed (isActive: false) accounts too — this page is admin-only,
  // and an admin needs to see who's removed in order to reactivate them.
  const [users, setUsers] = useState<EmployeeUser[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [reactivatingId, setReactivatingId] = useState<string | null>(null)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [deletingLeadId, setDeletingLeadId] = useState<string | null>(null)

  const [empForm, setEmpForm] = useState({ ...emptyEmpForm })
  const [creatingEmp, setCreatingEmp] = useState(false)
  const [empError, setEmpError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [{ users }, { leads }] = await Promise.all([
        api<{ users: EmployeeUser[] }>('/users?includeInactive=true', { auth: true }),
        api<{ leads: Lead[] }>('/leads', { auth: true }),
      ])
      setUsers(users)
      setLeads(leads)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load employees.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const activeUsers = users.filter(u => u.isActive)
  const removedUsers = users.filter(u => !u.isActive)

  async function createEmployee(e: React.FormEvent) {
    e.preventDefault()
    setEmpError(null)
    if (!empForm.email.trim()) { setEmpError('Email is required.'); return }
    setCreatingEmp(true)
    try {
      const { user } = await api<{ user: EmployeeUser }>('/users', {
        method: 'POST',
        auth: true,
        body: {
          email: empForm.email.trim(),
          userName: empForm.userName.trim() || undefined,
          role: empForm.role,
          department: empForm.department.trim() || undefined,
          phoneNumber: empForm.phoneNumber.trim() || undefined,
        },
      })
      setUsers(prev => [user, ...prev])
      setEmpForm({ ...emptyEmpForm })
    } catch (e) {
      setEmpError(e instanceof Error ? e.message : 'Could not add employee.')
    } finally {
      setCreatingEmp(false)
    }
  }

  async function removeEmployee(id: string, name: string) {
    if (!confirm(`Remove ${name}? They'll be signed out of the team and can no longer log in. Their lead history is kept.`)) return
    setDeletingId(id)
    try {
      await api(`/users/${id}`, { method: 'DELETE', auth: true })
      setUsers(prev => prev.map(u => (u.id === id ? { ...u, isActive: false } : u)))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove employee.')
    } finally {
      setDeletingId(null)
    }
  }

  // Two roles: admin (full access) and employee (their own assigned work).
  // The server enforces it on every request; this just asks for it. Promoting
  // unassigns the person's leads (admins are never assignees) — the prompt
  // says so first; the server refuses if they still hold open tasks/projects.
  const [changingRoleId, setChangingRoleId] = useState<string | null>(null)
  async function changeRole(u: EmployeeUser, role: 'admin' | 'employee', assignedCount: number) {
    const name = u.userName || displayName(u.email)
    const message = role === 'admin'
      ? `Make ${name} an admin?\n\nThey'll get full admin access: every lead, Reports, Team, deleting records and managing roles.` +
        (assignedCount > 0 ? `\n\nTheir ${assignedCount} assigned lead${assignedCount === 1 ? '' : 's'} will become Unassigned — admins aren't assigned leads — so you can hand ${assignedCount === 1 ? 'it' : 'them'} to someone else.` : '')
      : `Make ${name} an employee?\n\nThey'll lose admin access and only see the leads assigned to them.`
    if (!confirm(message)) return
    setChangingRoleId(u.id)
    try {
      const res = await api<{ user: EmployeeUser; unassignedLeads: number }>(`/users/${u.id}/role`, { method: 'PATCH', auth: true, body: { role } })
      setUsers(prev => prev.map(x => (x.id === u.id ? res.user : x)))
      if (res.unassignedLeads > 0) {
        // Their leads are now unassigned — refresh so the counts are right.
        const { leads } = await api<{ leads: Lead[] }>('/leads', { auth: true })
        setLeads(leads)
      }
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the role.')
    } finally {
      setChangingRoleId(null)
    }
  }

  // Changing someone's email — mainly moving people onto their company
  // Microsoft address, which "Sign in with Microsoft" matches on.
  const [editingEmailId, setEditingEmailId] = useState<string | null>(null)
  const [emailDraft, setEmailDraft] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [savingEmail, setSavingEmail] = useState(false)
  function startEmailEdit(u: EmployeeUser) {
    setEditingEmailId(u.id)
    setEmailDraft(u.email)
    setEmailError(null)
  }
  async function saveEmail(id: string) {
    setSavingEmail(true)
    setEmailError(null)
    try {
      const { user } = await api<{ user: EmployeeUser }>(`/users/${id}/email`, { method: 'PATCH', auth: true, body: { email: emailDraft.trim() } })
      setUsers(prev => prev.map(u => (u.id === id ? user : u)))
      setEditingEmailId(null)
    } catch (e) {
      setEmailError(e instanceof Error ? e.message : 'Could not change the email.')
    } finally {
      setSavingEmail(false)
    }
  }

  async function reactivateEmployee(id: string) {
    setReactivatingId(id)
    try {
      const { user } = await api<{ user: EmployeeUser }>(`/users/${id}/reactivate`, { method: 'POST', auth: true })
      setUsers(prev => prev.map(u => (u.id === id ? user : u)))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reactivate employee.')
    } finally {
      setReactivatingId(null)
    }
  }

  async function removeLead(id: string) {
    if (!confirm('Delete this lead? This cannot be undone.')) return
    setDeletingLeadId(id)
    try {
      await api(`/leads/${id}`, { method: 'DELETE', auth: true })
      setLeads(prev => prev.filter(l => l.id !== id))
      setSelectedLead(prev => (prev && prev.id === id ? null : prev))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete lead.')
    } finally {
      setDeletingLeadId(null)
    }
  }

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
  const unassignedCount = leads.filter(l => !l.assignedToUserId).length

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Employees</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {loading ? 'Loading…' : `${activeUsers.length} registered employee${activeUsers.length === 1 ? '' : 's'}${unassignedCount > 0 ? ` · ${unassignedCount} lead${unassignedCount === 1 ? '' : 's'} unassigned` : ''}`}
          </p>
        </div>
        <button onClick={load} className="text-xs font-medium text-orange-500 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-300">Refresh</button>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} className="mb-5" />}

      <form onSubmit={createEmployee} className="mb-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h3 className="mb-3 text-sm font-bold text-gray-900 dark:text-gray-100">Add employee</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            Email *
            <input type="email" value={empForm.email} onChange={e => setEmpForm({ ...empForm, email: e.target.value })} placeholder="name@company.com" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            Name
            <input value={empForm.userName} onChange={e => setEmpForm({ ...empForm, userName: e.target.value })} placeholder="Full name" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            Role
            <select value={empForm.role} onChange={e => setEmpForm({ ...empForm, role: e.target.value as 'employee' | 'admin' })} className={inputCls}>
              <option value="employee">Employee</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            Department
            <input value={empForm.department} onChange={e => setEmpForm({ ...empForm, department: e.target.value })} placeholder="e.g. Sales" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            Phone
            <input value={empForm.phoneNumber} onChange={e => setEmpForm({ ...empForm, phoneNumber: e.target.value })} placeholder="+91-…" className={inputCls} />
          </label>
        </div>
        {empError && <p className="mt-2 text-xs text-red-500 dark:text-red-400">{empError}</p>}
        <div className="mt-3">
          <button type="submit" disabled={creatingEmp} className="rounded-xl bg-gradient-to-r from-rose-400 to-orange-400 px-5 py-2 text-sm font-semibold text-white transition hover:from-rose-500 hover:to-orange-500 disabled:opacity-60">
            {creatingEmp ? 'Adding…' : 'Add Employee'}
          </button>
        </div>
      </form>

      {loading ? (
        <div className="rounded-2xl border border-gray-100 bg-white dark:border-gray-800 dark:bg-gray-900"><SkeletonRows rows={4} /></div>
      ) : activeUsers.length === 0 ? (
        <EmptyState icon="users" title="No employees registered yet" message="Add your sales team with “Add employee” above, then assign them leads." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {activeUsers.map(u => {
              const name = u.userName || displayName(u.email)
              const isAdmin = u.role === 'admin'
              const assigned = leadsByUser.get(u.id) ?? []
              const isExpanded = expandedId === u.id
              return (
                <li key={u.id}>
                  <div className="flex w-full items-center gap-3 px-5 py-3.5 transition hover:bg-gray-50 dark:hover:bg-gray-800/60">
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : u.id)}
                      disabled={assigned.length === 0}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-rose-400 to-orange-400 text-sm font-semibold text-white">
                        {initials(name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{name}</p>
                        <p className="truncate text-xs text-gray-500 dark:text-gray-400">{u.email}</p>
                      </div>
                      {u.department && (
                        <span className="hidden shrink-0 text-xs text-gray-400 dark:text-gray-400 sm:block">{u.department}</span>
                      )}
                      <span
                        className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold
                          ${assigned.length > 0 ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' : 'text-gray-300 dark:text-gray-600'}`}
                      >
                        {assigned.length} lead{assigned.length === 1 ? '' : 's'}
                      </span>
                      <span
                        className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize
                          ${isAdmin ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-300' : 'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300'}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${isAdmin ? 'bg-orange-500' : 'bg-sky-500'}`} />
                        {u.role}
                      </span>
                      {assigned.length > 0 && (
                        <svg className={`h-4 w-4 shrink-0 text-gray-300 transition dark:text-gray-600 ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => (editingEmailId === u.id ? setEditingEmailId(null) : startEmailEdit(u))}
                      className="shrink-0 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:border-orange-300 hover:text-orange-600 dark:border-gray-700 dark:text-gray-300 dark:hover:border-orange-500 dark:hover:text-orange-300"
                    >
                      Change email
                    </button>
                    {u.id === currentUserId ? (
                      <span className="shrink-0 text-xs text-gray-400 dark:text-gray-400">You</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => changeRole(u, isAdmin ? 'employee' : 'admin', assigned.length)}
                        disabled={changingRoleId === u.id}
                        className="shrink-0 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:border-orange-300 hover:text-orange-600 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:border-orange-500 dark:hover:text-orange-300"
                      >
                        {changingRoleId === u.id ? 'Saving…' : isAdmin ? 'Make employee' : 'Make admin'}
                      </button>
                    )}
                    {!isAdmin && (
                      <button
                        type="button"
                        onClick={() => removeEmployee(u.id, name)}
                        disabled={deletingId === u.id}
                        className="shrink-0 text-xs font-medium text-red-400 hover:text-red-600 disabled:opacity-50 dark:text-red-500 dark:hover:text-red-400"
                      >
                        {deletingId === u.id ? 'Removing…' : 'Remove'}
                      </button>
                    )}
                  </div>

                  {editingEmailId === u.id ? (
                    <form
                      onSubmit={e => { e.preventDefault(); saveEmail(u.id) }}
                      className="flex flex-wrap items-center gap-2 border-t border-gray-100 bg-gray-50/60 px-5 py-3 dark:border-gray-800 dark:bg-gray-800/30"
                    >
                      <label htmlFor={`email-${u.id}`} className="text-xs font-medium text-gray-600 dark:text-gray-400">New email</label>
                      <input
                        id={`email-${u.id}`}
                        type="email"
                        value={emailDraft}
                        onChange={e => setEmailDraft(e.target.value)}
                        placeholder="name@sixdengineering.com"
                        autoFocus
                        className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                      />
                      <button type="submit" disabled={savingEmail} className="rounded-lg bg-gradient-to-r from-rose-400 to-orange-400 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
                        {savingEmail ? 'Saving…' : 'Save'}
                      </button>
                      <button type="button" onClick={() => setEditingEmailId(null)} className="text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                        Cancel
                      </button>
                      {emailError && <p className="w-full text-xs text-red-500 dark:text-red-400">{emailError}</p>}
                      <p className="w-full text-[11px] text-gray-400 dark:text-gray-400">They’ll sign in with this address from now on. Any Microsoft account already linked to them is unlinked.</p>
                    </form>
                  ) : null}

                  {isExpanded && assigned.length > 0 && (
                    <ul className="border-t border-gray-100 bg-gray-50/60 px-5 py-2 dark:border-gray-800 dark:bg-gray-800/30">
                      {assigned.map(lead => (
                        <li
                          key={lead.id}
                          onClick={() => setSelectedLead(lead)}
                          className="flex cursor-pointer items-center justify-between gap-3 rounded-lg py-2 px-2 -mx-2 text-sm transition hover:bg-gray-100 dark:hover:bg-gray-800/60"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium text-gray-800 dark:text-gray-200">{lead.plant?.plantName ?? '—'}</p>
                            <p className="truncate text-xs text-gray-400 dark:text-gray-400">Updated {fmt(lead.updatedAt)}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusStyle(lead.status?.statusName)}`}>
                              {lead.status?.statusName ?? 'Submitted'}
                            </span>
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); removeLead(lead.id) }}
                              disabled={deletingLeadId === lead.id}
                              className="text-xs font-medium text-red-400 hover:text-red-600 disabled:opacity-50 dark:text-red-500 dark:hover:text-red-400"
                            >
                              {deletingLeadId === lead.id ? 'Deleting…' : 'Delete'}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {removedUsers.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="border-b border-gray-100 px-5 py-3 dark:border-gray-800">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Removed</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">Signed out and can no longer log in — reactivate to restore access.</p>
          </div>
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {removedUsers.map(u => {
              const name = u.userName || displayName(u.email)
              return (
                <li key={u.id} className="flex items-center gap-3 px-5 py-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-200 text-sm font-semibold text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                    {initials(name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-500 dark:text-gray-400">{name}</p>
                    <p className="truncate text-xs text-gray-400 dark:text-gray-400">{u.email}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => reactivateEmployee(u.id)}
                    disabled={reactivatingId === u.id}
                    className="shrink-0 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400 dark:hover:bg-emerald-900/40"
                  >
                    {reactivatingId === u.id ? 'Reactivating…' : 'Reactivate'}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {selectedLead && <LeadDetailModal lead={selectedLead} onClose={() => setSelectedLead(null)} />}
    </div>
  )
}

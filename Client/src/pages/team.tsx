import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import type { EmployeeUser, Lead } from '../lib/api'

/** Turn an email into a display name: "jane.doe@x.com" -> "Jane Doe". */
function displayName(email: string): string {
  const raw = email.split('@')[0].replace(/[._-]+/g, ' ').trim()
  return raw.replace(/\b\w/g, c => c.toUpperCase()) || 'User'
}

function initials(name: string): string {
  const parts = name.split(' ').filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'U'
}

const STATUS_STYLES: Record<string, string> = {
  Submitted: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  'In Process': 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  Dead: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
}
const statusStyle = (name: string | null | undefined) => STATUS_STYLES[name ?? ''] ?? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
const fmt = (ts: string) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

export default function Team() {
  const [users, setUsers] = useState<EmployeeUser[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [{ users }, { leads }] = await Promise.all([
        api<{ users: EmployeeUser[] }>('/users', { auth: true }),
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

  async function removeEmployee(id: string, name: string) {
    if (!confirm(`Remove ${name}? They'll be signed out of the team and can no longer log in. Their lead history is kept.`)) return
    setDeletingId(id)
    try {
      await api(`/users/${id}`, { method: 'DELETE', auth: true })
      setUsers(prev => prev.filter(u => u.id !== id))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove employee.')
    } finally {
      setDeletingId(null)
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
            {loading ? 'Loading…' : `${users.length} registered employee${users.length === 1 ? '' : 's'}${unassignedCount > 0 ? ` · ${unassignedCount} lead${unassignedCount === 1 ? '' : 's'} unassigned` : ''}`}
          </p>
        </div>
        <button onClick={load} className="text-xs font-medium text-orange-500 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-300">Refresh</button>
      </div>

      {error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">{error}</div>}

      {loading ? (
        <p className="py-16 text-center text-sm text-gray-400 dark:text-gray-500">Loading employees…</p>
      ) : users.length === 0 ? (
        <p className="py-16 text-center text-sm text-gray-400 dark:text-gray-500">No employees registered yet.</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {users.map(u => {
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
                        <span className="hidden shrink-0 text-xs text-gray-400 dark:text-gray-500 sm:block">{u.department}</span>
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

                  {isExpanded && assigned.length > 0 && (
                    <ul className="border-t border-gray-100 bg-gray-50/60 px-5 py-2 dark:border-gray-800 dark:bg-gray-800/30">
                      {assigned.map(lead => (
                        <li key={lead.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-gray-800 dark:text-gray-200">{lead.plant?.plantName ?? '—'}</p>
                            <p className="truncate text-xs text-gray-400 dark:text-gray-500">Updated {fmt(lead.updatedAt)}</p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusStyle(lead.status?.statusName)}`}>
                            {lead.status?.statusName ?? 'Submitted'}
                          </span>
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
    </div>
  )
}

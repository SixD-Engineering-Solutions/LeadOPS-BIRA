import { useEffect, useState } from 'react'
import { api, LEAD_SYNC_EVENT } from '../lib/api'
import type { Lead, EmployeeUser } from '../lib/api'

export type LeadStats = {
  total: number
  active: number
  conversion: number
  converted: number
  weekAdded: number
  spark: number[]
  counts: { submitted: number; inProcess: number; dead: number }
  loaded: boolean
}

const EMPTY_STATS: LeadStats = {
  total: 0, active: 0, conversion: 0, converted: 0, weekAdded: 0,
  spark: [], counts: { submitted: 0, inProcess: 0, dead: 0 }, loaded: false,
}

// Live lead stats for the dashboard tiles, plus the raw leads + employees
// (kept alongside the derived stats so the "Total Leads" tile can show who
// each one is assigned to). Admin-only: who has what assigned is
// workforce-management info, not something every employee should see about
// their teammates — but the endpoint call is cheap to make either way since
// the server itself enforces the actual visibility rule.
export function useLeadStats(active: boolean, isAdmin: boolean) {
  const [stats, setStats] = useState<LeadStats>(EMPTY_STATS)
  const [allLeads, setAllLeads] = useState<Lead[]>([])
  const [employees, setEmployees] = useState<EmployeeUser[]>([])
  const [error, setError] = useState<string | null>(null)

  function reload() {
    return Promise.all([
      api<{ leads: Lead[] }>('/leads', { auth: true }),
      isAdmin ? api<{ users: EmployeeUser[] }>('/users', { auth: true }) : Promise.resolve({ users: [] as EmployeeUser[] }),
    ])
      .then(([{ leads }, { users }]) => {
        setAllLeads(leads)
        setEmployees(users)
        const total = leads.length
        const byName = (n: string) => leads.filter(l => l.status?.statusName === n).length
        const inProcess = byName('In Process')
        // "Converted" = progressed beyond the initial stage (In Progress or a Won/completed category).
        const converted = leads.filter(l => {
          const c = l.status?.statusCategory
          return c === 'In Progress' || c === 'Closed Won'
        }).length
        // Cumulative leads created over the last 7 days → a naturally upward line.
        const now = new Date()
        const spark = Array.from({ length: 7 }, (_, i) => {
          const end = new Date(now)
          end.setDate(now.getDate() - (6 - i))
          end.setHours(23, 59, 59, 999)
          return leads.filter(l => new Date(l.createdAt) <= end).length
        })
        const weekAgo = new Date(now)
        weekAgo.setDate(now.getDate() - 7)
        const weekAdded = leads.filter(l => new Date(l.createdAt) >= weekAgo).length
        setStats({
          total, active: inProcess,
          conversion: total ? Math.round((converted / total) * 1000) / 10 : 0,
          converted, weekAdded,
          spark,
          counts: { submitted: byName('Submitted'), inProcess, dead: byName('Dead') },
          loaded: true,
        })
        setError(null)
      })
      .catch(e => {
        setStats(EMPTY_STATS)
        setError(e instanceof Error ? e.message : 'Failed to load lead stats.')
      })
  }

  useEffect(() => {
    if (!active) return
    reload()
  }, [active, isAdmin])

  // Live updates — a lead created/updated/deleted anywhere (by this admin on
  // another tab, or by anyone else) pings every connected client over SSE (see
  // NotificationBell). Re-pull the stats so the tiles don't go stale while the
  // dashboard is sitting open.
  useEffect(() => {
    function onLeadSync() {
      if (active) reload()
    }
    window.addEventListener(LEAD_SYNC_EVENT, onLeadSync)
    return () => window.removeEventListener(LEAD_SYNC_EVENT, onLeadSync)
  }, [active, isAdmin])

  return { stats, allLeads, employees, error, reload }
}

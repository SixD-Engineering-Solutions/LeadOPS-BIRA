import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Lead, Proposal, EmployeeUser } from '../lib/api'
import WeeklyLineChart from '../components/WeeklyLineChart'

const WEEKS = 8
const MONTHS = 6

// Combined weekly trend: leads generated (all) vs submitted, bucketed into the
// last N rolling 7-day windows by `createdAt`.
function weeklyTrend(leads: Lead[]) {
  const now = new Date()
  now.setHours(23, 59, 59, 999)
  return Array.from({ length: WEEKS }, (_, i) => {
    const end = new Date(now)
    end.setDate(now.getDate() - (WEEKS - 1 - i) * 7)
    const start = new Date(end)
    start.setDate(end.getDate() - 6)
    start.setHours(0, 0, 0, 0)
    const inWeek = leads.filter(l => {
      const d = new Date(l.createdAt)
      return d >= start && d <= end
    })
    return {
      week: start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      generated: inWeek.length,
      submitted: inWeek.filter(l => l.status?.statusName === 'Submitted').length,
    }
  })
}

// Won vs Lost proposal value per calendar month, last N months. Uses
// `updatedAt` as a proxy for "when it was decided" — there's no dedicated
// wonDate/lostDate field, and status changes are what bump updatedAt.
function monthlyPerformance(proposals: Proposal[]) {
  const now = new Date()
  return Array.from({ length: MONTHS }, (_, i) => {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - (MONTHS - 1 - i), 1)
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1)
    const inMonth = (p: Proposal) => {
      const u = new Date(p.updatedAt)
      return u >= monthStart && u < monthEnd
    }
    const won = proposals.filter(p => p.status === 'Won' && inMonth(p))
    const lost = proposals.filter(p => p.status === 'Lost' && inMonth(p))
    return {
      month: monthStart.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
      won: won.reduce((sum, p) => sum + (p.value ?? 0), 0),
      lost: lost.reduce((sum, p) => sum + (p.value ?? 0), 0),
    }
  })
}

type EmployeeRow = { user: EmployeeUser; leadsAssigned: number; won: number; lost: number; conversion: number; wonValue: number }

function employeePerformance(leads: Lead[], proposals: Proposal[], employees: EmployeeUser[]): EmployeeRow[] {
  const leadOwner = new Map(leads.map(l => [l.id, l.assignedToUserId]))
  return employees
    .map(user => {
      const leadsAssigned = leads.filter(l => l.assignedToUserId === user.id).length
      const ownProposals = proposals.filter(p => leadOwner.get(p.leadId) === user.id)
      const won = ownProposals.filter(p => p.status === 'Won')
      const lost = ownProposals.filter(p => p.status === 'Lost')
      const conversion = ownProposals.length ? Math.round((won.length / ownProposals.length) * 100) : 0
      const wonValue = won.reduce((sum, p) => sum + (p.value ?? 0), 0)
      return { user, leadsAssigned, won: won.length, lost: lost.length, conversion, wonValue }
    })
    .filter(row => row.leadsAssigned > 0)
    .sort((a, b) => b.wonValue - a.wonValue)
}

export default function Reports() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [employees, setEmployees] = useState<EmployeeUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [{ leads }, { proposals }, { users }] = await Promise.all([
        api<{ leads: Lead[] }>('/leads', { auth: true }),
        api<{ proposals: Proposal[] }>('/proposals', { auth: true }),
        api<{ users: EmployeeUser[] }>('/users', { auth: true }),
      ])
      setLeads(leads)
      setProposals(proposals)
      setEmployees(users.filter(u => u.role !== 'admin'))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reports.')
      setLeads([]) // don't let the charts keep showing a previous fetch's data behind the error
      setProposals([])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const weekly = weeklyTrend(leads)
  const monthly = monthlyPerformance(proposals)
  const employeeRows = employeePerformance(leads, proposals, employees)

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Reports</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Lead activity, monthly performance, and team conversion.</p>
        </div>
        <button onClick={load} className="text-xs font-medium text-orange-500 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-300">Refresh</button>
      </div>

      {error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">{error}</div>}

      {loading ? (
        <p className="py-16 text-center text-sm text-gray-400 dark:text-gray-500">Loading reports…</p>
      ) : (
        <div className="space-y-5">
          <WeeklyLineChart
            title="Leads Generated vs Submitted"
            subtitle="New leads created each week and how many are in Submitted status"
            data={weekly}
            xKey="week"
            series={[
              { key: 'generated', name: 'Generated', color: '#6366f1' },
              { key: 'submitted', name: 'Submitted', color: '#f97316' },
            ]}
          />

          <WeeklyLineChart
            title="Monthly Performance"
            subtitle="Won vs Lost proposal value by month"
            data={monthly}
            xKey="month"
            periodLabel="Month of"
            series={[
              { key: 'won', name: 'Won (₹)', color: '#10b981' },
              { key: 'lost', name: 'Lost (₹)', color: '#f43f5e' },
            ]}
          />

          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="border-b border-gray-100 px-5 py-3 dark:border-gray-800">
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Employee Performance</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">Leads, proposal outcomes and conversion by team member.</p>
            </div>
            {employeeRows.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-gray-400 dark:text-gray-500">No leads assigned to anyone yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs uppercase tracking-wider text-gray-400 dark:border-gray-800 dark:text-gray-500">
                      <th className="px-5 py-3 font-semibold">Employee</th>
                      <th className="px-3 py-3 font-semibold">Leads Assigned</th>
                      <th className="px-3 py-3 font-semibold">Won</th>
                      <th className="px-3 py-3 font-semibold">Lost</th>
                      <th className="px-3 py-3 font-semibold">Conversion</th>
                      <th className="px-3 py-3 font-semibold">Won Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employeeRows.map(row => (
                      <tr key={row.user.id} className="border-b border-gray-50 dark:border-gray-800">
                        <td className="px-5 py-3 font-medium text-gray-900 dark:text-gray-100">{row.user.userName || row.user.email}</td>
                        <td className="px-3 py-3 text-gray-600 dark:text-gray-400">{row.leadsAssigned}</td>
                        <td className="px-3 py-3 text-emerald-600 dark:text-emerald-400">{row.won}</td>
                        <td className="px-3 py-3 text-rose-500 dark:text-rose-400">{row.lost}</td>
                        <td className="px-3 py-3 text-gray-600 dark:text-gray-400">{row.conversion}%</td>
                        <td className="px-3 py-3 font-medium text-gray-900 dark:text-gray-100">₹{row.wonValue.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

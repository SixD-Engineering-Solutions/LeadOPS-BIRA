import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Lead } from '../lib/api'
import WeeklyLineChart from '../components/WeeklyLineChart'

const WEEKS = 8

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

export default function Reports() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const { leads } = await api<{ leads: Lead[] }>('/leads', { auth: true })
      setLeads(leads)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reports.')
      setLeads([]) // don't let the chart keep showing a previous fetch's data behind the error
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const data = weeklyTrend(leads)

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Reports</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Weekly lead activity over the last {WEEKS} weeks.</p>
        </div>
        <button onClick={load} className="text-xs font-medium text-orange-500 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-300">Refresh</button>
      </div>

      {error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">{error}</div>}

      {loading ? (
        <p className="py-16 text-center text-sm text-gray-400 dark:text-gray-500">Loading charts…</p>
      ) : (
        <WeeklyLineChart
          title="Leads Generated vs Submitted"
          subtitle="New leads created each week and how many are in Submitted status"
          data={data}
          xKey="week"
          series={[
            { key: 'generated', name: 'Generated', color: '#6366f1' },
            { key: 'submitted', name: 'Submitted', color: '#f97316' },
          ]}
        />
      )}
    </div>
  )
}

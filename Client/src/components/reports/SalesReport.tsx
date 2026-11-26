import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import type { Lead, Proposal } from '../../lib/api'
import WeeklyLineChart from '../WeeklyLineChart'
import { ErrorBanner } from '../ErrorBanner'
import { formatINR } from '../../lib/format'
import { Modal } from '../Modal'


// Compact ₹ for chart axes/tooltips (Indian lakh/crore convention, matching
// the Tracker page) — full "₹1,900,000"-style numbers are too wide for a
// Y-axis and force it to eat most of the chart's width.
function fmtCompactINR(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1e7) return `₹${(v / 1e7).toFixed(abs % 1e7 === 0 ? 0 : 1)}Cr`
  if (abs >= 1e5) return `₹${(v / 1e5).toFixed(abs % 1e5 === 0 ? 0 : 1)}L`
  if (abs >= 1e3) return `₹${(v / 1e3).toFixed(abs % 1e3 === 0 ? 0 : 1)}K`
  return `₹${v}`
}

// Combined weekly trend: leads generated (all) vs submitted, bucketed into the
// last N rolling 7-day windows by `createdAt`.
function weeklyTrend(leads: Lead[], WEEKS: number) {
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
      leads: inWeek, // for the click-through list; the chart only reads the keys above
      range: `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
    }
  })
}

// Won vs Lost proposal value per calendar month, last N months, by the date
// the proposal was decided (`decidedAt`).
function monthlyPerformance(proposals: Proposal[], MONTHS: number) {
  const now = new Date()
  return Array.from({ length: MONTHS }, (_, i) => {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - (MONTHS - 1 - i), 1)
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1)
    const inMonth = (p: Proposal) => {
      if (!p.decidedAt) return false
      const u = new Date(p.decidedAt)
      return u >= monthStart && u < monthEnd
    }
    const won = proposals.filter(p => p.status === 'Won' && inMonth(p))
    const lost = proposals.filter(p => p.status === 'Lost' && inMonth(p))
    return {
      month: monthStart.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
      won: won.reduce((sum, p) => sum + (p.value ?? 0), 0),
      lost: lost.reduce((sum, p) => sum + (p.value ?? 0), 0),
      proposals: [...won, ...lost], // for the click-through list
      label: monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    }
  })
}

const fmtDay = (ts: string | null) => (ts ? new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null)
const personName = (u?: { userName: string | null; email: string } | null) => (u ? u.userName || u.email : null)

// Opened by clicking a week in "Leads Generated vs Submitted".
function LeadsListModal({ title, leads, onClose }: { title: string; leads: Lead[]; onClose: () => void }) {
  const submitted = leads.filter(l => l.status?.statusName === 'Submitted').length
  return (
    <Modal title={title} subtitle={`${leads.length} lead${leads.length === 1 ? '' : 's'} generated · ${submitted} in Submitted`} onClose={onClose} width="lg" bodyClassName="px-5">
      {leads.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">No leads were created this week.</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {[...leads].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(l => {
            const where = [l.plant?.plantName, l.plant?.location?.city, l.sector?.sectorName, l.serviceType?.serviceTypeName].filter(Boolean).join(' · ')
            const meta = [fmtDay(l.createdAt), personName(l.assignedToUser) && `Assigned to ${personName(l.assignedToUser)}`, l.source?.sourceName].filter(Boolean).join('  ·  ')
            return (
              <li key={l.id} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{l.plant?.client?.clientName || l.plant?.companyName || l.plant?.plantName || 'Unnamed lead'}</p>
                  {l.status && <span className="shrink-0 rounded-full border border-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:border-gray-700 dark:text-gray-300">{l.status.statusName}</span>}
                </div>
                {where && <p className="truncate text-xs text-gray-500 dark:text-gray-400">{where}</p>}
                {meta && <p className="mt-1 text-[11px] text-gray-400">{meta}</p>}
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}

// Opened by clicking a month in "Monthly Performance".
function ProposalsListModal({ title, proposals, onClose }: { title: string; proposals: Proposal[]; onClose: () => void }) {
  const sum = (status: string) => proposals.filter(p => p.status === status).reduce((s, p) => s + (p.value ?? 0), 0)
  return (
    <Modal title={title} subtitle={`Won ${formatINR(sum('Won'))} · Lost ${formatINR(sum('Lost'))}`} onClose={onClose} width="lg" bodyClassName="px-5">
      {proposals.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">No proposals were won or lost this month.</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {[...proposals].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).map(p => {
            const meta = [p.proposalNumber, fmtDay(p.decidedAt ?? p.updatedAt) && `Decided ${fmtDay(p.decidedAt ?? p.updatedAt)}`, p.status === 'Lost' && p.lostReason && `Reason: ${p.lostReason}`].filter(Boolean).join('  ·  ')
            return (
              <li key={p.id} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{p.lead?.plant?.client?.clientName || p.lead?.plant?.plantName || 'Unnamed client'}</p>
                  <span className="shrink-0 text-sm font-semibold text-gray-700 dark:text-gray-200">{p.value != null ? formatINR(p.value) : '—'}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${p.status === 'Won' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'}`}>{p.status}</span>
                  {p.projectName && <span className="truncate text-xs text-gray-500 dark:text-gray-400">{p.projectName}</span>}
                </div>
                {meta && <p className="mt-1 text-[11px] text-gray-400">{meta}</p>}
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}

// The Sales tab of Reports (admins): leads week by week and won vs lost by
// month, over the chosen period. Per-person figures live on the Team
// comparison tab.
export function SalesReport({ months, weeks }: { months: number; weeks: number }) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null)
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null)

  function load() {
    Promise.all([
      api<{ leads: Lead[] }>('/leads', { auth: true }),
      api<{ proposals: Proposal[] }>('/proposals', { auth: true }),
    ])
      .then(([{ leads }, { proposals }]) => {
        setLeads(leads)
        setProposals(proposals)
        setError(null)
      })
      .catch(e => {
        setError(e instanceof Error ? e.message : 'Failed to load reports.')
        setLeads([]) // don't let the charts keep showing a previous fetch's data behind the error
        setProposals([])
      })
      .finally(() => setLoading(false))
  }
  useEffect(load, [])
  const reload = () => { setLoading(true); load() }

  const weekly = weeklyTrend(leads, weeks)
  const monthly = monthlyPerformance(proposals, months)

  return (
    <div>

      {error && <ErrorBanner message={error} onRetry={reload} className="mb-5" />}

      {loading ? (
        <p className="py-16 text-center text-sm text-gray-400 dark:text-gray-400">Loading reports…</p>
      ) : (
        <div className="space-y-5">
          <WeeklyLineChart
            title="Leads Generated vs Submitted"
            subtitle="New leads created each week and how many are in Submitted status · click a week to see its leads"
            data={weekly.map(({ week, generated, submitted }) => ({ week, generated, submitted }))}
            xKey="week"
            series={[
              { key: 'generated', name: 'Generated', color: '#6366f1' },
              { key: 'submitted', name: 'Submitted', color: '#f97316' },
            ]}
            onSelect={setSelectedWeek}
          />

          <WeeklyLineChart
            title="Monthly Performance"
            subtitle="Won vs Lost proposal value by month · click a month to see its proposals"
            data={monthly.map(({ month, won, lost }) => ({ month, won, lost }))}
            xKey="month"
            periodLabel="Month of"
            series={[
              { key: 'won', name: 'Won (₹)', color: '#10b981' },
              { key: 'lost', name: 'Lost (₹)', color: '#f43f5e' },
            ]}
            formatValue={fmtCompactINR}
            onSelect={setSelectedMonth}
          />

        </div>
      )}

      {selectedWeek != null && weekly[selectedWeek] && (
        <LeadsListModal title={`Leads · ${weekly[selectedWeek].range}`} leads={weekly[selectedWeek].leads} onClose={() => setSelectedWeek(null)} />
      )}
      {selectedMonth != null && monthly[selectedMonth] && (
        <ProposalsListModal title={`Proposals decided · ${monthly[selectedMonth].label}`} proposals={monthly[selectedMonth].proposals} onClose={() => setSelectedMonth(null)} />
      )}
    </div>
  )
}

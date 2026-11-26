import { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api'
import type { Lead, Proposal, EmployeeUser } from '../../lib/api'
import { isAssignableRole } from '../../lib/roles'
import { displayName, initials } from '../../lib/people'
import { formatINR, formatINRCompact } from '../../lib/format'
import { ErrorBanner } from '../ErrorBanner'
import { EmptyState } from '../EmptyState'

// Admin-only. Puts the team side by side on leads and conversion. Only people
// with at least one lead in the period are compared — with none there is
// nothing to measure.
//
//   Conversion  = leads that ended in a Won proposal ÷ leads assigned
//   Win rate    = Won ÷ (Won + Lost) proposals — how often a decided quote is won

type Row = {
  user: EmployeeUser
  name: string
  color: string
  leads: number
  proposals: number
  won: number
  lost: number
  open: number
  wonValue: number
  conversion: number // 0–100
  winRate: number | null // null until a proposal has been decided
}

// Distinct on white and dark backgrounds; each person keeps one colour everywhere on the page.
const PALETTE = ['#6366f1', '#f97316', '#10b981', '#ec4899', '#0ea5e9', '#a855f7', '#eab308', '#14b8a6', '#ef4444', '#84cc16']

const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`
const nameOf = (u: EmployeeUser) => u.userName || displayName(u.email)

function buildRows(leads: Lead[], proposals: Proposal[], employees: EmployeeUser[], since: number | null): Row[] {
  const inPeriod = leads.filter(l => since == null || new Date(l.createdAt).getTime() >= since)
  const byLead = new Map(proposals.map(p => [p.leadId, p]))
  return employees
    .map((user, i): Row => {
      const own = inPeriod.filter(l => l.assignedToUserId === user.id)
      const props = own.map(l => byLead.get(l.id)).filter((p): p is Proposal => !!p)
      const won = props.filter(p => p.status === 'Won')
      const lost = props.filter(p => p.status === 'Lost')
      return {
        user,
        name: nameOf(user),
        color: PALETTE[i % PALETTE.length],
        leads: own.length,
        proposals: props.length,
        won: won.length,
        lost: lost.length,
        open: props.length - won.length - lost.length,
        wonValue: won.reduce((s, p) => s + (p.value ?? 0), 0),
        conversion: own.length ? Math.round((won.length / own.length) * 1000) / 10 : 0,
        winRate: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 1000) / 10 : null,
      }
    })
    .filter(r => r.leads > 0) // nothing to compare without a lead
}

type Metric = {
  key: string
  label: string
  hint: string
  get: (r: Row) => number | null
  show: (r: Row) => string
  sub: (r: Row) => string
}

const METRICS: Metric[] = [
  { key: 'leads', label: 'Leads assigned', hint: 'Leads created in the period', get: r => r.leads, show: r => String(r.leads), sub: r => `${r.proposals} reached a proposal` },
  { key: 'conversion', label: 'Conversion rate', hint: 'Leads that ended in a Won proposal ÷ leads assigned', get: r => r.conversion, show: r => pct(r.conversion), sub: r => `${r.won} of ${r.leads} lead${r.leads === 1 ? '' : 's'} won` },
  { key: 'won', label: 'Proposals won', hint: 'Won proposals on their leads', get: r => r.won, show: r => String(r.won), sub: r => `${r.lost} lost · ${r.open} still open` },
  { key: 'winRate', label: 'Win rate', hint: 'Won ÷ (Won + Lost) — how often a decided proposal is won', get: r => r.winRate, show: r => (r.winRate == null ? '—' : pct(r.winRate)), sub: r => `${r.won} of ${r.won + r.lost} decided` },
  { key: 'value', label: 'Won value', hint: 'Total value of Won proposals', get: r => r.wonValue, show: r => formatINRCompact(r.wonValue), sub: r => (r.wonValue ? formatINR(r.wonValue) : 'Nothing won yet') },
]

function Avatar({ row, size = 'md' }: { row: Row; size?: 'sm' | 'md' }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white ${size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-xs'}`}
      style={{ backgroundColor: row.color }}
      aria-hidden="true"
    >
      {initials(row.name)}
    </span>
  )
}

const CARD = 'rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900'

// The person (or people, on a tie) with the highest value, or none if nobody has any.
const leadersOf = (rows: Row[], m: Metric) => {
  const vals = rows.map(r => m.get(r) ?? -1)
  const top = Math.max(...vals)
  return top > 0 ? rows.filter(r => (m.get(r) ?? -1) === top) : []
}

function MetricCard({ metric, rows }: { metric: Metric; rows: Row[] }) {
  const leaders = leadersOf(rows, metric).map(r => r.user.id)
  const max = Math.max(...rows.map(r => metric.get(r) ?? 0), 0)
  const sorted = [...rows].sort((a, b) => (metric.get(b) ?? -1) - (metric.get(a) ?? -1))
  return (
    <section className={`${CARD} p-5`} aria-label={metric.label}>
      <div className="mb-4">
        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{metric.label}</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">{metric.hint}</p>
      </div>
      <ul className="space-y-3.5">
        {sorted.map(r => {
          const v = metric.get(r)
          const best = leaders.includes(r.user.id) && rows.length > 1
          const width = v && max > 0 ? Math.max(3, (v / max) * 100) : 0
          return (
            <li key={r.user.id}>
              <div className="mb-1 flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar row={r} size="sm" />
                  <span className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">{r.name}</span>
                  {best && <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">Best</span>}
                </span>
                <span className="shrink-0 text-sm font-bold tabular-nums text-gray-900 dark:text-gray-100">{metric.show(r)}</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800" role="img" aria-label={`${r.name}: ${metric.show(r)}`}>
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${width}%`, backgroundColor: r.color, opacity: best || rows.length === 1 ? 1 : 0.7 }} />
              </div>
              <p className="mt-0.5 text-[11px] text-gray-400">{metric.sub(r)}</p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Highlight({ label, rows, metric }: { label: string; rows: Row[]; metric: Metric }) {
  const leaders = leadersOf(rows, metric)
  return (
    <div className={`${CARD} flex items-center gap-3 p-4`}>
      {leaders.length === 1 ? <Avatar row={leaders[0]} /> : <span className="h-8 w-8 shrink-0 rounded-full bg-gray-100 dark:bg-gray-800" aria-hidden="true" />}
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
        {leaders.length === 0 ? (
          <p className="text-sm text-gray-400">No data yet</p>
        ) : (
          <>
            <p className="truncate text-sm font-bold text-gray-900 dark:text-gray-100">{leaders.length === 1 ? leaders[0].name : `${leaders.length} tied`}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{metric.show(leaders[0])}</p>
          </>
        )}
      </div>
    </div>
  )
}

type SortKey = 'name' | 'leads' | 'proposals' | 'won' | 'lost' | 'conversion' | 'winRate' | 'wonValue'
const COLUMNS: { key: SortKey; label: string; show: (r: Row) => string }[] = [
  { key: 'leads', label: 'Leads', show: r => String(r.leads) },
  { key: 'proposals', label: 'Proposals', show: r => String(r.proposals) },
  { key: 'won', label: 'Won', show: r => String(r.won) },
  { key: 'lost', label: 'Lost', show: r => String(r.lost) },
  { key: 'conversion', label: 'Conversion', show: r => pct(r.conversion) },
  { key: 'winRate', label: 'Win rate', show: r => (r.winRate == null ? '—' : pct(r.winRate)) },
  { key: 'wonValue', label: 'Won value', show: r => formatINRCompact(r.wonValue) },
]

function HeadToHead({ rows }: { rows: Row[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'conversion', dir: -1 })
  const val = (r: Row, k: SortKey): number | string => (k === 'name' ? r.name.toLowerCase() : r[k] ?? -1)
  const sorted = [...rows].sort((a, b) => {
    const x = val(a, sort.key), y = val(b, sort.key)
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir
  })
  const best = (k: SortKey) => (rows.length > 1 ? Math.max(...rows.map(r => Number(r[k] ?? -1))) : -1)
  const pick = (key: SortKey) => setSort(s => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'name' ? 1 : -1 }))
  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '')
  return (
    <section className={CARD} aria-label="Head to head">
      <div className="border-b border-gray-100 px-5 py-3 dark:border-gray-800">
        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Head to head</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">Every figure side by side · the best in each column is highlighted · click a heading to sort</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs uppercase tracking-wider text-gray-400 dark:border-gray-800">
              <th scope="col" className="px-5 py-3 font-semibold"><button type="button" onClick={() => pick('name')} className="uppercase tracking-wider hover:text-gray-600 dark:hover:text-gray-200">Employee{arrow('name')}</button></th>
              {COLUMNS.map(c => (
                <th key={c.key} scope="col" className="px-3 py-3 text-right font-semibold"><button type="button" onClick={() => pick(c.key)} className="uppercase tracking-wider hover:text-gray-600 dark:hover:text-gray-200">{c.label}{arrow(c.key)}</button></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => (
              <tr key={r.user.id} className="border-b border-gray-50 last:border-0 dark:border-gray-800">
                <td className="px-5 py-3"><span className="flex items-center gap-2.5"><Avatar row={r} size="sm" /><span className="font-medium text-gray-900 dark:text-gray-100">{r.name}</span></span></td>
                {COLUMNS.map(c => {
                  const isBest = c.key !== 'lost' && best(c.key) > 0 && Number(r[c.key] ?? -1) === best(c.key)
                  return <td key={c.key} className={`px-3 py-3 text-right tabular-nums ${isBest ? 'font-bold text-emerald-600 dark:text-emerald-400' : 'text-gray-600 dark:text-gray-400'}`}>{c.show(r)}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// `months` 0 = all time.
export function TeamComparison({ months }: { months: number }) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [employees, setEmployees] = useState<EmployeeUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set()) // people switched off in the picker

  function load() {
    Promise.all([
      api<{ leads: Lead[] }>('/leads', { auth: true }),
      api<{ proposals: Proposal[] }>('/proposals', { auth: true }),
      api<{ users: EmployeeUser[] }>('/users', { auth: true }),
    ])
      .then(([{ leads }, { proposals }, { users }]) => {
        setLeads(leads)
        setProposals(proposals)
        setEmployees(users.filter(u => isAssignableRole(u.role) && u.isActive !== false))
        setError(null)
      })
      .catch(e => {
        setError(e instanceof Error ? e.message : 'Failed to load the comparison.')
        setLeads([]); setProposals([])
      })
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const since = useMemo(() => {
    if (!months) return null
    const d = new Date(); d.setMonth(d.getMonth() - months); d.setHours(0, 0, 0, 0)
    return d.getTime()
  }, [months])
  const eligible = useMemo(() => buildRows(leads, proposals, employees, since), [leads, proposals, employees, since])
  const selected = eligible.filter(r => !hidden.has(r.user.id))
  const withoutLeads = employees.length - eligible.length

  const toggle = (id: string) => setHidden(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else if (selected.length > 1) next.add(id) // always keep one on screen
    return next
  })

  if (loading) return <p className="py-16 text-center text-sm text-gray-400">Loading the comparison…</p>
  if (error) return <ErrorBanner message={error} onRetry={() => { setLoading(true); load() }} />
  if (eligible.length === 0) {
    return <div className={CARD}><EmptyState icon="users" title="No one to compare yet" message="A team member appears here once they have at least one lead in this period. Try a longer period, or assign leads from the Leads page." /></div>
  }

  const smallSample = selected.some(r => r.leads < 5)
  return (
    <div className="space-y-5">
      {/* who is being compared */}
      <section className={`${CARD} p-4 sm:p-5`} aria-label="Choose who to compare">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Compare team members</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {eligible.length === 1 ? 'Only one person has leads in this period — a comparison needs at least two.' : `${selected.length} of ${eligible.length} selected · tap a name to add or remove them`}
            </p>
          </div>
          {hidden.size > 0 && <button type="button" onClick={() => setHidden(new Set())} className="rounded-lg px-2.5 py-1 text-xs font-semibold text-orange-600 hover:bg-orange-50 dark:text-orange-300 dark:hover:bg-orange-500/10">Select all</button>}
        </div>
        <div className="flex flex-wrap gap-2">
          {eligible.map(r => {
            const on = !hidden.has(r.user.id)
            return (
              <button
                key={r.user.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(r.user.id)}
                className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm font-medium transition outline-none focus-visible:ring-2 focus-visible:ring-orange-300 ${on ? 'border-gray-300 bg-white text-gray-900 shadow-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100' : 'border-dashed border-gray-200 bg-transparent text-gray-400 hover:border-gray-300 dark:border-gray-700'}`}
              >
                <span className={on ? '' : 'opacity-40 grayscale'}><Avatar row={r} size="sm" /></span>
                {r.name}
                <span className="text-xs font-normal text-gray-400">{r.leads} lead{r.leads === 1 ? '' : 's'}</span>
              </button>
            )
          })}
        </div>
        {withoutLeads > 0 && <p className="mt-3 text-[11px] text-gray-400">{withoutLeads} team member{withoutLeads === 1 ? ' has' : 's have'} no leads in this period, so {withoutLeads === 1 ? 'they are' : 'they are'} left out.</p>}
      </section>

      {/* who leads where */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Highlight label="Highest conversion" rows={selected} metric={METRICS[1]} />
        <Highlight label="Most leads" rows={selected} metric={METRICS[0]} />
        <Highlight label="Highest won value" rows={selected} metric={METRICS[4]} />
      </div>

      {/* one bar chart per measure */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        {METRICS.map(m => <MetricCard key={m.key} metric={m} rows={selected} />)}
      </div>

      <HeadToHead rows={selected} />

      <p className="text-[11px] text-gray-400">
        Conversion = leads that ended in a Won proposal ÷ leads assigned. Win rate = Won ÷ (Won + Lost) proposals.
        {smallSample && ' Someone selected has fewer than 5 leads, so their rates can swing a lot on a single deal.'}
      </p>
    </div>
  )
}

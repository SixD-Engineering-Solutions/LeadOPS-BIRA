import type { FunnelCounts, MonthCompare, TargetProgress } from '../../hooks/useDashboardInsights'
import { formatCount, formatLakhs } from '../../lib/format'

const CARD = 'rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900'
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0)

function CardTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-2">
      <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{title}</h3>
      {action && onAction && (
        <button type="button" onClick={onAction} className="text-xs font-semibold text-orange-500 outline-none hover:text-orange-600 focus-visible:ring-2 focus-visible:ring-orange-300 dark:hover:text-orange-300">
          {action} →
        </button>
      )}
    </div>
  )
}

/** "▲ 25% vs Sep" — this month so far against the same days last month. */
export function Trend({ value, prevMonth }: { value: MonthCompare; prevMonth: string }) {
  const title = `This month so far, compared with the same days of ${prevMonth}`
  if (value.now === 0 && value.prev === 0) return <span className="text-gray-400 dark:text-gray-500" title={title}>— none in either month</span>
  if (value.prev === 0) return <span className="text-emerald-600 dark:text-emerald-400" title={title}>▲ up from none in {prevMonth}</span>
  const change = Math.round(((value.now - value.prev) / value.prev) * 100)
  if (change === 0) return <span className="text-gray-500 dark:text-gray-400" title={title}>Same as {prevMonth}</span>
  return (
    <span className={change > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'} title={title}>
      {change > 0 ? '▲' : '▼'} {Math.abs(change)}% vs {prevMonth}
    </span>
  )
}

function Bar({ value, of, marker }: { value: number; of: number; marker?: number }) {
  return (
    <div className="relative h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
      <div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.min(100, pct(value, of))}%` }} />
      {marker != null && <div className="absolute inset-y-0 w-0.5 bg-gray-900/60 dark:bg-white/70" style={{ left: `${Math.min(100, marker * 100)}%` }} />}
    </div>
  )
}

// FY invoicing against target, from the Tracker's sector summary (in lakhs).
// The tick on the bar is where an even pace would have it by today.
export function TargetCard({ target, loaded, onOpen }: { target: TargetProgress | null; loaded: boolean; onOpen: () => void }) {
  if (!loaded) return <div className={`${CARD} h-full animate-pulse`}><div className="h-4 w-24 rounded bg-gray-100 dark:bg-gray-800" /></div>
  if (!target) {
    return (
      <div className={`${CARD} h-full`}>
        <CardTitle title="FY target" />
        <p className="text-sm text-gray-500 dark:text-gray-400">No FY targets yet — they come from the Tracker’s sector summary.</p>
      </div>
    )
  }
  const expected = target.target * target.elapsed
  const gap = target.invoiced - expected
  return (
    <div className={`${CARD} h-full`}>
      <CardTitle title={`${target.fyLabel} target`} action="Tracker" onAction={onOpen} />
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{pct(target.invoiced, target.target)}%</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{formatLakhs(target.invoiced)} of {formatLakhs(target.target)}</p>
      </div>
      <div className="mt-2"><Bar value={target.invoiced} of={target.target} marker={target.elapsed} /></div>
      <p className={`mt-1.5 text-[11px] font-medium ${gap >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
        {gap >= 0 ? `Ahead of pace by ${formatLakhs(Math.round(gap * 100) / 100)}` : `Behind pace by ${formatLakhs(Math.round(-gap * 100) / 100)}`}
        <span className="font-normal text-gray-400"> · the tick is where an even pace would be today</span>
      </p>
      <ul className="mt-4 space-y-2.5">
        {target.sectors.slice(0, 5).map(s => (
          <li key={s.name}>
            <div className="mb-1 flex justify-between gap-2 text-xs">
              <span className="truncate text-gray-700 dark:text-gray-300">{s.name}</span>
              <span className="shrink-0 tabular-nums text-gray-500 dark:text-gray-400">{pct(s.invoiced, s.target)}% · {formatLakhs(s.invoiced)}</span>
            </div>
            <Bar value={s.invoiced} of={s.target} />
          </li>
        ))}
      </ul>
    </div>
  )
}

// Leads → Qualified → Proposal sent → Won, with how many make each step.
export function FunnelCard({ funnel, loaded, onOpenLeads, onOpenProposals }: { funnel: FunnelCounts; loaded: boolean; onOpenLeads: () => void; onOpenProposals: () => void }) {
  if (!loaded) return <div className={`${CARD} h-full animate-pulse`}><div className="h-4 w-24 rounded bg-gray-100 dark:bg-gray-800" /></div>
  const steps = [
    { label: 'Leads', n: funnel.leads, open: onOpenLeads },
    { label: 'Qualified', n: funnel.qualified, open: onOpenLeads },
    { label: 'Proposal sent', n: funnel.proposed, open: onOpenProposals },
    { label: 'Won', n: funnel.won, open: onOpenProposals },
  ]
  return (
    <div className={`${CARD} h-full`}>
      <CardTitle title="Sales funnel" />
      {funnel.leads === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">The funnel fills in as leads are added.</p>
      ) : (
        <ol className="space-y-3">
          {steps.map((s, i) => (
            <li key={s.label}>
              <button type="button" onClick={s.open} className="group block w-full rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-orange-300">
                <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                  <span className="font-medium text-gray-700 group-hover:text-orange-600 dark:text-gray-300 dark:group-hover:text-orange-300">{s.label}</span>
                  <span className="tabular-nums text-gray-500 dark:text-gray-400">
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{formatCount(s.n)}</span>
                    {i > 0 && <span> · {pct(s.n, steps[i - 1].n)}% of previous</span>}
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                  <div className="h-full rounded-full bg-orange-500 transition-all" style={{ width: `${Math.max(s.n > 0 ? 3 : 0, pct(s.n, funnel.leads))}%`, opacity: 1 - i * 0.18 }} />
                </div>
              </button>
            </li>
          ))}
        </ol>
      )}
      {funnel.leads > 0 && (
        <p className="mt-4 text-[11px] text-gray-500 dark:text-gray-400">
          {pct(funnel.won, funnel.leads)}% of leads end in a win · counts every lead, whatever its age
        </p>
      )}
    </div>
  )
}

export type AttentionItem = { key: string; label: string; count: number; tone: 'rose' | 'amber'; onOpen: () => void }

// What's waiting on someone: a count per kind, each opening its list.
export function AttentionCard({ items }: { items: AttentionItem[] }) {
  const due = items.filter(i => i.count > 0)
  return (
    <div className={`${CARD} h-full`}>
      <CardTitle title="Needs attention" />
      {due.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-[11px] text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">✓</span>
          All clear — nothing overdue or waiting.
        </div>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {due.map(i => (
            <li key={i.key}>
              <button type="button" onClick={i.onOpen} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm outline-none transition hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-orange-300 dark:hover:bg-gray-800/60">
                <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold tabular-nums ${i.tone === 'rose' ? 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'}`}>
                  {formatCount(i.count)}
                </span>
                <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-200">{i.label}</span>
                <span className="text-gray-300 dark:text-gray-600" aria-hidden="true">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

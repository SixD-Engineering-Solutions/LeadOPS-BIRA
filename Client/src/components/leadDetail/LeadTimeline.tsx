import { formatRelative, formatDateTime, formatDate, daysFromToday } from '../../lib/relativeTime'
import { KIND } from './leadTimelineData'
import type { TimelineEvent } from './leadTimelineData'

// A lead's whole history, newest first — activities, the proposal and its
// outcome, the project, invoices, payments and uploads — with the next
// booked follow-up pinned above it. Built by buildTimeline (leadTimelineData).
export function LeadTimeline({ events, followUp }: { events: TimelineEvent[]; followUp: { at: string; after: string } | null }) {
  const followDays = followUp ? daysFromToday(followUp.at) : 0
  return (
    <div>
      {followUp && (
        <div className={`mb-5 flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-xs ${followDays < 0 ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300' : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200'}`}>
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span>
            <span className="font-semibold">Next follow-up {followDays === 0 ? 'today' : followDays < 0 ? `was due ${formatRelative(followUp.at)}` : formatRelative(followUp.at)}</span>
            <span className="opacity-80"> · {formatDate(followUp.at)}, booked after a {followUp.after.toLowerCase()}</span>
          </span>
        </div>
      )}

      <ol className="relative">
        {events.map((e, i) => (
          <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
            {i < events.length - 1 && <span className="absolute left-[13px] top-7 bottom-0 w-px bg-gray-100 dark:bg-gray-800" aria-hidden="true" />}
            <span className={`relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${KIND[e.kind].ring}`}>
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d={KIND[e.kind].path} /></svg>
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[13px] text-gray-800 dark:text-gray-100">{e.title}</p>
                <time dateTime={e.at} title={formatDateTime(e.at)} className="shrink-0 text-[11px] text-gray-400 dark:text-gray-500">{formatRelative(e.at)}</time>
              </div>
              {e.body && <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">{e.body}</div>}
              {e.meta && <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">{e.meta}</p>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}


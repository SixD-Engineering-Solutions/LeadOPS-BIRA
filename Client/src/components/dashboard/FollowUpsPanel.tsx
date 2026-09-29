import type { Activity } from '../../lib/api'
import { ErrorBanner } from '../ErrorBanner'

const fmtDate = (ts: string) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

// Follow-ups from the activity log's next-action dates — today/overdue first,
// then a count of what's upcoming in the next 7 days. Hidden entirely once
// loaded with nothing to show; on error, shows a retry instead of silently
// vanishing (the prior behavior when the fetch failed).
export function FollowUpsPanel({ followUps, error, onRetry, onOpenLead }: {
  followUps: { today: Activity[]; overdue: Activity[]; upcoming: Activity[]; loaded: boolean }
  error: string | null
  onRetry: () => void
  onOpenLead: (leadId: string) => void
}) {
  if (error) return <ErrorBanner message={error} onRetry={onRetry} className="mt-6" />
  if (!followUps.loaded || followUps.overdue.length + followUps.today.length + followUps.upcoming.length === 0) return null

  return (
    <div className="mt-6 rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="border-b border-gray-100 px-5 py-3 dark:border-gray-800">
        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Follow-ups</h3>
      </div>
      <ul className="divide-y divide-gray-50 dark:divide-gray-800/60">
        {[...followUps.overdue, ...followUps.today].map(a => (
          <li
            key={a.id}
            onClick={() => onOpenLead(a.leadId)}
            className="flex cursor-pointer items-center justify-between gap-3 px-5 py-3 hover:bg-gray-50/60 dark:hover:bg-gray-800/60"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{a.lead?.plant?.plantName ?? '—'}</p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{a.activityType} · next action {fmtDate(a.nextActionDate!)}</p>
            </div>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${followUps.overdue.includes(a) ? 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/40 dark:text-rose-300 dark:border-rose-800' : 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-900/40 dark:text-sky-300 dark:border-sky-800'}`}>
              {followUps.overdue.includes(a) ? 'Overdue' : 'Today'}
            </span>
          </li>
        ))}
        {followUps.upcoming.length > 0 && (
          <li className="px-5 py-2.5 text-xs text-gray-400 dark:text-gray-500">
            +{followUps.upcoming.length} upcoming in the next 7 days
          </li>
        )}
      </ul>
    </div>
  )
}

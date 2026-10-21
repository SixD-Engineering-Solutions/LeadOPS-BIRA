import { formatRelative, formatDateTime, formatDate, daysFromToday } from '../../lib/relativeTime'

// A timestamp shown as "3 days ago", the exact date and time on hover.
export function RelTime({ ts, empty = '—' }: { ts: string | null | undefined; empty?: string }) {
  if (!ts) return <span className="text-gray-300 dark:text-gray-600">{empty}</span>
  return <time dateTime={ts} title={formatDateTime(ts)} className="whitespace-nowrap">{formatRelative(ts)}</time>
}

// A due date / deadline: the date itself, with how far off it is underneath
// ("in 3 days", "5 days overdue") — red once it's passed, unless `done`.
export function DueDate({ ts, done = false, empty = '—' }: { ts: string | null | undefined; done?: boolean; empty?: string }) {
  if (!ts) return <span className="text-gray-300 dark:text-gray-600">{empty}</span>
  const days = daysFromToday(ts)
  const late = !done && days < 0
  const soon = !done && days >= 0 && days <= 3
  const hint = done ? null : days === 0 ? 'today' : days < 0 ? `${-days} day${days === -1 ? '' : 's'} overdue` : formatRelative(ts)
  return (
    <span className="whitespace-nowrap" title={formatDateTime(ts)}>
      <span className={late ? 'font-medium text-rose-600 dark:text-rose-400' : 'text-gray-700 dark:text-gray-300'}>{formatDate(ts)}</span>
      {hint && <span data-csv-skip className={`block text-[11px] ${late ? 'text-rose-500 dark:text-rose-400' : soon ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'}`}>{hint}</span>}
    </span>
  )
}

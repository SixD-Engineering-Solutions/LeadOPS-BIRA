// "3 days ago" / "in 2 weeks" for list columns, with the exact date and time
// kept for a hover title (see components/table/RelTime). Calendar-based for
// days ("yesterday", "2 days ago" counts midnights, not 24-hour blocks), so a
// date-only value like a deadline reads the way people say it.

const DAY = 86_400_000
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

export function formatRelative(ts: string | number | Date, now = new Date()): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  const diffMs = d.getTime() - now.getTime()
  const absMin = Math.abs(diffMs) / 60_000

  // Within the hour / day: minutes and hours.
  if (absMin < 1) return 'just now'
  if (absMin < 60 && diffMs < 0) return `${Math.round(absMin)} min ago`
  if (absMin < 60) return `in ${Math.round(absMin)} min`
  const days = Math.round((startOfDay(d) - startOfDay(now)) / DAY)
  if (days === 0) {
    const h = Math.round(absMin / 60)
    return diffMs < 0 ? `${h} h ago` : `in ${h} h`
  }
  if (days === -1) return 'yesterday'
  if (days === 1) return 'tomorrow'

  const n = Math.abs(days)
  const unit = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
  const span = n < 14 ? unit(n, 'day') : n < 60 ? unit(Math.round(n / 7), 'week') : n < 365 ? unit(Math.round(n / 30.4), 'month') : null
  if (span) return days < 0 ? `${span} ago` : `in ${span}`
  // Over a year away: the date itself is clearer than "1 year ago".
  return formatDate(d)
}

/** "Oct 9, 2026" */
export const formatDate = (ts: string | number | Date) =>
  new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

/** "Oct 9, 2026, 3:06 PM" — the hover title for a relative time. */
export const formatDateTime = (ts: string | number | Date) =>
  new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

/** Whole calendar days from today to `ts` (negative = in the past). */
export const daysFromToday = (ts: string | number | Date, now = new Date()) =>
  Math.round((startOfDay(new Date(ts)) - startOfDay(now)) / DAY)

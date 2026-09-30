// Loading placeholders: grey shapes roughly where the content will land, so
// the page doesn't jump when data arrives. `animate-pulse` gives the shimmer.

const bar = 'rounded bg-gray-200 dark:bg-gray-800'

/** Rows of a list / table: a title line and a meta line, plus a pill on the right. */
export function SkeletonRows({ rows = 5, compact = false }: { rows?: number; compact?: boolean }) {
  return (
    <div className="animate-pulse divide-y divide-gray-100 dark:divide-gray-800" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`flex items-center justify-between gap-4 ${compact ? 'px-1 py-2' : 'px-5 py-4'}`}>
          <div className="min-w-0 flex-1 space-y-2">
            <div className={`${bar} h-3`} style={{ width: `${55 - (i % 3) * 12}%` }} />
            {!compact && <div className={`${bar} h-2.5`} style={{ width: `${35 - (i % 2) * 10}%` }} />}
          </div>
          <div className={`${bar} ${compact ? 'h-3 w-12' : 'h-5 w-20'} rounded-full`} />
        </div>
      ))}
    </div>
  )
}

/** A block of cards (e.g. chart cards) — `count` boxes of `height` px. */
export function SkeletonCards({ count = 2, height = 260 }: { count?: number; height?: number }) {
  return (
    <div className="grid animate-pulse grid-cols-1 gap-4 lg:grid-cols-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-2xl border border-gray-100 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <div className={`${bar} h-3.5 w-1/3`} />
          <div className={`${bar} mt-2 h-2.5 w-1/2`} />
          <div className={`${bar} mt-5 rounded-xl`} style={{ height: height - 70 }} />
        </div>
      ))}
    </div>
  )
}

/** Full-screen app boot placeholder. */
export function SkeletonScreen() {
  return (
    <div className="flex h-screen animate-pulse bg-white dark:bg-gray-950" aria-busy="true" aria-label="Loading">
      <div className="w-16 border-r border-gray-100 dark:border-gray-800" />
      <div className="flex-1 p-6">
        <div className={`${bar} h-5 w-48`} />
        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className={`${bar} h-24 rounded-2xl`} />)}
        </div>
      </div>
    </div>
  )
}

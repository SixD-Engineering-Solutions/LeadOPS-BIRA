// Shared error state for any list/section that fetches its own data — a
// message plus an inline retry, so recovering from a failed load never
// requires an unrelated always-visible "Refresh" button elsewhere on the
// page (or, worse, no way to retry at all).
export function ErrorBanner({ message, onRetry, className = 'm-4' }: { message: string; onRetry: () => void; className?: string }) {
  return (
    <div className={`${className} flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400`}>
      <span>{message}</span>
      <button onClick={onRetry} className="shrink-0 font-semibold underline hover:no-underline">Try again</button>
    </div>
  )
}

// Shared by LeadDetailModal and its three section components (documents,
// proposals, activity timeline).

export const inputCls = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'
export const fmtDay = (ts: string) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

export function DetailSection({ title, children, last = false }: { title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`${last ? '' : 'mb-4 border-b border-gray-50 pb-4 dark:border-gray-800/60'}`}>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-400">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

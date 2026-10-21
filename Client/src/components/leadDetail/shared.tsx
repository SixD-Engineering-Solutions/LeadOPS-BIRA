// Shared by LeadDetailModal and its three section components (documents,
// proposals, activity timeline).


export function DetailSection({ title, children, last = false }: { title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`${last ? '' : 'mb-4 border-b border-gray-50 pb-4 dark:border-gray-800/60'}`}>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-400">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

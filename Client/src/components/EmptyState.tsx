import type { ReactNode } from 'react'

// Outline icons (24×24, stroke) for empty states — one path each.
const ICONS = {
  inbox: 'M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4',
  document: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  briefcase: 'M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  receipt: 'M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z',
  check: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  users: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  calendar: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  bell: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
  chart: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  paperclip: 'M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13',
  clock: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
} as const
export type EmptyIcon = keyof typeof ICONS
// What a list or panel shows when it has nothing in it: an icon, a short
// message and, where there's an obvious next step, one action. `compact` is
// for small sections inside a card or modal.
export function EmptyState({ icon = 'inbox', title, message, action, compact = false }: {
  icon?: EmptyIcon
  title: string
  message?: ReactNode
  action?: { label: string; onClick: () => void }
  compact?: boolean
}) {
  return (
    <div className={`flex flex-col items-center text-center ${compact ? 'px-3 py-4' : 'px-5 py-12'}`}>
      <div className={`flex items-center justify-center rounded-full bg-orange-50 text-orange-500 dark:bg-orange-500/10 dark:text-orange-400 ${compact ? 'h-8 w-8' : 'h-12 w-12'}`}>
        <svg className={compact ? 'h-4 w-4' : 'h-6 w-6'} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d={ICONS[icon]} />
        </svg>
      </div>
      <p className={`font-semibold text-gray-700 dark:text-gray-200 ${compact ? 'mt-2 text-xs' : 'mt-3 text-sm'}`}>{title}</p>
      {message && <p className={`max-w-sm text-gray-500 dark:text-gray-400 ${compact ? 'mt-0.5 text-[11px]' : 'mt-1 text-xs'}`}>{message}</p>}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className={`rounded-lg bg-orange-500 font-semibold text-white transition hover:bg-orange-600 ${compact ? 'mt-2 px-2.5 py-1 text-[11px]' : 'mt-4 px-3.5 py-1.5 text-xs'}`}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

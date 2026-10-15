import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useEscapeStack } from '../lib/useEscapeStack'

const WIDTHS = { md: 'max-w-lg', lg: 'max-w-2xl' } as const

// The one popup shell every modal in the app uses: same backdrop, header,
// close button and dark-mode styling. Closes on Esc (only the top overlay —
// e.g. a lead opened from the Lead Assignments list closes back to the list),
// on a click outside, or on ✕. Rendered into <body> through a portal so
// scrolling inside it never scrolls the page behind (which lives in the
// dashboard's scrollable <main>).
export function Modal({ title, subtitle, onClose, width = 'md', children, bodyClassName = 'px-5 py-4' }: {
  title: ReactNode
  subtitle?: ReactNode
  onClose: () => void
  width?: keyof typeof WIDTHS
  children: ReactNode
  bodyClassName?: string
}) {
  useEscapeStack(onClose)

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
        className={`flex max-h-[85vh] w-full ${WIDTHS[width]} flex-col rounded-2xl border border-gray-100 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold text-gray-900 dark:text-gray-100">{title}</h3>
            {subtitle && <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-m-1 rounded-md p-1 text-base leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            aria-label="Close"
          >✕</button>
        </div>
        <div className={`overflow-y-auto overscroll-contain ${bodyClassName}`}>{children}</div>
      </div>
    </div>,
    document.body,
  )
}

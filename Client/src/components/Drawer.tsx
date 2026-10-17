import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useEscapeStack } from '../lib/useEscapeStack'

const WIDTHS = { md: 'max-w-[560px]', lg: 'max-w-[680px]' } as const

// A panel that slides in from the right over the page — for looking at one
// record in full, or filling in a new one, while the list stays where it was
// behind it. Closes on Esc, a click on the dimmed page, or ✕. `footer` stays
// pinned at the bottom (e.g. a form's Cancel / Save) while the body scrolls.
export function Drawer({ label, onClose, header, footer, size = 'lg', children }: {
  /** For screen readers: what the panel shows. */
  label: string
  onClose: () => void
  header: ReactNode
  footer?: ReactNode
  size?: keyof typeof WIDTHS
  children: ReactNode
}) {
  useEscapeStack(onClose)
  return createPortal(
    <div className="fade-in fixed inset-0 z-50 flex justify-end bg-gray-900/30 backdrop-blur-[2px]" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={e => e.stopPropagation()}
        className={`drawer-in flex h-full w-full ${WIDTHS[size]} flex-col border-l border-gray-100 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900`}
      >
        <div className="relative shrink-0 border-b border-gray-100 px-6 pb-4 pt-5 dark:border-gray-800">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 outline-none transition hover:bg-gray-100 hover:text-gray-700 focus-visible:ring-2 focus-visible:ring-orange-300 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M4.3 4.3a1 1 0 011.4 0L10 8.6l4.3-4.3a1 1 0 111.4 1.4L11.4 10l4.3 4.3a1 1 0 01-1.4 1.4L10 11.4l-4.3 4.3a1 1 0 01-1.4-1.4L8.6 10 4.3 5.7a1 1 0 010-1.4z" clipRule="evenodd" /></svg>
          </button>
          {header}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {footer && <div className="shrink-0 border-t border-gray-100 bg-white px-6 py-3 dark:border-gray-800 dark:bg-gray-900">{footer}</div>}
      </aside>
    </div>,
    document.body,
  )
}

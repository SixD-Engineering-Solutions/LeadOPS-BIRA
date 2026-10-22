import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { usePageChrome } from '../lib/pageChrome'
import { btn } from '../lib/ui'

// What the page on screen puts in the app's top bar: its title (with an
// optional breadcrumb, e.g. Tracker › Invoices), a one-line description, and
// its main action(s) at the right. Rendered by each page, drawn into the
// shell's top bar (see lib/pageChrome). Also names the browser tab.
export function PageHeader({ title, phoneTitle, crumb, subtitle, children }: {
  title: string
  /** A shorter title for phones, where the top bar has little room. */
  phoneTitle?: string
  crumb?: string
  subtitle?: ReactNode
  children?: ReactNode
}) {
  const { titleSlot, actionSlot } = usePageChrome()

  useEffect(() => {
    document.title = `${crumb ? `${crumb} · ` : ''}${title} · LeadOps`
    return () => { document.title = 'LeadOps' }
  }, [title, crumb])

  return (
    <>
      {titleSlot && createPortal(
        <div className="min-w-0">
          <h1 className="flex min-w-0 items-center gap-1.5 text-base font-bold text-gray-900 sm:text-lg dark:text-gray-100">
            {phoneTitle ? (
              <>
                <span className="truncate sm:hidden">{phoneTitle}</span>
                <span className="hidden truncate sm:inline">{title}</span>
              </>
            ) : <span className="truncate">{title}</span>}
            {/* On a phone there's only room for the page name; the tabs below show the rest. */}
            {crumb && (
              <span className="hidden min-w-0 items-center gap-1.5 sm:flex">
                <svg className="h-4 w-4 shrink-0 text-gray-300 dark:text-gray-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M7.2 14.8a1 1 0 010-1.4l3.4-3.4-3.4-3.4a1 1 0 011.4-1.4l4.1 4.1a1 1 0 010 1.4l-4.1 4.1a1 1 0 01-1.4 0z" clipRule="evenodd" /></svg>
                <span className="truncate font-semibold text-gray-500 dark:text-gray-400">{crumb}</span>
              </span>
            )}
          </h1>
          {subtitle && <p className="hidden truncate text-xs text-gray-500 sm:block dark:text-gray-400">{subtitle}</p>}
        </div>,
        titleSlot,
      )}
      {actionSlot && children && createPortal(<div className="flex items-center gap-2">{children}</div>, actionSlot)}
    </>
  )
}

/** A page's main action in the top bar, e.g. "+ New lead". */
export function NewButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-new-button
      title={`${label} (N)`}
      className={`${btn('primary', 'md')} shrink-0 px-3 shadow-sm`}
    >
      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M10 4a1 1 0 011 1v4h4a1 1 0 110 2h-4v4a1 1 0 11-2 0v-4H5a1 1 0 110-2h4V5a1 1 0 011-1z" /></svg>
      <span className="hidden sm:inline">{label}</span>
      <span className="sr-only sm:hidden">{label}</span>
    </button>
  )
}

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useEscapeStack } from '../../lib/useEscapeStack'

// A small floating panel anchored to a button — the shared shell for every
// menu in the tables (status pills, people pickers, filters, the row "⋯"
// menu). Rendered into <body> so a table's horizontal scroll never clips it;
// placed below the anchor, or above it when there isn't room. Closes on Esc,
// a click outside, or when the page scrolls (it would otherwise float away
// from its anchor). Arrow keys move between its items.
export function Popover({ anchor, onClose, align = 'start', minWidth = 200, label, children }: {
  anchor: HTMLElement
  onClose: () => void
  align?: 'start' | 'end'
  minWidth?: number
  label: string
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement | null>(null)
  useEscapeStack(onClose)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!panel.current?.contains(t) && !anchor.contains(t)) onClose()
    }
    const onScroll = (e: Event) => { if (!panel.current?.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onClose)
      // Back to the button that opened it, so keyboard users don't lose their place.
      if (document.activeElement === document.body || panel.current?.contains(document.activeElement)) anchor.focus({ preventScroll: true })
    }
  }, [anchor, onClose])

  // Placed by measuring once it's in the DOM (no state round-trip, so no flicker).
  const place = (el: HTMLDivElement | null) => {
    panel.current = el
    if (!el) return
    const a = anchor.getBoundingClientRect()
    const { offsetWidth: w, offsetHeight: h } = el
    const below = a.bottom + 6
    const top = below + h > window.innerHeight - 8 && a.top - h - 6 > 8 ? a.top - h - 6 : below
    const left = Math.min(Math.max(8, align === 'end' ? a.right - w : a.left), window.innerWidth - w - 8)
    el.style.top = `${top}px`
    el.style.left = `${left}px`
    el.style.visibility = 'visible'
    const first = el.querySelector<HTMLElement>('input, [role^=menuitem]:not([disabled])')
    first?.focus({ preventScroll: true })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const items = [...(panel.current?.querySelectorAll<HTMLElement>('input, [role^=menuitem]:not([disabled])') ?? [])]
    if (items.length === 0) return
    e.preventDefault()
    const i = items.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
    items[next].focus()
  }

  return createPortal(
    <div
      ref={place}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      onClick={e => e.stopPropagation()}
      style={{ minWidth, visibility: 'hidden', top: 0, left: 0 }}
      className="popover-in fixed z-[60] max-w-[min(90vw,340px)] rounded-xl border border-gray-100 bg-white p-1 shadow-xl shadow-gray-900/10 dark:border-gray-700 dark:bg-gray-800 dark:shadow-black/40"
    >
      {children}
    </div>,
    document.body,
  )
}

export function MenuItem({ onSelect, danger = false, checked, disabled = false, children, hint }: {
  onSelect: () => void
  danger?: boolean
  /** Set for choice lists: shows a tick on the current choice. */
  checked?: boolean
  disabled?: boolean
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked}
      disabled={disabled}
      onClick={e => { e.stopPropagation(); onSelect() }}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs outline-none transition disabled:cursor-not-allowed disabled:opacity-50 ${
        danger
          ? 'text-rose-600 hover:bg-rose-50 focus:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10 dark:focus:bg-rose-500/10'
          : 'text-gray-700 hover:bg-gray-50 focus:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700/60 dark:focus:bg-gray-700/60'
      }`}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
      {hint && <span className="shrink-0 text-[11px] text-gray-400 dark:text-gray-500">{hint}</span>}
      {checked && (
        <svg className="h-3.5 w-3.5 shrink-0 text-orange-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L8 12.6l7.3-7.3a1 1 0 011.4 0z" clipRule="evenodd" />
        </svg>
      )}
    </button>
  )
}

export const MenuDivider = () => <div className="my-1 border-t border-gray-100 dark:border-gray-700" role="separator" />

export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{children}</p>
)

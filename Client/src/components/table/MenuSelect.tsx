import { useState } from 'react'
import { Popover, MenuItem, MenuDivider } from './Popover'

export type MenuOption = { value: string; label: string; hint?: string }

const chevron = (
  <svg className="h-3 w-3 shrink-0 opacity-50 transition group-hover/ms:opacity-90" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M5.2 7.2a1 1 0 011.4 0L10 10.6l3.4-3.4a1 1 0 111.4 1.4l-4.1 4.1a1 1 0 01-1.4 0L5.2 8.6a1 1 0 010-1.4z" clipRule="evenodd" />
  </svg>
)

const pillBase = 'inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold'

/** A status badge — the same look whether or not it can be changed. */
export const StatusBadge = ({ label, tone }: { label: string; tone: string }) => <span className={`${pillBase} ${tone}`}>{label}</span>

const initials = (name: string) => name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('')

export function Avatar({ name, size = 20 }: { name: string | null; size?: number }) {
  if (!name) {
    return <span style={{ width: size, height: size }} className="inline-block shrink-0 rounded-full border border-dashed border-gray-300 dark:border-gray-600" aria-hidden="true" />
  }
  return (
    <span
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.42) }}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-rose-400 to-orange-400 font-semibold text-white"
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  )
}

/** A person, read-only — matches the picker below. */
export const PersonChip = ({ name, empty = 'Unassigned' }: { name: string | null; empty?: string }) => !name ? (
  <span className="text-xs text-gray-400 dark:text-gray-500">{empty}</span>
) : (
  <span className={`inline-flex max-w-full items-center gap-1.5 text-xs ${name ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500'}`}>
    <Avatar name={name} />
    <span className="truncate">{name ?? empty}</span>
  </span>
)

// The in-table replacement for a <select>: shows the current value the same
// way a read-only cell would (a status pill, or a person with their initials)
// and opens a small menu to change it. Clicks never reach the row, so changing
// a value doesn't also open the row.
export function MenuSelect({ value, options, onChange, variant, toneOf, busy = false, disabled = false, label, emptyLabel = 'Unassigned', allowEmpty = false }: {
  value: string
  options: MenuOption[]
  onChange: (value: string) => void
  variant: 'pill' | 'person'
  /** pill variant: the badge classes for a value (lib/statusStyles). */
  toneOf?: (value: string) => string
  busy?: boolean
  disabled?: boolean
  /** What is being chosen, for screen readers: e.g. "Status of Bhilai Steel Plant". */
  label: string
  emptyLabel?: string
  /** person variant: offer an "Unassigned" / "None" choice. */
  allowEmpty?: boolean
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [filter, setFilter] = useState('')
  const current = options.find(o => o.value === value)
  const searchable = options.length > 7
  const shown = filter ? options.filter(o => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(filter.toLowerCase())) : options
  const close = () => { setAnchor(null); setFilter('') }
  const pick = (v: string) => { close(); if (v !== value) onChange(v) }

  const trigger = variant === 'pill'
    ? <span className={`${pillBase} ${toneOf?.(value) ?? ''}`}>{current?.label ?? value}{!disabled && chevron}</span>
    : (
      <span className={`inline-flex max-w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs transition ${disabled ? '' : 'group-hover/ms:bg-gray-100 dark:group-hover/ms:bg-gray-800'} ${current ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500'}`}>
        <Avatar name={current?.label ?? null} />
        <span className="truncate">{current?.label ?? emptyLabel}</span>
        {!disabled && chevron}
      </span>
    )

  return (
    <>
      <button
        type="button"
        disabled={disabled || busy}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        aria-label={`${label}: ${current?.label ?? emptyLabel}`}
        onClick={e => { e.stopPropagation(); setAnchor(anchor ? null : e.currentTarget) }}
        className={`group/ms -my-1 max-w-full rounded-full py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-orange-300 ${busy ? 'cursor-wait opacity-60' : disabled ? 'cursor-default' : 'cursor-pointer'}`}
      >
        {trigger}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={close} label={label} minWidth={variant === 'pill' ? 180 : 220}>
          {searchable && (
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && shown[0]) pick(shown[0].value) }}
              placeholder="Search…"
              aria-label={`Search ${label}`}
              className="mb-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-orange-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
          )}
          <div className="max-h-64 overflow-y-auto">
            {variant === 'person' && allowEmpty && !filter && (
              <>
                <MenuItem checked={!value} onSelect={() => pick('')}><PersonChip name={null} empty={emptyLabel} /></MenuItem>
                <MenuDivider />
              </>
            )}
            {shown.map(o => (
              <MenuItem key={o.value} checked={o.value === value} onSelect={() => pick(o.value)} hint={variant === 'person' ? undefined : o.hint}>
                {variant === 'pill'
                  ? <StatusBadge label={o.label} tone={toneOf?.(o.value) ?? ''} />
                  : (
                    <span className="flex min-w-0 items-center gap-2">
                      <Avatar name={o.label} />
                      <span className="min-w-0">
                        <span className="block truncate">{o.label}</span>
                        {o.hint && <span className="block truncate text-[10px] text-gray-400 dark:text-gray-500">{o.hint}</span>}
                      </span>
                    </span>
                  )}
              </MenuItem>
            ))}
            {shown.length === 0 && <p className="px-2.5 py-2 text-xs text-gray-400">No matches</p>}
          </div>
        </Popover>
      )}
    </>
  )
}

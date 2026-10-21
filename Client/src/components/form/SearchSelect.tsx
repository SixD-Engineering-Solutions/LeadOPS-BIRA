import { useState } from 'react'
import { Popover } from '../table/Popover'
import { inputCls } from '../../lib/formStyles'

export type SelectOption = { value: string; label: string; hint?: string; disabled?: boolean }

// A form dropdown that looks like the other fields and lets you type to find
// an option — for the long lists (leads, projects, engineers, people). With
// eight options or fewer there's nothing to search, so it's just a list.
// `emptyLabel` is what an unset value shows ("Select a lead…", "Unassigned").
export function SearchSelect({ value, onChange, options, emptyLabel = 'Select…', allowEmpty = false, invalid = false, label, autoFocus = false, disabled = false }: {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  emptyLabel?: string
  /** Offer the empty choice in the list (e.g. "Unassigned", "None"). */
  allowEmpty?: boolean
  invalid?: boolean
  label?: string
  autoFocus?: boolean
  disabled?: boolean
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [query, setQuery] = useState('')
  const current = options.find(o => o.value === value)
  const searchable = options.length > 8
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = terms.length ? options.filter(o => terms.every(t => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(t))) : options
  const close = () => { setAnchor(null); setQuery('') }
  const pick = (v: string) => { close(); if (v !== value) onChange(v) }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={!!anchor}
        aria-label={label ? `${label}: ${current?.label ?? emptyLabel}` : undefined}
        aria-invalid={invalid || undefined}
        autoFocus={autoFocus}
        onClick={e => (anchor ? close() : setAnchor(e.currentTarget))}
        onKeyDown={e => { if ((e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') && !anchor) { e.preventDefault(); setAnchor(e.currentTarget) } }}
        className={`${inputCls(invalid)} flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60 ${current ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'}`}
      >
        <span className="min-w-0 truncate">{current?.label ?? emptyLabel}</span>
        <svg className="h-4 w-4 shrink-0 text-gray-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M5.2 7.2a1 1 0 011.4 0L10 10.6l3.4-3.4a1 1 0 111.4 1.4l-4.1 4.1a1 1 0 01-1.4 0L5.2 8.6a1 1 0 010-1.4z" clipRule="evenodd" /></svg>
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={close} minWidth={Math.max(220, anchor.offsetWidth)} label={label ?? 'Choose'}>
          {searchable && (
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const first = shown.find(o => !o.disabled); if (first) pick(first.value) } }}
              placeholder="Type to search…"
              aria-label={`Search ${label ?? 'options'}`}
              className="mb-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-orange-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
          )}
          <div className="max-h-64 overflow-y-auto" role="listbox">
            {allowEmpty && !query && <Option label={emptyLabel} selected={!value} muted onSelect={() => pick('')} />}
            {shown.map(o => <Option key={o.value} label={o.label} hint={o.hint} selected={o.value === value} disabled={o.disabled} onSelect={() => pick(o.value)} />)}
            {shown.length === 0 && <p className="px-2.5 py-2 text-xs text-gray-400">No matches</p>}
          </div>
        </Popover>
      )}
    </>
  )
}

function Option({ label, hint, selected, disabled = false, muted = false, onSelect }: { label: string; hint?: string; selected: boolean; disabled?: boolean; muted?: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs outline-none hover:bg-gray-50 focus:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-gray-700/60 dark:focus:bg-gray-700/60 ${muted ? 'text-gray-500 dark:text-gray-400' : 'text-gray-700 dark:text-gray-200'}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {hint && <span className="block truncate text-[10px] text-gray-400">{hint}</span>}
      </span>
      {selected && (
        <svg className="h-3.5 w-3.5 shrink-0 text-orange-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L8 12.6l7.3-7.3a1 1 0 011.4 0z" clipRule="evenodd" /></svg>
      )}
    </button>
  )
}

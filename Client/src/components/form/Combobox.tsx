import { useId, useState } from 'react'
import { inputCls } from '../../lib/formStyles'
import { sameNameKey } from '../../lib/names'

// A free-text field that suggests what already exists (sectors, verticals,
// sources, service types, clients). Typing a name that's an existing one
// written differently snaps to the existing one when you leave the field, so
// "Oil and Gas" can't quietly become a second "Oil & Gas"; anything else is
// shown as "New" before it's saved, and the list offers "Create '…'" for it.
export function Combobox({ value, onChange, options, placeholder, invalid = false, label, noun = 'value' }: {
  value: string
  onChange: (value: string) => void
  options: string[]
  placeholder?: string
  invalid?: boolean
  label?: string
  /** "sector", "vertical"… for the "Create new sector" wording. */
  noun?: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()

  const typed = value.trim()
  const key = sameNameKey(typed)
  const existing = key ? options.find(o => sameNameKey(o) === key) : undefined
  const terms = typed.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (terms.length ? options.filter(o => terms.every(t => o.toLowerCase().includes(t) || sameNameKey(o).includes(sameNameKey(t)))) : options).slice(0, 8)
  const items: { label: string; value: string; create?: boolean }[] = [
    ...matches.map(o => ({ label: o, value: o })),
    ...(typed && !existing ? [{ label: `Create new ${noun} “${typed}”`, value: typed, create: true }] : []),
  ]
  const activeIndex = Math.min(active, Math.max(0, items.length - 1))

  const choose = (v: string) => { onChange(v); setOpen(false) }
  // On leaving: the same name written differently becomes the existing one.
  const settle = () => { setOpen(false); if (existing && existing !== value) onChange(existing) }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((activeIndex + 1) % Math.max(1, items.length)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((activeIndex - 1 + items.length) % Math.max(1, items.length)) }
    else if (e.key === 'Enter' && open && items[activeIndex]) { e.preventDefault(); choose(items[activeIndex].value) }
    else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false) }
  }

  return (
    <div className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={label}
        aria-invalid={invalid || undefined}
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); setActive(0) }}
        onFocus={() => setOpen(true)}
        onBlur={settle}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        className={`${inputCls(invalid)} ${typed && !existing ? 'pr-14' : ''}`}
      />
      {typed && !existing && (
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-500/20 dark:text-sky-200" title={`A new ${noun} will be created`}>New</span>
      )}
      {open && items.length > 0 && (
        <ul id={listId} role="listbox" className="popover-in absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-xl border border-gray-100 bg-white p-1 shadow-xl shadow-gray-900/10 dark:border-gray-700 dark:bg-gray-800">
          {items.map((it, i) => (
            <li
              key={`${it.create ? 'new' : 'opt'}-${it.value}`}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={e => { e.preventDefault(); choose(it.value) }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs ${i === activeIndex ? 'bg-gray-50 dark:bg-gray-700/60' : ''} ${it.create ? 'font-medium text-sky-700 dark:text-sky-300' : 'text-gray-700 dark:text-gray-200'}`}
            >
              {it.create
                ? <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M10 4a1 1 0 011 1v4h4a1 1 0 110 2h-4v4a1 1 0 11-2 0v-4H5a1 1 0 110-2h4V5a1 1 0 011-1z" /></svg>
                : <span className="w-3.5 shrink-0" />}
              <span className="truncate">{it.label}</span>
              {!it.create && sameNameKey(it.value) === key && <span className="ml-auto text-[10px] text-gray-400">existing</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

import { useState } from 'react'
import { Popover } from '../table/Popover'
import { inputCls } from '../../lib/formStyles'

// A date field: type it (dd-mm-yyyy, the way dates are written here) or pick
// it from a calendar, with one-click Today / Tomorrow / +7 days / End of
// month. The value is the same YYYY-MM-DD string the browser's date box gave,
// so forms and the server don't change. `min` / `max` grey out dates that
// aren't allowed (e.g. a completion date before the start date).

const pad = (n: number) => String(n).padStart(2, '0')
const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const fromIso = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const display = (iso: string) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}-${m}-${y}` }
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

// "15-10-2026", "15/10/26", "15.10.2026", "2026-10-15" → YYYY-MM-DD, or null.
function parse(text: string): string | null {
  const t = text.trim()
  if (!t) return ''
  let y: number, m: number, d: number
  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  const dmy = t.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})$/)
  if (iso) { y = +iso[1]; m = +iso[2]; d = +iso[3] }
  else if (dmy) { d = +dmy[1]; m = +dmy[2]; y = +dmy[3] < 100 ? 2000 + +dmy[3] : +dmy[3] }
  else return null
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? toIso(date) : null
}

export function DatePicker({ value, onChange, min, max, placeholder = 'dd-mm-yyyy', invalid = false, label, autoFocus = false, quickPicks = true }: {
  value: string
  onChange: (iso: string) => void
  min?: string
  max?: string
  placeholder?: string
  invalid?: boolean
  /** Accessible name, when the field has no visible <label> around it. */
  label?: string
  autoFocus?: boolean
  quickPicks?: boolean
}) {
  const [text, setText] = useState<string | null>(null) // what's being typed, until it's committed
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [view, setView] = useState(() => (value ? fromIso(value) : new Date()))
  const [typo, setTypo] = useState(false)

  const allowed = (iso: string) => (!min || iso >= min) && (!max || iso <= max)
  const commit = () => {
    if (text == null) return
    const iso = parse(text)
    if (iso === null || (iso && !allowed(iso))) { setTypo(true); return }
    setTypo(false)
    setText(null)
    if (iso !== value) onChange(iso)
  }
  const pick = (iso: string) => { setTypo(false); setText(null); onChange(iso); setAnchor(null) }
  const open = (el: HTMLElement) => { setView(value ? fromIso(value) : min && min > toIso(new Date()) ? fromIso(min) : new Date()); setAnchor(el) }

  // calendar grid for the month in view, Monday first
  const first = new Date(view.getFullYear(), view.getMonth(), 1)
  const lead = (first.getDay() + 6) % 7
  const daysIn = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate()
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => toIso(new Date(view.getFullYear(), view.getMonth(), i + 1)))]
  const today = toIso(new Date())
  const shift = (months: number) => setView(v => new Date(v.getFullYear(), v.getMonth() + months, 1))

  const quick: [string, Date][] = (() => {
    const t = new Date()
    return [
      ['Today', t],
      ['Tomorrow', new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)],
      ['+7 days', new Date(t.getFullYear(), t.getMonth(), t.getDate() + 7)],
      ['End of month', new Date(t.getFullYear(), t.getMonth() + 1, 0)],
    ]
  })()

  // Arrow keys move between days; the grid's day buttons carry data-iso.
  const onGridKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    const current = (document.activeElement as HTMLElement | null)?.dataset.iso
    if (!step || !current) return
    e.preventDefault()
    const d = fromIso(current)
    d.setDate(d.getDate() + step)
    const iso = toIso(d)
    if (d.getMonth() !== view.getMonth()) setView(new Date(d.getFullYear(), d.getMonth(), 1))
    requestAnimationFrame(() => e.currentTarget?.ownerDocument.querySelector<HTMLElement>(`[data-iso="${iso}"]`)?.focus())
  }

  return (
    <div className="relative">
      <input
        type="text"
        inputMode="numeric"
        value={text ?? display(value)}
        onChange={e => { setText(e.target.value); setTypo(false) }}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } if (e.key === 'ArrowDown') { e.preventDefault(); open(e.currentTarget) } }}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={invalid || typo || undefined}
        autoFocus={autoFocus}
        className={`${inputCls(invalid || typo)} pr-10 tabular-nums`}
      />
      <button
        type="button"
        onClick={e => (anchor ? setAnchor(null) : open(e.currentTarget))}
        aria-label="Open calendar"
        className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-gray-400 outline-none transition hover:bg-gray-200/60 hover:text-gray-600 focus-visible:ring-2 focus-visible:ring-orange-300 dark:hover:bg-gray-700 dark:hover:text-gray-200"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
      </button>
      {typo && <span className="mt-1 block text-[11px] font-normal text-red-500 dark:text-red-400">{min || max ? 'Enter a valid date in the allowed range (dd-mm-yyyy).' : 'Enter a valid date as dd-mm-yyyy.'}</span>}

      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} align="end" minWidth={268} label="Choose a date">
          <div className="p-1.5">
            <div className="mb-2 flex items-center justify-between">
              <button type="button" onClick={() => shift(-1)} aria-label="Previous month" className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700">
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M12.8 5.2a1 1 0 010 1.4L9.4 10l3.4 3.4a1 1 0 11-1.4 1.4l-4.1-4.1a1 1 0 010-1.4l4.1-4.1a1 1 0 011.4 0z" clipRule="evenodd" /></svg>
              </button>
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-100" aria-live="polite">{MONTHS[view.getMonth()]} {view.getFullYear()}</span>
              <button type="button" onClick={() => shift(1)} aria-label="Next month" className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700">
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M7.2 14.8a1 1 0 010-1.4l3.4-3.4-3.4-3.4a1 1 0 011.4-1.4l4.1 4.1a1 1 0 010 1.4l-4.1 4.1a1 1 0 01-1.4 0z" clipRule="evenodd" /></svg>
              </button>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center" onKeyDown={onGridKey} role="grid" aria-label={`${MONTHS[view.getMonth()]} ${view.getFullYear()}`}>
              {DAYS.map(d => <span key={d} className="py-1 text-[10px] font-semibold uppercase text-gray-400">{d}</span>)}
              {cells.map((iso, i) => iso === null ? <span key={`b${i}`} /> : (
                <button
                  key={iso}
                  type="button"
                  data-iso={iso}
                  disabled={!allowed(iso)}
                  onClick={() => pick(iso)}
                  tabIndex={iso === (value || today) ? 0 : -1}
                  aria-pressed={iso === value}
                  aria-label={fromIso(iso).toDateString()}
                  className={`h-8 rounded-lg text-xs tabular-nums outline-none transition focus-visible:ring-2 focus-visible:ring-orange-300 disabled:cursor-not-allowed disabled:text-gray-300 dark:disabled:text-gray-600 ${
                    iso === value ? 'bg-orange-500 font-semibold text-white'
                      : iso === today ? 'font-semibold text-orange-600 ring-1 ring-inset ring-orange-300 hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-gray-700'
                      : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700'}`}
                >
                  {Number(iso.slice(8))}
                </button>
              ))}
            </div>
            {quickPicks && (
              <div className="mt-2 flex flex-wrap gap-1 border-t border-gray-100 pt-2 dark:border-gray-700">
                {quick.map(([name, d]) => {
                  const iso = toIso(d)
                  return (
                    <button key={name} type="button" disabled={!allowed(iso)} onClick={() => pick(iso)} className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-600 hover:border-orange-300 hover:text-orange-600 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300">
                      {name}
                    </button>
                  )
                })}
                {value && <button type="button" onClick={() => pick('')} className="ml-auto rounded-lg px-2 py-1 text-[11px] font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400">Clear</button>}
              </div>
            )}
          </div>
        </Popover>
      )}
    </div>
  )
}

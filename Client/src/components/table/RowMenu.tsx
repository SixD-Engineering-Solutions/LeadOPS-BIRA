import { useState } from 'react'
import { Popover, MenuItem, MenuDivider } from './Popover'

export type RowAction = { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean }

// The "⋯" at the end of a row: its less frequent actions (open, edit,
// delete…) out of the way until wanted. Dangerous ones sit last, after a
// divider, in red. Shown when the row is hovered or focused (always on touch
// screens, which can't hover — see DataGrid's `row-actions`).
export function RowMenu({ actions, label }: { actions: (RowAction | false | null | undefined)[]; label: string }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const list = actions.filter(Boolean) as RowAction[]
  if (list.length === 0) return null
  const safe = list.filter(a => !a.danger)
  const danger = list.filter(a => a.danger)
  const run = (a: RowAction) => { setAnchor(null); a.onSelect() }

  return (
    <>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        aria-label={`Actions for ${label}`}
        title="More actions"
        onClick={e => { e.stopPropagation(); setAnchor(anchor ? null : e.currentTarget) }}
        className={`row-actions inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 outline-none transition hover:bg-gray-100 hover:text-gray-700 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-orange-300 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200 ${anchor ? 'bg-gray-100 text-gray-700 opacity-100 dark:bg-gray-800 dark:text-gray-200' : ''}`}
      >
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <circle cx="4" cy="10" r="1.6" /><circle cx="10" cy="10" r="1.6" /><circle cx="16" cy="10" r="1.6" />
        </svg>
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} align="end" minWidth={180} label={`Actions for ${label}`}>
          {safe.map(a => <MenuItem key={a.label} onSelect={() => run(a)} disabled={a.disabled}>{a.label}</MenuItem>)}
          {safe.length > 0 && danger.length > 0 && <MenuDivider />}
          {danger.map(a => <MenuItem key={a.label} danger onSelect={() => run(a)} disabled={a.disabled}>{a.label}</MenuItem>)}
        </Popover>
      )}
    </>
  )
}

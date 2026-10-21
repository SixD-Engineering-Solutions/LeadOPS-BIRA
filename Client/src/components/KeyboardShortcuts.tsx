import { useEffect, useState } from 'react'
import { Modal } from './Modal'

const SHORTCUTS: [keys: string[], what: string][] = [
  [['Ctrl', 'K'], 'Search everything (or /)'],
  [['N'], 'New… on the page you’re on (lead, proposal, task…)'],
  [['F'], 'Jump to the table’s search box'],
  [['Esc'], 'Close the open panel or menu'],
  [['?'], 'Show these shortcuts'],
]

const Key = ({ k }: { k: string }) => (
  <kbd className="inline-flex min-w-6 items-center justify-center rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-sans text-[11px] font-semibold text-gray-700 shadow-[0_1px_0_rgba(0,0,0,0.06)] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">{k}</kbd>
)

// App-wide single-key shortcuts. They never fire while typing in a field,
// with Ctrl/Alt/⌘ held, or while a dialog is open (so N can't open a second
// form behind the first).
export function KeyboardShortcuts() {
  const [help, setHelp] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target
      const typing = t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === '?') { e.preventDefault(); setHelp(h => !h); return }
      if (document.querySelector('[role="dialog"]')) return
      const key = e.key.toLowerCase()
      if (key === 'n') {
        const btn = document.querySelector<HTMLButtonElement>('[data-new-button]')
        if (btn) { e.preventDefault(); btn.click() }
      } else if (key === 'f') {
        const search = document.querySelector<HTMLInputElement>('[data-table-search]')
        if (search) { e.preventDefault(); search.focus(); search.select() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!help) return null
  return (
    <Modal title="Keyboard shortcuts" subtitle="They work anywhere except while you’re typing in a field." onClose={() => setHelp(false)}>
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {SHORTCUTS.map(([keys, what]) => (
          <li key={what} className="flex items-center justify-between gap-4 py-2.5 text-sm text-gray-700 dark:text-gray-200">
            <span>{what}</span>
            <span className="flex shrink-0 items-center gap-1">{keys.map(k => <Key key={k} k={k} />)}</span>
          </li>
        ))}
      </ul>
    </Modal>
  )
}

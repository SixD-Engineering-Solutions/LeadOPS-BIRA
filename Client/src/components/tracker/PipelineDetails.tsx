import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { PipelineTrackerItem } from '../../lib/api'
import { formatSheetValue } from '../../lib/format'
import { Drawer } from '../Drawer'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-900 dark:text-gray-100">{children ?? 'Not recorded'}</dd></div>
}

const value = (s: string | null) => s?.trim() || null

export default function PipelineDetails({ row, stage, action, onClose }: {
  row: PipelineTrackerItem
  stage: ReactNode
  action?: { label: string; disabled?: boolean; onSelect: () => void } | null
  onClose: () => void
}) {
  const body = useRef<HTMLDivElement>(null)
  // Keep keyboard navigation inside this read-only panel and return to its opener.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = body.current?.closest<HTMLElement>('[role="dialog"]')
    if (!dialog) return
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')).filter(el => el.getClientRects().length > 0)
    dialog.tabIndex = -1
    dialog.focus()
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const nodes = focusable()
      const first = nodes[0], last = nodes[nodes.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { e.preventDefault(); last?.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
    }
    dialog.addEventListener('keydown', trap)
    return () => { dialog.removeEventListener('keydown', trap); if (previous?.isConnected) previous.focus() }
  }, [])

  return <Drawer
    label={`Pipeline details: ${row.client?.trim() || 'Unnamed client'}`}
    onClose={onClose}
    header={<div className="pr-9"><p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Pipeline opportunity</p><h2 className="mt-2 break-words text-xl font-bold text-gray-900 dark:text-gray-100">{row.client?.trim() || 'Unnamed client'}</h2><p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{[row.location, row.service].filter(Boolean).join(' · ')}</p><div className="mt-3 flex flex-wrap items-center gap-3">{stage}<span className="text-lg font-semibold text-gray-900 dark:text-gray-100">{row.valueLakhs == null ? 'Value not recorded' : formatSheetValue(row.valueLakhs, row.currency)}</span></div></div>}
    footer={<div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-700">Close details</button>{action && <button type="button" disabled={action.disabled} onClick={action.onSelect} className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-orange-300 disabled:opacity-50">{action.label}</button>}</div>}
  >
    <div ref={body} className="space-y-6 p-6">
      <section><h3 className="mb-3 text-sm font-semibold">Opportunity</h3><dl className="grid grid-cols-2 gap-4"><Field label="Client">{value(row.client)}</Field><Field label="Location / plant">{value(row.location)}</Field><Field label="Vertical">{value(row.vertical)}</Field><Field label="Service">{value(row.service)}</Field><Field label="Currency">{value(row.currency)}</Field></dl><dl className="mt-4"><Field label="Description">{value(row.description)}</Field></dl></section>
      <section className="border-t border-gray-100 pt-5 dark:border-gray-800"><h3 className="mb-3 text-sm font-semibold">Progress</h3><dl className="grid grid-cols-2 gap-4"><Field label="Original status">{value(row.status)}</Field><Field label="Probability">{row.probabilityPct == null ? null : `${row.probabilityPct}%`}</Field><Field label="Expected close">{value(row.expectedClose)}</Field><Field label="Priority">{value(row.priority)}</Field></dl></section>
      <section className="border-t border-gray-100 pt-5 dark:border-gray-800"><h3 className="mb-3 text-sm font-semibold">Ownership and follow-up</h3><dl className="grid grid-cols-2 gap-4"><Field label="Owner">{value(row.owner)}</Field><Field label="BM / contact">{value(row.bmContact)}</Field><Field label="Follow-up">{value(row.followUpDate)}</Field><Field label="Action flag">{value(row.flagAction)}</Field></dl><dl className="mt-4"><Field label="Last action">{value(row.lastAction)}</Field></dl></section>
      <section className="border-t border-gray-100 pt-5 dark:border-gray-800"><h3 className="mb-3 text-sm font-semibold">Notes and source</h3><dl className="space-y-4"><Field label="Notes">{value(row.notes)}</Field><Field label="Source">{row.sourceLeadId ? 'Synced from the app. Open the lead to manage this opportunity.' : 'Imported tracking sheet. Dates and notes are shown as recorded.'}</Field></dl></section>
    </div>
  </Drawer>
}

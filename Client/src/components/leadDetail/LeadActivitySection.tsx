import { useState } from 'react'
import { api, ACTIVITY_TYPES } from '../../lib/api'
import type { ActivityType } from '../../lib/api'
import { INPUT_CLS as inputCls } from '../../lib/formStyles'
import { btn } from '../../lib/ui'
import { DatePicker } from '../form/DatePicker'

const todayInput = () => new Date().toISOString().slice(0, 10)
const empty = () => ({ activityType: 'Call' as ActivityType, activityDate: todayInput(), notes: '', nextActionDate: '' })

// Logging a call / visit / meeting against a lead — collapsed to one button
// until it's wanted, so the timeline under it stays the focus. A next action
// date turns into a follow-up reminder on the dashboard.
export function LogActivityForm({ leadId, onLogged }: { leadId: string; onLogged: () => void }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await api('/activities', {
        method: 'POST',
        auth: true,
        body: {
          leadId,
          activityType: form.activityType,
          activityDate: form.activityDate,
          notes: form.notes.trim() || undefined,
          nextActionDate: form.nextActionDate || undefined,
        },
      })
      setForm(empty())
      setOpen(false)
      onLogged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not log activity.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-5 flex w-full items-center gap-2 rounded-xl border border-dashed border-gray-300 px-3.5 py-2.5 text-left text-xs font-medium text-gray-500 outline-none transition hover:border-orange-300 hover:bg-orange-50/50 hover:text-orange-600 focus-visible:ring-2 focus-visible:ring-orange-300 dark:border-gray-700 dark:text-gray-400 dark:hover:border-orange-500/50 dark:hover:bg-orange-500/5 dark:hover:text-orange-300"
      >
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M10 4a1 1 0 011 1v4h4a1 1 0 110 2h-4v4a1 1 0 11-2 0v-4H5a1 1 0 110-2h4V5a1 1 0 011-1z" /></svg>
        Log a call, visit or meeting
      </button>
    )
  }

  const label = 'flex flex-col gap-1 text-[11px] font-medium text-gray-500 dark:text-gray-400'
  return (
    <form onSubmit={submit} className="mb-5 rounded-xl border border-gray-200 bg-gray-50/60 p-3.5 dark:border-gray-700 dark:bg-gray-800/40">
      <div className="grid grid-cols-2 gap-2.5">
        <label className={label}>
          Type
          <select value={form.activityType} onChange={e => setForm({ ...form, activityType: e.target.value as ActivityType })} className={inputCls} autoFocus>
            {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className={label}>
          Date
          <DatePicker value={form.activityDate} onChange={v => setForm({ ...form, activityDate: v })} />
        </label>
        <label className={`${label} col-span-2`}>
          Notes
          <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="What happened — one point per line" rows={3} className={`${inputCls} resize-none`} />
        </label>
        <label className={`${label} col-span-2 sm:col-span-1`}>
          Next action date <span className="font-normal text-gray-400">(optional — sets a reminder)</span>
          <DatePicker value={form.nextActionDate} min={todayInput()} onChange={v => setForm({ ...form, nextActionDate: v })} />
        </label>
      </div>
      {error && <p className="mt-2 text-xs text-red-500 dark:text-red-400">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={() => { setOpen(false); setError(null) }} className={btn('secondary', 'sm')}>
          Cancel
        </button>
        <button disabled={saving} className={btn('primary', 'sm')}>
          {saving ? 'Logging…' : 'Log activity'}
        </button>
      </div>
    </form>
  )
}

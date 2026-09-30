import { useState } from 'react'
import { Modal } from './Modal'

// Asked whenever a lead is marked Dead or a proposal Lost — the reason is
// mandatory (the server refuses the change without one), so the status only
// changes once this is confirmed; Cancel leaves it as it was.
export function LostReasonModal({ title, subject, onCancel, onConfirm }: {
  title: string
  subject: string
  onCancel: () => void
  onConfirm: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (reason.trim().length < 3) { setError('Please give a reason (at least 3 characters).'); return }
    setSaving(true)
    setError(null)
    try {
      await onConfirm(reason.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.')
      setSaving(false)
    }
  }

  return (
    <Modal title={title} subtitle={subject} onClose={onCancel}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
          Reason lost *
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            autoFocus
            rows={3}
            placeholder="e.g. Lost on price to a competitor / budget cut / no response from client"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
        </label>
        {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-xl bg-rose-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-rose-600 disabled:opacity-60">
            {saving ? 'Saving…' : 'Save reason'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

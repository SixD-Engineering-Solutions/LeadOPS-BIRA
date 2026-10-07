import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import type { EmployeeUser, TrackerTable } from '../../lib/api'
import { Modal } from '../Modal'
import Button from '../Button'
import { toInput } from '../../lib/trackerEditFields'
import type { TrackerTableDef } from '../../lib/trackerEditFields'

const inputCls = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'
const changedCls = 'border-orange-300 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/40'

// Edit one imported tracker row. An admin's edit is saved straight away; an
// employee's becomes a change request sent to the admin they pick, and the
// tracker only changes once that admin approves it.
export default function EditRowModal({ table, def, row, rowLabel, isAdmin, currentUserId, onClose, onDone }: {
  table: TrackerTable
  def: TrackerTableDef // which fields can change — from the server (GET /tracker/fields)
  row: { id: string } & Record<string, unknown>
  rowLabel: string
  isAdmin: boolean
  currentUserId: string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const fields = def.fields
  const initial = Object.fromEntries(fields.map(f => [f.key, toInput(f.kind, row[f.key])]))
  const [values, setValues] = useState<Record<string, string>>(initial)
  const [admins, setAdmins] = useState<EmployeeUser[]>([])
  const [adminsLoaded, setAdminsLoaded] = useState(false)
  const [adminId, setAdminId] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isAdmin) return
    api<{ users: EmployeeUser[] }>('/users', { auth: true })
      .then(({ users }) => {
        const list = users.filter(u => u.role === 'admin' && u.isActive && u.id !== currentUserId)
        setAdmins(list)
        if (list.length === 1) setAdminId(list[0].id)
        setAdminsLoaded(true)
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load the list of admins.'))
  }, [isAdmin, currentUserId])

  const changed = fields.filter(f => values[f.key] !== initial[f.key])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (changed.length === 0) { setError('Change at least one field first.'); return }
    if (!isAdmin && !adminId) { setError('Pick the admin who should approve this change.'); return }
    const changes = Object.fromEntries(changed.map(f => [f.key, values[f.key]]))
    setSaving(true)
    setError(null)
    try {
      if (isAdmin) {
        await api(`/tracker/rows/${table}/${row.id}`, { method: 'PATCH', auth: true, body: { changes } })
        onDone('Tracker updated.')
      } else {
        await api('/tracker/requests', { method: 'POST', auth: true, body: { table, rowId: row.id, adminId, changes, note: note.trim() || undefined } })
        const admin = admins.find(a => a.id === adminId)
        onDone(`Request sent to ${admin?.userName || admin?.email || 'the admin'}. The tracker will update once they approve it.`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setSaving(false)
    }
  }

  return (
    <Modal
      width="lg"
      title={isAdmin ? `Edit “${rowLabel}”` : `Request a change to “${rowLabel}”`}
      subtitle={isAdmin
        ? `${def.title} · your changes are saved straight away`
        : `${def.title} · an admin has to approve this before the tracker changes`}
      onClose={onClose}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {fields.map(f => {
            const isChanged = values[f.key] !== initial[f.key]
            const common = {
              id: `edit-${f.key}`,
              value: values[f.key],
              onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues(v => ({ ...v, [f.key]: e.target.value })),
              className: `${inputCls} ${isChanged ? changedCls : ''}`,
            }
            return (
              <div key={f.key} className={f.kind === 'longtext' ? 'sm:col-span-2' : ''}>
                <label htmlFor={common.id} className="mb-1 flex items-center justify-between text-xs font-semibold text-gray-600 dark:text-gray-400">
                  <span>{f.label}</span>
                  {isChanged && <span className="text-[10px] font-semibold uppercase tracking-wide text-orange-500">Changed</span>}
                </label>
                {f.kind === 'longtext' ? (
                  <textarea {...common} rows={2} />
                ) : (
                  <input
                    {...common}
                    type={f.kind === 'date' ? 'date' : 'text'}
                    inputMode={f.kind === 'number' ? 'decimal' : f.kind === 'int' ? 'numeric' : undefined}
                  />
                )}
                {f.hint && <p className="mt-0.5 text-[11px] text-gray-400">{f.hint}</p>}
              </div>
            )
          })}
        </div>

        {!isAdmin && (
          <div className="grid grid-cols-1 gap-3 border-t border-gray-100 pt-4 dark:border-gray-800 sm:grid-cols-2">
            <div>
              <label htmlFor="edit-admin" className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-400">Send to admin</label>
              <select id="edit-admin" value={adminId} onChange={e => setAdminId(e.target.value)} className={inputCls}>
                <option value="">Choose an admin…</option>
                {admins.map(a => <option key={a.id} value={a.id}>{a.userName || a.email}</option>)}
              </select>
              {adminsLoaded && admins.length === 0 && (
                <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">There’s no active admin to send this to. Ask for one to be added on the Team page.</p>
              )}
            </div>
            <div>
              <label htmlFor="edit-note" className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-400">Note for the admin (optional)</label>
              <input id="edit-note" value={note} onChange={e => setNote(e.target.value)} maxLength={1000} placeholder="Why is this change needed?" className={inputCls} />
            </div>
          </div>
        )}

        {error && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p>}

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {changed.length === 0 ? 'No changes yet' : `${changed.length} field${changed.length === 1 ? '' : 's'} changed`}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} className="!w-auto">Cancel</Button>
            <Button type="submit" variant="gradient" loading={saving} disabled={changed.length === 0} className="!w-auto">
              {isAdmin ? 'Save changes' : 'Send request'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}

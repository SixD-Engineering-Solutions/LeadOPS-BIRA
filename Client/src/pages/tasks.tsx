import { useEffect, useState } from 'react'
import { api, TASK_SYNC_EVENT } from '../lib/api'
import type { Task, EmployeeUser } from '../lib/api'
import { taskStatusStyle as statusStyle, fmtTaskDeadline as fmtDeadline, isTaskOverdue as isOverdue } from '../lib/taskDisplay'

const STATUSES = ['Pending', 'In Progress', 'Done'] as const

const fmt = (ts: string) => new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const inputCls = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'
const emptyForm = { title: '', description: '', deadline: '', assignedToUserId: '' }

export default function Tasks({ isAdmin = false }: { isAdmin?: boolean }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [employees, setEmployees] = useState<EmployeeUser[]>([])

  const [form, setForm] = useState({ ...emptyForm })
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const { tasks } = await api<{ tasks: Task[] }>('/tasks', { auth: true })
      setTasks(tasks)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tasks.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  // Live updates — a task assigned/updated/deleted by anyone pings every
  // connected client over SSE (see NotificationBell). Re-fetch just that one
  // task and upsert it, or drop it if it's gone (deleted, or no longer
  // visible to us), so the list stays live without a manual refresh.
  useEffect(() => {
    function onTaskSync(e: Event) {
      const taskId = (e as CustomEvent<{ taskId: string }>).detail?.taskId
      if (!taskId) return
      api<{ task: Task }>(`/tasks/${taskId}`, { auth: true })
        .then(({ task }) => setTasks(prev => (prev.some(t => t.id === task.id) ? prev.map(t => (t.id === task.id ? task : t)) : [task, ...prev])))
        .catch(() => setTasks(prev => prev.filter(t => t.id !== taskId)))
    }
    window.addEventListener(TASK_SYNC_EVENT, onTaskSync)
    return () => window.removeEventListener(TASK_SYNC_EVENT, onTaskSync)
  }, [])

  // Employees, for the assign-to dropdown — admins are excluded, same rule as
  // lead assignment: tasks are worked by employees, not admin accounts.
  useEffect(() => {
    if (!isAdmin) return
    api<{ users: EmployeeUser[] }>('/users', { auth: true })
      .then(({ users }) => setEmployees(users.filter(u => u.role !== 'admin')))
      .catch(() => {})
  }, [isAdmin])
  const employeeLabel = (u: EmployeeUser) => `${u.userName || u.email} — ${u.email}`

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }))

  async function createTask(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!form.title.trim()) { setFormError('Title is required.'); return }
    if (!form.deadline) { setFormError('Deadline is required.'); return }
    if (!form.assignedToUserId) { setFormError('Pick who this task is assigned to.'); return }
    setCreating(true)
    try {
      const { task } = await api<{ task: Task }>('/tasks', { method: 'POST', auth: true, body: form })
      setTasks(prev => [task, ...prev])
      setForm({ ...emptyForm })
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not create task.')
    } finally {
      setCreating(false)
    }
  }

  async function changeStatus(id: string, status: string) {
    setSavingId(id)
    try {
      const { task } = await api<{ task: Task }>(`/tasks/${id}`, { method: 'PATCH', auth: true, body: { status } })
      setTasks(prev => prev.map(t => (t.id === id ? task : t)))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update task.')
    } finally {
      setSavingId(null)
    }
  }

  async function removeTask(id: string) {
    setSavingId(id)
    try {
      await api(`/tasks/${id}`, { method: 'DELETE', auth: true })
      setTasks(prev => prev.filter(t => t.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete task.')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-5">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Tasks</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {isAdmin ? 'Assign a task to any employee with a deadline — they’ll be notified instantly.' : 'Your assigned tasks and their deadlines.'}
        </p>
      </div>

      {/* create form — admin only */}
      {isAdmin && (
        <form onSubmit={createTask} className="mb-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h3 className="mb-3 text-sm font-bold text-gray-900 dark:text-gray-100">Assign a task</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400 sm:col-span-2 lg:col-span-1">
              Title *
              <input value={form.title} onChange={set('title')} placeholder="e.g. Follow up with Bhilai Steel Plant" className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
              Deadline *
              <input type="date" value={form.deadline} onChange={set('deadline')} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
              Assign to *
              <select value={form.assignedToUserId} onChange={set('assignedToUserId')} className={inputCls}>
                <option value="">Select employee…</option>
                {employees.map(u => <option key={u.id} value={u.id}>{employeeLabel(u)}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400 sm:col-span-2 lg:col-span-3">
              Description
              <textarea value={form.description} onChange={set('description')} placeholder="Optional details" rows={2} className={inputCls} />
            </label>
          </div>
          {formError && <p className="mt-2 text-xs text-red-500 dark:text-red-400">{formError}</p>}
          <div className="mt-3">
            <button type="submit" disabled={creating} className="rounded-xl bg-gradient-to-r from-rose-400 to-orange-400 px-5 py-2 text-sm font-semibold text-white transition hover:from-rose-500 hover:to-orange-500 disabled:opacity-60">
              {creating ? 'Assigning…' : 'Assign Task'}
            </button>
          </div>
        </form>
      )}

      {/* list */}
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3 dark:border-gray-800">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{isAdmin ? 'All Tasks' : 'My Tasks'} {tasks.length > 0 && <span className="text-gray-400 dark:text-gray-500">({tasks.length})</span>}</h3>
          <button onClick={load} className="text-xs font-medium text-orange-500 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-300">Refresh</button>
        </div>

        {error && <div className="m-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">{error}</div>}

        {loading ? (
          <p className="px-5 py-10 text-center text-sm text-gray-400 dark:text-gray-500">Loading…</p>
        ) : tasks.length === 0 && !error ? (
          <p className="px-5 py-10 text-center text-sm text-gray-400 dark:text-gray-500">{isAdmin ? 'No tasks yet. Assign one above.' : 'No tasks assigned to you yet.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs uppercase tracking-wider text-gray-400 dark:border-gray-800 dark:text-gray-500">
                  <th className="px-5 py-3 font-semibold">Task</th>
                  {isAdmin && <th className="px-3 py-3 font-semibold">Assigned to</th>}
                  <th className="px-3 py-3 font-semibold">Deadline</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                  <th className="px-3 py-3 font-semibold">Updated</th>
                  {isAdmin && <th className="px-3 py-3 font-semibold"></th>}
                </tr>
              </thead>
              <tbody>
                {tasks.map(task => (
                  <tr key={task.id} className="border-b border-gray-50 dark:border-gray-800">
                    <td className="px-5 py-3">
                      <p className="font-semibold text-gray-900 dark:text-gray-100">{task.title}</p>
                      {task.description && <p className="max-w-xs truncate text-xs text-gray-500 dark:text-gray-400">{task.description}</p>}
                    </td>
                    {isAdmin && (
                      <td className="px-3 py-3 text-xs text-gray-600 dark:text-gray-400">
                        {task.assignedToUser ? (task.assignedToUser.userName || task.assignedToUser.email) : '—'}
                      </td>
                    )}
                    <td className={`px-3 py-3 text-xs font-medium ${isOverdue(task) ? 'text-red-500 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`}>
                      {fmtDeadline(task.deadline)}{isOverdue(task) ? ' · overdue' : ''}
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={task.status}
                        disabled={savingId === task.id}
                        onChange={e => changeStatus(task.id, e.target.value)}
                        className={`rounded-lg border px-2 py-1 text-xs font-semibold outline-none focus:ring-2 focus:ring-orange-300 disabled:opacity-60 ${statusStyle(task.status)}`}
                      >
                        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400">{fmt(task.updatedAt)}</td>
                    {isAdmin && (
                      <td className="px-3 py-3 text-right">
                        <button onClick={() => removeTask(task.id)} disabled={savingId === task.id} className="text-xs font-medium text-red-400 hover:text-red-600 disabled:opacity-50 dark:text-red-500 dark:hover:text-red-400">Delete</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

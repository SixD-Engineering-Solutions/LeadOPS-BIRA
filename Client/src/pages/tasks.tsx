import { useEffect, useState } from 'react'
import { api, TASK_SYNC_EVENT } from '../lib/api'
import type { Task, EmployeeUser } from '../lib/api'
import { taskStatusStyle as statusStyle, isTaskOverdue as isOverdue } from '../lib/taskDisplay'
import { ErrorBanner } from '../components/ErrorBanner'
import { EmptyState } from '../components/EmptyState'
import { PageHeader, NewButton } from '../components/PageHeader'
import { CreatePanel } from '../components/CreatePanel'
import { PAGE_CLASS } from '../lib/pageChrome'
import { SkeletonRows } from '../components/Skeleton'
import { useTableView } from '../lib/useTableView'
import { useConfirm } from '../lib/useConfirm'
import { DataGrid } from '../components/table/DataGrid'
import type { Column } from '../components/table/DataGrid'
import { TableToolbar, TableFooter, NoMatches, RefreshButton } from '../components/table/TableToolbar'
import { MenuSelect, PersonChip } from '../components/table/MenuSelect'
import { RowMenu } from '../components/table/RowMenu'
import { DueDate, RelTime } from '../components/table/RelTime'

const STATUSES = ['Pending', 'In Progress', 'Done'] as const
const person = (u?: { userName: string | null; email: string } | null) => (u ? u.userName || u.email : null)

const inputCls = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'
const emptyForm = { title: '', description: '', deadline: '', assignedToUserId: '' }

export default function Tasks({ isAdmin = false }: { isAdmin?: boolean }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [employees, setEmployees] = useState<EmployeeUser[]>([])

  const [form, setForm] = useState({ ...emptyForm })
  const [creating, setCreating] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
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
      setShowCreate(false)
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

  const [confirmDialog, confirm] = useConfirm()
  async function removeTask(task: Task) {
    const ok = await confirm({ title: 'Delete this task?', message: <>“{task.title}” is removed for everyone. This can’t be undone.</>, confirmLabel: 'Delete task', danger: true })
    if (!ok) return
    const id = task.id
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

  const view = useTableView<Task>({
    id: 'tasks',
    rows: tasks,
    search: t => [t.title, t.description, person(t.assignedToUser), t.status].join(' '),
    views: [
      { id: 'open', label: 'Open', match: t => t.status !== 'Done' },
      { id: 'overdue', label: 'Overdue', match: isOverdue },
      { id: 'done', label: 'Done', match: t => t.status === 'Done' },
      { id: 'all', label: 'All' },
    ],
    filters: [
      { id: 'status', label: 'Status', value: t => t.status, order: STATUSES },
      ...(isAdmin ? [{ id: 'assignee', label: 'Assigned to', value: (t: Task) => person(t.assignedToUser) }] : []),
    ],
    sorts: {
      task: { value: t => t.title },
      assignee: { value: t => person(t.assignedToUser) },
      deadline: { value: t => new Date(t.deadline).getTime() },
      status: { value: t => STATUSES.indexOf(t.status as (typeof STATUSES)[number]) },
      updated: { value: t => new Date(t.updatedAt).getTime(), firstDir: 'desc' },
    },
    defaultSort: { id: 'deadline', dir: 'asc' },
  })

  const columns: Column<Task>[] = [
    {
      id: 'task', header: 'Task', sticky: true, className: 'min-w-[260px] max-w-[420px]',
      cell: t => (
        <div className="min-w-0">
          <p className={`truncate text-sm font-semibold ${t.status === 'Done' ? 'text-gray-400 line-through decoration-gray-300 dark:text-gray-500' : 'text-gray-900 dark:text-gray-100'}`}>{t.title}</p>
          {t.description && <p className="truncate text-xs text-gray-500 dark:text-gray-400" title={t.description}>{t.description}</p>}
        </div>
      ),
    },
    ...(isAdmin ? [{ id: 'assignee', header: 'Assigned to', cell: (t: Task) => <PersonChip name={person(t.assignedToUser)} empty="—" /> }] : []),
    { id: 'deadline', header: 'Deadline', cell: t => <DueDate ts={t.deadline} done={t.status === 'Done'} /> },
    {
      id: 'status', header: 'Status',
      cell: t => <MenuSelect variant="pill" label={`Status of ${t.title}`} value={t.status} options={STATUSES.map(s => ({ value: s, label: s }))} toneOf={statusStyle} busy={savingId === t.id} onChange={v => changeStatus(t.id, v)} />,
    },
    { id: 'updated', header: 'Updated', align: 'right', cell: t => <span className="text-gray-500 dark:text-gray-400"><RelTime ts={t.updatedAt} /></span> },
  ]

  return (
    <div className={PAGE_CLASS}>
      <PageHeader title="Tasks" subtitle={isAdmin ? 'Assign a task to any employee with a deadline — they’ll be notified instantly.' : 'Your assigned tasks and their deadlines.'}>
        {isAdmin && <NewButton label="Assign task" onClick={() => setShowCreate(true)} />}
      </PageHeader>

      {/* list */}
      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <TableToolbar view={view} noun="tasks" placeholder="Search tasks…">
          <RefreshButton onClick={load} busy={loading} />
        </TableToolbar>

        {error && <ErrorBanner message={error} onRetry={load} />}

        {loading && tasks.length === 0 ? (
          <SkeletonRows />
        ) : tasks.length === 0 && !error ? (
          isAdmin
            ? <EmptyState icon="check" title="No tasks yet" message="Assign a to-do with a deadline to anyone on the team." action={{ label: 'Assign task', onClick: () => setShowCreate(true) }} />
            : <EmptyState icon="check" title="Nothing assigned to you 🎉" message="Tasks your admin assigns you will show up here." />
        ) : (
          <>
            <DataGrid
              columns={columns}
              rows={view.rows}
              getKey={t => t.id}
              view={view}
              actions={isAdmin ? t => <RowMenu label={t.title} actions={[{ label: 'Delete task', danger: true, disabled: savingId === t.id, onSelect: () => removeTask(t) }]} /> : undefined}
              empty={<NoMatches noun="tasks" onClear={view.clearFilters} />}
              minWidth={760}
            />
            <TableFooter view={view} />
          </>
        )}
      </div>
      {confirmDialog}
      {isAdmin && showCreate && (
        <CreatePanel
          title="Assign a task"
          subtitle="They’re notified straight away, and see it on their dashboard until it’s done."
          onClose={() => setShowCreate(false)}
          onSubmit={createTask}
          saving={creating}
          submitLabel="Assign task"
          savingLabel="Assigning…"
          error={formError}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400 sm:col-span-2">
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
              <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400 sm:col-span-2">
                Description
                <textarea value={form.description} onChange={set('description')} placeholder="Optional details" rows={2} className={inputCls} />
              </label>
            </div>
        </CreatePanel>
      )}
    </div>
  )
}

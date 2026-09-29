import type { Task } from '../../lib/api'
import { taskStatusStyle, fmtTaskDeadline, isTaskOverdue } from '../../lib/taskDisplay'
import { ErrorBanner } from '../ErrorBanner'

// This employee's own assigned tasks. Admins never see this panel (they're
// never assignable). Hidden entirely once loaded with nothing assigned; on
// error, shows a retry instead of silently vanishing.
export function TasksPanel({ isAdmin, myTasks, error, onRetry, onViewAll }: {
  isAdmin: boolean
  myTasks: Task[]
  error: string | null
  onRetry: () => void
  onViewAll: () => void
}) {
  if (isAdmin) return null
  if (error) return <ErrorBanner message={error} onRetry={onRetry} className="mt-6" />
  if (myTasks.length === 0) return null

  return (
    <div className="mt-6 rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3 dark:border-gray-800">
        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">
          Tasks <span className="text-gray-400 dark:text-gray-500">({myTasks.length})</span>
        </h3>
        <button onClick={onViewAll} className="text-xs font-medium text-orange-500 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-300">View all</button>
      </div>
      <ul className="divide-y divide-gray-50 dark:divide-gray-800/60">
        {myTasks.map(task => (
          <li key={task.id} className="flex items-start justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{task.title}</p>
              {task.description && <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{task.description}</p>}
              <p className={`mt-1 text-xs font-medium ${isTaskOverdue(task) ? 'text-red-500 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'}`}>
                Due {fmtTaskDeadline(task.deadline)}{isTaskOverdue(task) ? ' · overdue' : ''}
              </p>
            </div>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${taskStatusStyle(task.status)}`}>
              {task.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

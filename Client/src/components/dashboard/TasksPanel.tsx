import type { Task } from '../../lib/api'
import { taskStatusStyle, fmtTaskDeadline, isTaskOverdue } from '../../lib/taskDisplay'
import { ErrorBanner } from '../ErrorBanner'
import { EmptyState } from '../EmptyState'
import { SkeletonRows } from '../Skeleton'

// This employee's own assigned tasks. Admins never see this panel (they're
// never assignable). Placeholder rows while loading and an empty state when
// nothing's assigned; on error, a retry.
export function TasksPanel({ isAdmin, myTasks, loaded, error, onRetry, onViewAll }: {
  isAdmin: boolean
  myTasks: Task[]
  loaded: boolean
  error: string | null
  onRetry: () => void
  onViewAll: () => void
}) {
  if (isAdmin) return null
  if (error) return <ErrorBanner message={error} onRetry={onRetry} className="mt-6" />
  if (!loaded || myTasks.length === 0) {
    return (
      <div className="mt-6 rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="border-b border-gray-100 px-5 py-3 dark:border-gray-800">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Tasks</h3>
        </div>
        {!loaded
          ? <SkeletonRows rows={2} />
          : <EmptyState compact icon="check" title="Nothing assigned to you 🎉" message="Tasks your admin assigns you will show up here." />}
      </div>
    )
  }

  return (
    <div className="mt-6 rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3 dark:border-gray-800">
        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">
          Tasks <span className="text-gray-400 dark:text-gray-400">({myTasks.length})</span>
        </h3>
        <button onClick={onViewAll} className="text-xs font-medium text-orange-500 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-300">View all</button>
      </div>
      <ul className="divide-y divide-gray-50 dark:divide-gray-800/60">
        {myTasks.map(task => (
          <li key={task.id} className="flex items-start justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{task.title}</p>
              {task.description && <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{task.description}</p>}
              <p className={`mt-1 text-xs font-medium ${isTaskOverdue(task) ? 'text-red-500 dark:text-red-400' : 'text-gray-400 dark:text-gray-400'}`}>
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

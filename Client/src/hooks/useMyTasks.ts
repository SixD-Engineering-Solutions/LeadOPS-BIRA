import { useEffect, useState } from 'react'
import { api, TASK_SYNC_EVENT } from '../lib/api'
import type { Task } from '../lib/api'

// This employee's own assigned tasks, for the dashboard's "Tasks" section.
// Admins are never assignable (enforced server-side), so this stays empty —
// and the panel hidden — for admin accounts.
export function useMyTasks(active: boolean, isAdmin: boolean) {
  const [myTasks, setMyTasks] = useState<Task[]>([])
  const [error, setError] = useState<string | null>(null)

  function reload() {
    if (isAdmin) return Promise.resolve()
    return api<{ tasks: Task[] }>('/tasks', { auth: true })
      .then(({ tasks }) => { setMyTasks(tasks); setError(null) })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load tasks.'))
  }

  useEffect(() => {
    if (active) reload()
  }, [active, isAdmin])

  useEffect(() => {
    function onTaskSync() {
      if (active) reload()
    }
    window.addEventListener(TASK_SYNC_EVENT, onTaskSync)
    return () => window.removeEventListener(TASK_SYNC_EVENT, onTaskSync)
  }, [active, isAdmin])

  return { myTasks, error, reload }
}

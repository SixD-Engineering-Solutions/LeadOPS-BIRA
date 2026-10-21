import { useEffect, useState } from 'react'
import { api, TASK_SYNC_EVENT } from '../lib/api'
import type { Task } from '../lib/api'

// This employee's own assigned tasks, for the dashboard's "Tasks" section.
// Admins are never assignable (enforced server-side), so this stays empty —
// and the panel hidden — for admin accounts.
export function useMyTasks(active: boolean, isAdmin: boolean) {
  const [myTasks, setMyTasks] = useState<Task[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  // Bumped to refetch: by Retry, and by any task change anywhere (the server
  // pings every open tab).
  const [token, setToken] = useState(0)
  const reload = () => setToken(t => t + 1)

  useEffect(() => {
    if (!active || isAdmin) return
    api<{ tasks: Task[] }>('/tasks', { auth: true })
      .then(({ tasks }) => { setMyTasks(tasks); setError(null) })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load tasks.'))
      .finally(() => setLoaded(true))
  }, [active, isAdmin, token])

  useEffect(() => {
    window.addEventListener(TASK_SYNC_EVENT, reload)
    return () => window.removeEventListener(TASK_SYNC_EVENT, reload)
  }, [])

  return { myTasks, loaded, error, reload }
}

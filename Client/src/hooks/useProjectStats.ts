import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Project } from '../lib/api'

export type ProjectStats = { active: number; inProgress: number; notStarted: number; onHold: number; loaded: boolean }

const EMPTY: ProjectStats = { active: 0, inProgress: 0, notStarted: 0, onHold: 0, loaded: false }

// "Active Projects" tile — every project that isn't Completed. The server
// already limits employees to projects on their own leads; admins get all.
export function useProjectStats(active: boolean) {
  const [projectStats, setProjectStats] = useState<ProjectStats>(EMPTY)
  const [error, setError] = useState<string | null>(null)

  function reload() {
    return api<{ projects: Project[] }>('/projects', { auth: true })
      .then(({ projects }) => {
        const open = projects.filter(p => p.status !== 'Completed')
        setProjectStats({
          active: open.length,
          inProgress: open.filter(p => p.status === 'In Progress').length,
          notStarted: open.filter(p => p.status === 'Not Started').length,
          onHold: open.filter(p => p.status === 'On Hold').length,
          loaded: true,
        })
        setError(null)
      })
      .catch(e => {
        setProjectStats(EMPTY)
        setError(e instanceof Error ? e.message : 'Failed to load project stats.')
      })
  }

  useEffect(() => { if (active) reload() }, [active])

  return { projectStats, error, reload }
}

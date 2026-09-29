import { useEffect, useState } from 'react'
import { api, ACTIVITY_SYNC_EVENT } from '../lib/api'
import type { Activity } from '../lib/api'

// Follow-up buckets (today / overdue / upcoming) from the activity log —
// admins see everyone's, employees see only their own leads' follow-ups
// (the server enforces the actual visibility rule).
export function useFollowUps(active: boolean) {
  const [followUps, setFollowUps] = useState({ today: [] as Activity[], overdue: [] as Activity[], upcoming: [] as Activity[], loaded: false })
  const [error, setError] = useState<string | null>(null)

  function reload() {
    return api<{ today: Activity[]; overdue: Activity[]; upcoming: Activity[] }>('/activities/follow-ups', { auth: true })
      .then(d => { setFollowUps({ ...d, loaded: true }); setError(null) })
      .catch(e => {
        setFollowUps({ today: [], overdue: [], upcoming: [], loaded: false })
        setError(e instanceof Error ? e.message : 'Failed to load follow-ups.')
      })
  }

  useEffect(() => {
    if (active) reload()
  }, [active])

  useEffect(() => {
    function onActivitySync() {
      if (active) reload()
    }
    window.addEventListener(ACTIVITY_SYNC_EVENT, onActivitySync)
    return () => window.removeEventListener(ACTIVITY_SYNC_EVENT, onActivitySync)
  }, [active])

  return { followUps, error, reload }
}

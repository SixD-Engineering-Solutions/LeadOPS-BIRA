import { useEffect, useState } from 'react'
import { api, ACTIVITY_SYNC_EVENT, ACTIVITY_TYPES } from '../../lib/api'
import type { Activity, ActivityType } from '../../lib/api'
import { ErrorBanner } from '../ErrorBanner'
import { DetailSection, inputCls, fmtDay } from './shared'
import { EmptyState } from '../EmptyState'
import { SkeletonRows } from '../Skeleton'

const todayInput = () => new Date().toISOString().slice(0, 10)

// Activity timeline for a lead — log form and history.
export function LeadActivitySection({ leadId }: { leadId: string }) {
  const [activities, setActivities] = useState<Activity[]>([])
  const [loadingActivities, setLoadingActivities] = useState(true)
  const [activitiesError, setActivitiesError] = useState<string | null>(null)
  const [logForm, setLogForm] = useState({ activityType: 'Call' as ActivityType, activityDate: todayInput(), notes: '', nextActionDate: '' })
  const [logging, setLogging] = useState(false)
  const [logError, setLogError] = useState<string | null>(null)

  function loadActivities() {
    setLoadingActivities(true)
    api<{ activities: Activity[] }>(`/activities?leadId=${leadId}`, { auth: true })
      .then(({ activities }) => { setActivities(activities); setActivitiesError(null) })
      .catch(e => setActivitiesError(e instanceof Error ? e.message : 'Failed to load activity.'))
      .finally(() => setLoadingActivities(false))
  }
  useEffect(() => { loadActivities() }, [leadId])

  // Live updates — an activity logged against this lead by anyone (this tab
  // included) re-syncs the timeline without a manual refresh.
  useEffect(() => {
    function onActivitySync(e: Event) {
      const syncedLeadId = (e as CustomEvent<{ leadId: string }>).detail?.leadId
      if (syncedLeadId === leadId) loadActivities()
    }
    window.addEventListener(ACTIVITY_SYNC_EVENT, onActivitySync)
    return () => window.removeEventListener(ACTIVITY_SYNC_EVENT, onActivitySync)
  }, [leadId])

  async function logActivity(e: React.FormEvent) {
    e.preventDefault()
    setLogError(null)
    setLogging(true)
    try {
      await api('/activities', {
        method: 'POST',
        auth: true,
        body: {
          leadId,
          activityType: logForm.activityType,
          activityDate: logForm.activityDate,
          notes: logForm.notes.trim() || undefined,
          nextActionDate: logForm.nextActionDate || undefined,
        },
      })
      setLogForm({ activityType: 'Call', activityDate: todayInput(), notes: '', nextActionDate: '' })
      loadActivities()
    } catch (e) {
      setLogError(e instanceof Error ? e.message : 'Could not log activity.')
    } finally {
      setLogging(false)
    }
  }

  return (
    <DetailSection title="Activity timeline" last>
      <form onSubmit={logActivity} className="mb-3 grid grid-cols-2 gap-2">
        <select value={logForm.activityType} onChange={e => setLogForm({ ...logForm, activityType: e.target.value as ActivityType })} className={inputCls}>
          {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input type="date" value={logForm.activityDate} onChange={e => setLogForm({ ...logForm, activityDate: e.target.value })} className={inputCls} />
        <textarea value={logForm.notes} onChange={e => setLogForm({ ...logForm, notes: e.target.value })} placeholder="Notes" rows={2} className={`${inputCls} col-span-2 resize-none`} />
        <label className="col-span-2 flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
          Next action date (optional)
          <input type="date" value={logForm.nextActionDate} onChange={e => setLogForm({ ...logForm, nextActionDate: e.target.value })} className={inputCls} />
        </label>
        {logError && <p className="col-span-2 text-xs text-red-500 dark:text-red-400">{logError}</p>}
        <div className="col-span-2">
          <button disabled={logging} className="rounded-xl bg-gradient-to-r from-rose-400 to-orange-400 px-4 py-1.5 text-xs font-semibold text-white transition hover:from-rose-500 hover:to-orange-500 disabled:opacity-60">
            {logging ? 'Logging…' : 'Log activity'}
          </button>
        </div>
      </form>

      {activitiesError ? (
        <ErrorBanner message={activitiesError} onRetry={loadActivities} className="my-2" />
      ) : loadingActivities ? (
        <SkeletonRows rows={2} compact />
      ) : activities.length === 0 ? (
        <EmptyState compact icon="clock" title="No activity logged yet" message="Log calls, visits and meetings — add a next action date to get a reminder." />
      ) : (
        <ul className="space-y-2.5 border-t border-gray-50 pt-3 dark:border-gray-800/60">
          {activities.map(a => (
            <li key={a.id} className="text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-gray-900 dark:text-gray-100">{a.activityType}</span>
                <span className="text-gray-400 dark:text-gray-400">{fmtDay(a.activityDate)}</span>
              </div>
              {a.notes && (
                <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-gray-600 dark:text-gray-400">
                  {a.notes.split('\n').map(line => line.trim()).filter(Boolean).map((line, i) => <li key={i}>{line}</li>)}
                </ul>
              )}
              <p className="mt-0.5 text-gray-400 dark:text-gray-400">
                {a.user ? `by ${a.user.userName || a.user.email}` : ''}
                {a.nextActionDate ? ` · next: ${fmtDay(a.nextActionDate)}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </DetailSection>
  )
}

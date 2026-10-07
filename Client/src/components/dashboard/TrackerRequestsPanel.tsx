import { useCallback, useEffect, useState } from 'react'
import { api, NOTIFICATION_EVENT } from '../../lib/api'
import type { IncomingTrackerRequest, TrackerChangeRequest, TrackerTable, TrackerValue } from '../../lib/api'
import { ErrorBanner } from '../ErrorBanner'
import { EmptyState } from '../EmptyState'
import { SkeletonRows } from '../Skeleton'
import { useTrackerFields, fieldLabel, showValue } from '../../lib/trackerEditFields'
import type { TrackerFieldDefs } from '../../lib/trackerEditFields'

const tableTitle = (defs: TrackerFieldDefs | null, table: TrackerTable) => defs?.[table].title ?? 'Tracker'

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const person = (p?: { userName: string | null; email: string }) => (p ? p.userName || p.email : 'Someone')

// Tracker change requests on the dashboard. Admins see the requests waiting
// for them, with each change laid out old → new, and approve or decline them
// here. Employees see their own requests still waiting for a decision (shown
// only when there are some). Refetches whenever a notification arrives, which
// every request event sends.
export function TrackerRequestsPanel({ isAdmin, onOpenTracker }: { isAdmin: boolean; onOpenTracker: () => void }) {
  const [requests, setRequests] = useState<(IncomingTrackerRequest | TrackerChangeRequest)[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { defs } = useTrackerFields()

  const load = useCallback(() => {
    api<{ requests: (IncomingTrackerRequest | TrackerChangeRequest)[] }>(isAdmin ? '/tracker/requests/incoming' : '/tracker/requests/mine', { auth: true })
      .then(({ requests }) => { setRequests(requests); setError(null) })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load tracker change requests.'))
      .finally(() => setLoaded(true))
  }, [isAdmin])
  useEffect(() => {
    load()
    window.addEventListener(NOTIFICATION_EVENT, load)
    return () => window.removeEventListener(NOTIFICATION_EVENT, load)
  }, [load])

  if (error) return <ErrorBanner message={error} onRetry={load} className="mt-6" />
  if (!isAdmin && loaded && requests.length === 0) return null

  return (
    <div className="mt-6 rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-3 dark:border-gray-800">
        <div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">
            {isAdmin ? 'Tracker change requests' : 'Your tracker change requests'}
            {requests.length > 0 && (
              <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-700 dark:bg-orange-950/60 dark:text-orange-300">{requests.length}</span>
            )}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {isAdmin ? 'Employees’ proposed edits to the tracker — the tracker changes only when you approve.' : 'Waiting for an admin to approve or decline.'}
          </p>
        </div>
        <button type="button" onClick={onOpenTracker} className="shrink-0 text-xs font-semibold text-orange-500 hover:text-orange-600">Open tracker</button>
      </div>
      {!loaded ? (
        <SkeletonRows rows={2} />
      ) : requests.length === 0 ? (
        <EmptyState compact icon="check" title="No requests waiting" message="When an employee asks to change the tracker, it shows up here for you to approve or decline." />
      ) : (
        <ul className="divide-y divide-gray-50 dark:divide-gray-800/60">
          {requests.map(r => isAdmin
            ? <IncomingRequest key={r.id} defs={defs} request={r as IncomingTrackerRequest} onDecided={() => setRequests(prev => prev.filter(x => x.id !== r.id))} />
            : <MyRequest key={r.id} defs={defs} request={r} />)}
        </ul>
      )}
    </div>
  )
}

function ChangeList({ defs, request, current }: { defs: TrackerFieldDefs | null; request: TrackerChangeRequest; current?: Record<string, TrackerValue> | null }) {
  return (
    <ul className="mt-2 flex flex-col gap-1 rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-800">
      {Object.entries(request.changes).map(([field, c]) => {
        // The row may have changed since the request was made (another edit
        // approved in between) — then show what it is now, not what it was.
        const now = current && field in current ? current[field] : c.from
        const moved = current && field in current && (now ?? null) !== (c.from ?? null)
        return (
          <li key={field} className="grid grid-cols-[minmax(0,9rem)_1fr] gap-2 text-xs">
            <span className="truncate font-semibold text-gray-600 dark:text-gray-300">{fieldLabel(defs, request.tableName, field)}</span>
            <span className="min-w-0 break-words">
              <span className="text-gray-500 line-through decoration-gray-400 dark:text-gray-400">{showValue(now)}</span>
              <span className="mx-1.5 text-gray-400">→</span>
              <span className="font-semibold text-gray-900 dark:text-gray-100">{showValue(c.to)}</span>
              {moved && <span className="ml-1.5 text-[11px] text-amber-600 dark:text-amber-400" title={`When requested it was: ${showValue(c.from)}`}>(changed since the request)</span>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function IncomingRequest({ defs, request, onDecided }: { defs: TrackerFieldDefs | null; request: IncomingTrackerRequest; onDecided: () => void }) {
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function decide(action: 'approve' | 'decline') {
    setBusy(action)
    setError(null)
    try {
      await api(`/tracker/requests/${request.id}/${action}`, {
        method: 'POST', auth: true, body: action === 'decline' ? { reason: reason.trim() || undefined } : {},
      })
      onDecided()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      setBusy(null)
    }
  }

  const btn = 'rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60'
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{request.rowLabel}</p>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {tableTitle(defs, request.tableName)} · from {person(request.requester)} · {when(request.createdAt)}
          </p>
        </div>
        {!declining && (
          <div className="flex shrink-0 gap-2">
            <button type="button" disabled={!!busy || !request.rowExists} onClick={() => decide('approve')}
              className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
              {busy === 'approve' ? 'Approving…' : 'Approve'}
            </button>
            <button type="button" disabled={!!busy} onClick={() => setDeclining(true)}
              className={`${btn} border border-gray-200 text-gray-700 hover:border-rose-300 hover:text-rose-600 dark:border-gray-700 dark:text-gray-200 dark:hover:border-rose-700 dark:hover:text-rose-400`}>
              Decline
            </button>
          </div>
        )}
      </div>

      {request.note && <p className="mt-2 text-xs italic text-gray-600 dark:text-gray-300">“{request.note}”</p>}
      <ChangeList defs={defs} request={request} current={request.current} />
      {!request.rowExists && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">This row no longer exists in the tracker (the sheet may have been re-imported), so it can only be declined.</p>}

      {declining && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={reason}
            onChange={e => setReason(e.target.value)}
            maxLength={500}
            autoFocus
            placeholder="Reason (optional) — sent to the employee"
            aria-label="Reason for declining"
            className="min-w-[14rem] flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-rose-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
          <button type="button" disabled={!!busy} onClick={() => decide('decline')} className={`${btn} bg-rose-600 text-white hover:bg-rose-700`}>
            {busy === 'decline' ? 'Declining…' : 'Decline request'}
          </button>
          <button type="button" disabled={!!busy} onClick={() => { setDeclining(false); setReason('') }} className={`${btn} text-gray-500 hover:text-gray-700 dark:text-gray-400`}>
            Cancel
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
    </li>
  )
}

function MyRequest({ defs, request }: { defs: TrackerFieldDefs | null; request: TrackerChangeRequest }) {
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{request.rowLabel}</p>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{tableTitle(defs, request.tableName)} · sent to {person(request.admin)} · {when(request.createdAt)}</p>
        </div>
        <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">Waiting</span>
      </div>
      <ChangeList defs={defs} request={request} />
    </li>
  )
}

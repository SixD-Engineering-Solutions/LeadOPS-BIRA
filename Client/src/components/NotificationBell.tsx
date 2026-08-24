import { useEffect, useRef, useState } from 'react'
import { api, getToken, BASE_URL, LEAD_SYNC_EVENT, TASK_SYNC_EVENT } from '../lib/api'
import type { Notification } from '../lib/api'

const bellPath = 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9'

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const [toasts, setToasts] = useState<Notification[]>([])
  const rootRef = useRef<HTMLDivElement>(null)
  const unread = notifications.filter(n => !n.isRead).length

  // Initial load.
  useEffect(() => {
    api<{ notifications: Notification[] }>('/notifications', { auth: true })
      .then(({ notifications }) => setNotifications(notifications))
      .catch(() => {})
  }, [])

  // Live stream — pushes a new notification the instant the backend creates one.
  useEffect(() => {
    let es: EventSource | null = null
    let retryTimer: ReturnType<typeof setTimeout>
    let cancelled = false

    function connect() {
      if (cancelled) return
      const token = getToken()
      if (!token) {
        // No token yet (e.g. it's still being acquired asynchronously) — keep
        // checking instead of giving up, or the live stream never starts.
        retryTimer = setTimeout(connect, 1000)
        return
      }
      es = new EventSource(`${BASE_URL}/notifications/stream?token=${encodeURIComponent(token)}`)
      es.onmessage = ev => {
        const n = JSON.parse(ev.data) as Notification
        setNotifications(prev => [n, ...prev])
        setToasts(prev => [...prev, n])
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== n.id)), 6000)
        if (n.leadId) window.dispatchEvent(new CustomEvent(LEAD_SYNC_EVENT, { detail: { leadId: n.leadId } }))
      }
      // Public "a lead changed" ping — sent to every connected user (not just
      // whoever it's personally about), so any open leads list stays in sync
      // with creates/updates/deletes made by anyone, not only ones assigned to us.
      es.addEventListener('lead-update', ev => {
        const { leadId } = JSON.parse((ev as MessageEvent).data) as { leadId: string }
        window.dispatchEvent(new CustomEvent(LEAD_SYNC_EVENT, { detail: { leadId } }))
      })
      es.addEventListener('task-update', ev => {
        const { taskId } = JSON.parse((ev as MessageEvent).data) as { taskId: string }
        window.dispatchEvent(new CustomEvent(TASK_SYNC_EVENT, { detail: { taskId } }))
      })
      es.onerror = () => {
        es?.close()
        if (!cancelled) retryTimer = setTimeout(connect, 3000)
      }
    }
    connect()

    return () => {
      cancelled = true
      clearTimeout(retryTimer)
      es?.close()
    }
  }, [])

  // Close dropdown on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  async function markRead(id: string) {
    setNotifications(prev => prev.map(n => (n.id === id ? { ...n, isRead: true } : n)))
    try { await api(`/notifications/${id}/read`, { method: 'PATCH', auth: true }) } catch { /* best-effort */ }
  }

  async function markAllRead() {
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))
    try { await api('/notifications/read-all', { method: 'POST', auth: true }) } catch { /* best-effort */ }
  }

  return (
    <>
      <div ref={rootRef} className="relative">
        <button
          onClick={() => setOpen(o => !o)}
          aria-label="Notifications"
          className="relative rounded-xl border border-gray-200 bg-white p-2 text-gray-500 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
            <path strokeLinecap="round" strokeLinejoin="round" d={bellPath} />
          </svg>
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 z-20 mt-2 w-80 rounded-2xl border border-gray-100 bg-white shadow-lg dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
              <span className="text-sm font-bold text-gray-900 dark:text-gray-100">Notifications</span>
              {unread > 0 && (
                <button onClick={markAllRead} className="text-xs font-medium text-orange-500 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-300">Mark all read</button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">No notifications yet.</p>
              ) : (
                notifications.map(n => (
                  <button
                    key={n.id}
                    onClick={() => !n.isRead && markRead(n.id)}
                    className={`flex w-full items-start gap-2 border-b border-gray-50 px-4 py-3 text-left transition hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800 ${n.isRead ? '' : 'bg-orange-50/50 dark:bg-orange-950/30'}`}
                  >
                    {!n.isRead && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-orange-500" />}
                    <span className={n.isRead ? 'ml-4' : ''}>
                      <span className="block text-sm text-gray-800 dark:text-gray-200">{n.message}</span>
                      <span className="mt-0.5 block text-xs text-gray-400 dark:text-gray-500">{timeAgo(n.createdAt)}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* toast pop-ups */}
      <div className="fixed right-6 top-20 z-50 flex w-80 flex-col gap-2">
        {toasts.map(t => (
          <div key={t.id} className="rounded-xl border border-orange-200 bg-white p-3.5 shadow-lg transition dark:border-orange-900 dark:bg-gray-900">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-rose-400 to-orange-400 text-white">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={bellPath} />
                </svg>
              </span>
              <p className="text-sm text-gray-800 dark:text-gray-200">{t.message}</p>
              <button onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))} className="ml-auto text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400">✕</button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

import { useEffect, useState } from 'react'
import { api, TASK_SYNC_EVENT, INVOICE_SYNC_EVENT, LEAD_SYNC_EVENT, NOTIFICATION_EVENT } from '../lib/api'
import type { Task, Invoice, Lead } from '../lib/api'

export type NavBadge = { count: number; tone: 'rose' | 'amber'; title: string }
export type NavBadges = Partial<Record<'lead-gen' | 'tasks' | 'invoices' | 'tracker', NavBadge>>

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const REFRESH_MS = 5 * 60_000

// The sidebar's "needs attention" counts: overdue tasks (your own, or
// everyone's for an admin), overdue invoices, and — for admins — leads nobody
// is working and tracker changes waiting for approval. Refreshed when any of
// those change (the server pings every open tab) and every few minutes, so a
// deadline passing shows up without a reload. A count that fails to load is
// simply left off.
export function useNavBadges(isAdmin: boolean): NavBadges {
  const [badges, setBadges] = useState<NavBadges>({})
  const [token, setToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    const now = Date.now()
    const set = (key: keyof NavBadges, badge: NavBadge | undefined) => {
      if (!cancelled) setBadges(prev => ({ ...prev, [key]: badge }))
    }
    const badge = (count: number, tone: NavBadge['tone'], title: string) => (count > 0 ? { count, tone, title } : undefined)

    api<{ tasks: Task[] }>('/tasks', { auth: true })
      .then(({ tasks }) => {
        const n = tasks.filter(t => t.status !== 'Done' && new Date(t.deadline).getTime() < now).length
        set('tasks', badge(n, 'rose', `${plural(n, 'task')} overdue`))
      })
      .catch(() => {})

    api<{ invoices: Invoice[] }>('/invoices', { auth: true })
      .then(({ invoices }) => {
        const n = invoices.filter(i => {
          const owed = i.amount - i.payments.reduce((s, p) => s + p.amountReceived, 0) > 0
          return owed && (i.status === 'Overdue' || (!!i.dueDate && new Date(i.dueDate).getTime() < now))
        }).length
        set('invoices', badge(n, 'rose', `${plural(n, 'invoice')} overdue`))
      })
      .catch(() => {})

    if (isAdmin) {
      api<{ leads: Lead[] }>('/leads', { auth: true })
        .then(({ leads }) => {
          const n = leads.filter(l => !l.assignedToUserId && l.status?.statusName !== 'Dead').length
          set('lead-gen', badge(n, 'amber', `${plural(n, 'lead')} unassigned`))
        })
        .catch(() => {})
      api<{ requests: unknown[] }>('/tracker/requests/incoming', { auth: true })
        .then(({ requests }) => set('tracker', badge(requests.length, 'amber', `${plural(requests.length, 'change request')} awaiting approval`)))
        .catch(() => {})
    }
    return () => { cancelled = true }
  }, [isAdmin, token])

  useEffect(() => {
    const bump = () => setToken(t => t + 1)
    const events = [TASK_SYNC_EVENT, INVOICE_SYNC_EVENT, LEAD_SYNC_EVENT, NOTIFICATION_EVENT]
    events.forEach(e => window.addEventListener(e, bump))
    const timer = window.setInterval(bump, REFRESH_MS)
    return () => {
      events.forEach(e => window.removeEventListener(e, bump))
      window.clearInterval(timer)
    }
  }, [])

  return badges
}

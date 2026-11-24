import { useEffect, useState } from 'react'
import { api, PROJECT_SYNC_EVENT, INVOICE_SYNC_EVENT, NOTIFICATION_EVENT } from '../lib/api'
import type { Invoice, Project } from '../lib/api'

export type BillingStats = {
  loaded: boolean
  /** Completed projects handed over by BD that have no invoice yet. */
  ready: Project[]
  /** Invoices with money still outstanding. */
  pending: Invoice[]
  pendingAmount: number
  /** …of which past their due date (or marked Overdue). */
  overdueCount: number
  overdueAmount: number
  collectedThisMonth: number
}

const EMPTY: BillingStats = { loaded: false, ready: [], pending: [], pendingAmount: 0, overdueCount: 0, overdueAmount: 0, collectedThisMonth: 0 }

const paidOf = (i: Invoice) => i.payments.reduce((s, p) => s + p.amountReceived, 0)

// The Accounts dashboard's numbers, from the same two lists the Projects and
// Invoices pages use — the server already limits Accounts to the projects
// handed over to them and gives them every invoice. Refreshes when a project
// or invoice changes anywhere, or a notification arrives (a project completing
// is one).
export function useBillingStats(active: boolean) {
  const [stats, setStats] = useState<BillingStats>(EMPTY)
  const [error, setError] = useState<string | null>(null)

  function reload() {
    return Promise.all([
      api<{ projects: Project[] }>('/projects', { auth: true }),
      api<{ invoices: Invoice[] }>('/invoices', { auth: true }),
    ])
      .then(([{ projects }, { invoices }]) => {
        const now = new Date()
        const invoiced = new Set(invoices.map(i => i.projectId))
        const pending = invoices.filter(i => i.amount - paidOf(i) > 0)
        const overdue = pending.filter(i => i.status === 'Overdue' || (!!i.dueDate && new Date(i.dueDate).getTime() < now.getTime()))
        const sameMonth = (ts: string) => { const d = new Date(ts); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() }
        setStats({
          loaded: true,
          ready: projects.filter(p => !!p.billingHandoffAt && !invoiced.has(p.id)),
          pending,
          pendingAmount: pending.reduce((s, i) => s + (i.amount - paidOf(i)), 0),
          overdueCount: overdue.length,
          overdueAmount: overdue.reduce((s, i) => s + (i.amount - paidOf(i)), 0),
          collectedThisMonth: invoices.flatMap(i => i.payments).filter(p => sameMonth(p.paymentDate)).reduce((s, p) => s + p.amountReceived, 0),
        })
        setError(null)
      })
      .catch(e => {
        setStats(EMPTY)
        setError(e instanceof Error ? e.message : 'Failed to load billing figures.')
      })
  }

  useEffect(() => { if (active) reload() }, [active])
  useEffect(() => {
    if (!active) return
    const refresh = () => { reload() }
    const events = [PROJECT_SYNC_EVENT, INVOICE_SYNC_EVENT, NOTIFICATION_EVENT]
    events.forEach(e => window.addEventListener(e, refresh))
    return () => events.forEach(e => window.removeEventListener(e, refresh))
  }, [active])

  return { stats, error, reload }
}

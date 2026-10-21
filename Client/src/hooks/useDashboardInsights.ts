import { useEffect, useState } from 'react'
import { api, PROPOSAL_SYNC_EVENT, PROJECT_SYNC_EVENT, INVOICE_SYNC_EVENT } from '../lib/api'
import type { Lead, Proposal, Project } from '../lib/api'

/** This month so far, and the same number of days at the start of last month. */
export type MonthCompare = { now: number; prev: number }
export type FunnelCounts = { leads: number; qualified: number; proposed: number; won: number }
export type TargetProgress = {
  fyLabel: string
  invoiced: number
  target: number
  /** How far through the financial year today is (0–1), for the "on pace" marker. */
  elapsed: number
  sectors: { name: string; invoiced: number; target: number }[]
}
export type Insights = {
  loaded: boolean
  prevMonth: string
  leadsNew: MonthCompare
  proposalValueAdded: MonthCompare
  wonValue: MonthCompare
  funnel: FunnelCounts
  target: TargetProgress | null
  /** Open proposals nobody has touched in 14+ days. */
  quietProposals: number
}

type SummaryRow = { sector: string | null; fyTotal: number | null; fyTarget: number | null }
const QUIET_DAYS = 14

function windows(now: Date) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const prevEnd = new Date(Math.min(prevStart.getTime() + (now.getTime() - start.getTime()), start.getTime() - 1))
  return { start, prevStart, prevEnd, prevMonth: prevStart.toLocaleDateString(undefined, { month: 'short' }) }
}

function compare<T>(rows: T[], dateOf: (r: T) => string | null | undefined, valueOf: (r: T) => number, now: Date): MonthCompare {
  const w = windows(now)
  let cur = 0, prev = 0
  for (const r of rows) {
    const d = dateOf(r)
    if (!d) continue
    const t = new Date(d).getTime()
    if (t >= w.start.getTime() && t <= now.getTime()) cur += valueOf(r)
    else if (t >= w.prevStart.getTime() && t <= w.prevEnd.getTime()) prev += valueOf(r)
  }
  return { now: cur, prev }
}

// Each step only counts leads that reached it, and a lead further along counts
// for every earlier step too — so the funnel never widens.
function funnelOf(leads: Lead[], proposals: Proposal[]): FunnelCounts {
  const ids = new Set(leads.map(l => l.id))
  const won = new Set([
    ...leads.filter(l => l.status?.statusCategory === 'Closed Won').map(l => l.id),
    ...proposals.filter(p => p.status === 'Won').map(p => p.leadId),
  ].filter(id => ids.has(id)))
  const proposed = new Set([...proposals.filter(p => p.status !== 'Draft').map(p => p.leadId).filter(id => ids.has(id)), ...won])
  const qualified = new Set([
    ...leads.filter(l => l.status?.statusName === 'Qualified' || l.status?.statusCategory === 'In Progress').map(l => l.id),
    ...proposed,
  ])
  return { leads: ids.size, qualified: qualified.size, proposed: proposed.size, won: won.size }
}

function targetOf(summary: SummaryRow[], now: Date): TargetProgress | null {
  const isTotal = (s: string | null) => (s ?? '').trim().toUpperCase() === 'TOTAL'
  const total = summary.find(r => isTotal(r.sector))
  if (!total?.fyTarget) return null
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  const fyStart = new Date(fyStartYear, 3, 1).getTime()
  const fyEnd = new Date(fyStartYear + 1, 3, 1).getTime()
  return {
    fyLabel: `FY ${fyStartYear}–${String(fyStartYear + 1).slice(2)}`,
    invoiced: total.fyTotal ?? 0,
    target: total.fyTarget,
    elapsed: Math.min(1, Math.max(0, (now.getTime() - fyStart) / (fyEnd - fyStart))),
    sectors: summary
      .filter(r => !isTotal(r.sector) && r.sector && (r.fyTarget ?? 0) > 0)
      .map(r => ({ name: r.sector!.trim(), invoiced: r.fyTotal ?? 0, target: r.fyTarget! }))
      .sort((a, b) => b.target - a.target),
  }
}

// The dashboard's month-on-month trends, funnel and FY target. Leads and
// proposals come from the hooks the tiles already use; this adds projects
// (a won proposal's project is created the moment it's won, so its date is
// the win date) and the Tracker's sector summary (the FY targets).
export function useDashboardInsights(active: boolean, leads: Lead[], proposals: Proposal[], ready: boolean): Insights {
  const [projects, setProjects] = useState<Project[]>([])
  const [summary, setSummary] = useState<SummaryRow[]>([])
  const [fetched, setFetched] = useState(false)
  const [token, setToken] = useState(0)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    Promise.all([
      api<{ projects: Project[] }>('/projects', { auth: true }).then(r => r.projects).catch(() => [] as Project[]),
      api<{ summary: SummaryRow[] }>('/tracker/invoices', { auth: true }).then(r => r.summary).catch(() => [] as SummaryRow[]),
    ]).then(([p, s]) => {
      if (cancelled) return
      setProjects(p)
      setSummary(s)
      setFetched(true)
    })
    return () => { cancelled = true }
  }, [active, token])

  useEffect(() => {
    const bump = () => setToken(t => t + 1)
    const events = [PROPOSAL_SYNC_EVENT, PROJECT_SYNC_EVENT, INVOICE_SYNC_EVENT]
    events.forEach(e => window.addEventListener(e, bump))
    return () => events.forEach(e => window.removeEventListener(e, bump))
  }, [])

  const now = new Date()
  const valueOf = new Map(proposals.map(p => [p.id, p.value ?? 0]))
  const wonProjects = projects.filter(p => p.proposalId && valueOf.has(p.proposalId))
  const quietBefore = now.getTime() - QUIET_DAYS * 86_400_000

  return {
    loaded: ready && fetched,
    prevMonth: windows(now).prevMonth,
    leadsNew: compare(leads, l => l.createdAt, () => 1, now),
    proposalValueAdded: compare(proposals, p => p.createdAt, p => p.value ?? 0, now),
    wonValue: compare(wonProjects, p => p.createdAt, p => valueOf.get(p.proposalId!) ?? 0, now),
    funnel: funnelOf(leads, proposals),
    target: targetOf(summary, now),
    quietProposals: proposals.filter(p => !['Won', 'Lost', 'Hold'].includes(p.status) && new Date(p.updatedAt).getTime() < quietBefore).length,
  }
}

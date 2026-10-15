import type { ReactNode } from 'react'
import type { Lead } from '../../lib/api'
import { formatINR } from '../../lib/format'
import { formatDate } from '../../lib/relativeTime'
import { PROPOSAL_STATUS_STYLES, PROJECT_STATUS_STYLES, DEFAULT_STATUS_STYLE } from '../../lib/statusStyles'
import type { LeadRecords } from './useLeadRecords'

type Kind = 'lead' | 'activity' | 'proposal' | 'won' | 'lost' | 'project' | 'invoice' | 'payment' | 'document'
export type TimelineEvent = { id: string; at: string; kind: Kind; title: ReactNode; body?: ReactNode; meta?: string }

const who = (u?: { userName: string | null; email: string } | null) => (u ? u.userName || u.email : null)
const lines = (text: string | null) => (text ?? '').split('\n').map(l => l.trim()).filter(Boolean)

// Icon + colour per kind of event, from the app's badge palette.
export const KIND: Record<Kind, { ring: string; path: string }> = {
  lead: { ring: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400', path: 'M12 4v16m8-8H4' },
  activity: { ring: 'bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300', path: 'M3 5a2 2 0 012-2h3.28a1 1 0 01.95.68l1.5 4.49a1 1 0 01-.5 1.21l-2.26 1.13a11.04 11.04 0 005.52 5.52l1.13-2.26a1 1 0 011.21-.5l4.49 1.5a1 1 0 01.68.95V19a2 2 0 01-2 2h-1C9.72 21 3 14.28 3 6V5z' },
  proposal: { ring: 'bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300', path: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.59a1 1 0 01.7.29l5.42 5.42a1 1 0 01.29.7V19a2 2 0 01-2 2z' },
  won: { ring: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300', path: 'M5 13l4 4L19 7' },
  lost: { ring: 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300', path: 'M6 18L18 6M6 6l12 12' },
  project: { ring: 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300', path: 'M21 13.26A23.93 23.93 0 0112 15c-3.18 0-6.22-.62-9-1.74M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m-3 14h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
  invoice: { ring: 'bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300', path: 'M9 14l6-6m4 13V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z' },
  payment: { ring: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300', path: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z' },
  document: { ring: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400', path: 'M15.17 7l-6.59 6.59a2 2 0 102.83 2.83l6.41-6.59a4 4 0 00-5.66-5.66l-6.41 6.59a6 6 0 108.49 8.49L20.5 13' },
}

export function buildTimeline(lead: Lead, r: LeadRecords): TimelineEvent[] {
  const events: TimelineEvent[] = [{
    id: `lead-${lead.id}`, at: lead.createdAt, kind: 'lead',
    title: 'Lead created',
    meta: [who(lead.createdByUser) && `by ${who(lead.createdByUser)}`, lead.source?.sourceName && `source: ${lead.source.sourceName}`].filter(Boolean).join(' · '),
  }]

  for (const a of r.activities) {
    events.push({
      id: `act-${a.id}`, at: a.activityDate, kind: 'activity',
      title: a.activityType === 'Mail' ? 'Mail sent' : `${a.activityType} logged`,
      body: lines(a.notes).length > 0 && <ul className="list-disc space-y-0.5 pl-4">{lines(a.notes).map((l, i) => <li key={i}>{l}</li>)}</ul>,
      meta: [who(a.user) && `by ${who(a.user)}`, a.nextActionDate && `next action ${formatDate(a.nextActionDate)}`].filter(Boolean).join(' · '),
    })
  }

  for (const p of r.proposals) {
    events.push({
      id: `prop-${p.id}`, at: p.submissionDate ?? p.createdAt, kind: 'proposal',
      title: <>Proposal <strong className="font-semibold">{p.proposalNumber}</strong> {p.submissionDate ? 'submitted' : 'raised'}{p.value != null && <> · {formatINR(p.value)}</>}</>,
      meta: [who(p.createdByUser) && `by ${who(p.createdByUser)}`, p.probabilityPct != null && `${p.probabilityPct}% probability`].filter(Boolean).join(' · '),
    })
    if (p.status === 'Won' || p.status === 'Lost') {
      events.push({
        id: `prop-${p.id}-${p.status}`, at: p.updatedAt, kind: p.status === 'Won' ? 'won' : 'lost',
        title: <>Proposal {p.proposalNumber} <span className={p.status === 'Won' ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'font-semibold text-rose-600 dark:text-rose-400'}>{p.status.toLowerCase()}</span></>,
        body: p.lostReason && <p className="whitespace-pre-line">{p.lostReason}</p>,
      })
    }
  }

  for (const pr of r.projects) {
    events.push({
      id: `proj-${pr.id}`, at: pr.createdAt, kind: 'project',
      title: <>Project <strong className="font-semibold">{pr.workOrderNo}</strong> created</>,
      body: pr.projectName,
      meta: [who(pr.responsibleUser) && `engineer: ${who(pr.responsibleUser)}`, pr.startDate && pr.completionDate && `${formatDate(pr.startDate)} → ${formatDate(pr.completionDate)}`].filter(Boolean).join(' · '),
    })
    if (pr.status === 'Completed') {
      events.push({ id: `proj-${pr.id}-done`, at: pr.completionDate ?? pr.updatedAt, kind: 'won', title: <>Project {pr.workOrderNo} completed</> })
    }
  }

  for (const inv of r.invoices) {
    events.push({
      id: `inv-${inv.id}`, at: inv.invoiceDate ?? inv.createdAt, kind: 'invoice',
      title: <>Invoice <strong className="font-semibold">{inv.invoiceNumber}</strong> raised · {formatINR(inv.amount)}</>,
      meta: inv.dueDate ? `due ${formatDate(inv.dueDate)}` : undefined,
    })
    for (const pay of inv.payments) {
      events.push({
        id: `pay-${pay.id}`, at: pay.paymentDate, kind: 'payment',
        title: <>Payment received · {formatINR(pay.amountReceived)} <span className="text-gray-400 dark:text-gray-500">against {inv.invoiceNumber}</span></>,
        body: pay.notes,
        meta: who(pay.recordedByUser) ? `recorded by ${who(pay.recordedByUser)}` : undefined,
      })
    }
  }

  for (const d of r.documents) {
    events.push({ id: `doc-${d.id}`, at: d.createdAt, kind: 'document', title: <>Uploaded <span className="font-medium">{d.fileName}</span></>, meta: who(d.uploadedByUser) ? `by ${who(d.uploadedByUser)}` : undefined })
  }

  return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
}

// The next follow-up anyone has booked on this lead, if it's still ahead (or
// today, or overdue but newer than any later activity).
export function nextFollowUp(r: LeadRecords) {
  const latest = [...r.activities].sort((a, b) => new Date(b.activityDate).getTime() - new Date(a.activityDate).getTime())[0]
  return latest?.nextActionDate ? { at: latest.nextActionDate, after: latest.activityType } : null
}

export const proposalTone = (s: string) => PROPOSAL_STATUS_STYLES[s] ?? DEFAULT_STATUS_STYLE
export const projectTone = (s: string) => PROJECT_STATUS_STYLES[s] ?? DEFAULT_STATUS_STYLE

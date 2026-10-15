import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api, LEAD_SYNC_EVENT } from '../lib/api'
import type { Lead } from '../lib/api'
import { DetailSection } from './leadDetail/shared'
import { LeadDocumentsSection } from './leadDetail/LeadDocumentsSection'
import { LeadProposalsSection } from './leadDetail/LeadProposalsSection'
import { LogActivityForm } from './leadDetail/LeadActivitySection'
import { LeadTimeline } from './leadDetail/LeadTimeline'
import { buildTimeline, nextFollowUp, proposalTone, projectTone } from './leadDetail/leadTimelineData'
import { useLeadRecords } from './leadDetail/useLeadRecords'
import { LEAD_STATUS_STYLES, DEFAULT_STATUS_STYLE } from '../lib/statusStyles'
import { formatINR, formatINRCompact, formatCount } from '../lib/format'
import { formatRelative, formatDateTime } from '../lib/relativeTime'
import { Drawer } from './Drawer'
import { StatusBadge, PersonChip } from './table/MenuSelect'
import { ErrorBanner } from './ErrorBanner'
import { SkeletonRows } from './Skeleton'

const who = (u?: { userName: string | null; email: string } | null) => (u ? u.userName || u.email : null)
type Tab = 'timeline' | 'details' | 'documents'

// Everything about one lead in a panel beside the list: who it is and who
// owns it, the deal at a glance (proposal, project, invoiced, outstanding),
// and its whole history as one timeline. Opened from a row on Leads,
// Proposals, Projects, Invoices and the Tracker, and from the dashboard's Lead
// Assignments — the same panel everywhere.
export default function LeadDetailModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('timeline')
  const { records, loading, error, reload } = useLeadRecords(lead.id)

  const proposal = records.proposals[0]
  const project = records.projects[0]
  const invoiced = records.invoices.reduce((s, i) => s + i.amount, 0)
  const collected = records.invoices.reduce((s, i) => s + i.payments.reduce((p, x) => p + x.amountReceived, 0), 0)
  const outstanding = Math.max(0, invoiced - collected)
  const events = buildTimeline(lead, records)
  const place = [lead.plant?.client?.clientName, lead.plant?.location?.city, lead.contact?.contactPersonName].filter(Boolean).join(' · ')

  const header = (
    <div className="pr-10">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Lead</span>
        <StatusBadge label={lead.status?.statusName ?? 'Submitted'} tone={LEAD_STATUS_STYLES[lead.status?.statusName ?? ''] ?? DEFAULT_STATUS_STYLE} />
      </div>
      <h2 className="mt-1.5 truncate text-lg font-bold text-gray-900 dark:text-gray-100">{lead.plant?.plantName ?? 'Lead'}</h2>
      {place && <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{place}</p>}
      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
        <Meta label="Assigned to"><PersonChip name={who(lead.assignedToUser)} /></Meta>
        <Meta label="BM/Contact"><PersonChip name={who(lead.bmUser)} empty="None" /></Meta>
        {lead.vertical && <Meta label="Vertical"><span className="text-xs text-gray-700 dark:text-gray-200">{lead.vertical.verticalName}</span></Meta>}
        {lead.sector && <Meta label="Sector"><span className="text-xs text-gray-700 dark:text-gray-200">{lead.sector.sectorName}</span></Meta>}
        <Meta label="Created"><time dateTime={lead.createdAt} title={formatDateTime(lead.createdAt)} className="text-xs text-gray-700 dark:text-gray-200">{formatRelative(lead.createdAt)}</time></Meta>
      </dl>
    </div>
  )

  return (
    <Drawer label={`Lead: ${lead.plant?.plantName ?? ''}`} onClose={onClose} header={header}>
      {/* the deal at a glance */}
      <div className="grid grid-cols-2 gap-3 px-6 pt-5 sm:grid-cols-4">
        <Stat label="Proposal">
          {proposal ? (
            <>
              <p className="truncate text-sm font-bold text-gray-900 dark:text-gray-100" title={proposal.value != null ? formatINR(proposal.value) : undefined}>{proposal.value != null ? formatINRCompact(proposal.value) : proposal.proposalNumber}</p>
              <div className="mt-1"><StatusBadge label={proposal.status} tone={proposalTone(proposal.status)} /></div>
            </>
          ) : <Muted>{loading ? '…' : 'None yet'}</Muted>}
        </Stat>
        <Stat label="Project">
          {project ? (
            <>
              <p className="truncate text-sm font-bold text-gray-900 dark:text-gray-100">{project.workOrderNo}</p>
              <div className="mt-1"><StatusBadge label={project.status} tone={projectTone(project.status)} /></div>
            </>
          ) : <Muted>{loading ? '…' : 'Not started'}</Muted>}
        </Stat>
        <Stat label="Invoiced">
          {records.invoices.length > 0 ? (
            <>
              <p className="text-sm font-bold tabular-nums text-gray-900 dark:text-gray-100" title={formatINR(invoiced)}>{formatINRCompact(invoiced)}</p>
              <p className="mt-1 text-[11px] text-gray-400">{formatCount(records.invoices.length)} invoice{records.invoices.length === 1 ? '' : 's'}</p>
            </>
          ) : <Muted>{loading ? '…' : 'Nothing yet'}</Muted>}
        </Stat>
        <Stat label="Outstanding">
          {records.invoices.length > 0 ? (
            <>
              <p className={`text-sm font-bold tabular-nums ${outstanding > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`} title={formatINR(outstanding)}>
                {outstanding > 0 ? formatINRCompact(outstanding) : 'Paid in full'}
              </p>
              <p className="mt-1 text-[11px] text-gray-400">{formatINRCompact(collected)} collected</p>
            </>
          ) : <Muted>—</Muted>}
        </Stat>
      </div>

      {/* tabs */}
      <div className="sticky top-0 z-10 mt-5 flex gap-1 border-b border-gray-100 bg-white/95 px-4 backdrop-blur dark:border-gray-800 dark:bg-gray-900/95" role="tablist" aria-label="Lead sections">
        {([['timeline', 'Timeline', events.length], ['details', 'Details', null], ['documents', 'Documents', records.documents.length]] as const).map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-xs font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-orange-300 ${tab === id ? 'border-orange-500 text-gray-900 dark:text-gray-100' : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
          >
            {label}
            {count != null && !loading && <span className={`rounded-full px-1.5 py-px text-[10px] tabular-nums ${tab === id ? 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>{count}</span>}
          </button>
        ))}
      </div>

      <div className="px-6 py-5">
        {tab === 'timeline' && (
          <>
            <LogActivityForm leadId={lead.id} onLogged={reload} />
            {error ? <ErrorBanner message={error} onRetry={reload} />
              : loading ? <SkeletonRows rows={4} compact />
              : <LeadTimeline events={events} followUp={nextFollowUp(records)} />}
          </>
        )}

        {tab === 'details' && (
          <>
            <DetailSection title="Plant">
              <DetailRow label="Name" value={lead.plant?.plantName} />
              <DetailRow label="Client" value={lead.plant?.client?.clientName} />
              <DetailRow label="Company" value={lead.plant?.companyName} />
              <DetailRow label="Plant code" value={lead.plant?.plantCode} />
              <DetailRow label="City" value={lead.plant?.location?.city} />
              <DetailRow label="State" value={lead.plant?.location?.state} />
              <DetailRow label="Country" value={lead.plant?.location?.country} />
              <DetailRow label="Address" value={lead.plant?.location?.address} />
            </DetailSection>

            <DetailSection title="Contact person">
              <DetailRow label="Name" value={lead.contact?.contactPersonName} />
              <DetailRow label="Designation" value={lead.contact?.designation} />
              <DetailRow label="Email" value={lead.contact?.mailId} href={lead.contact?.mailId ? `mailto:${lead.contact.mailId}` : undefined} />
              <DetailRow label="Phone" value={lead.contact?.contactPersonNumber} href={lead.contact?.contactPersonNumber ? `tel:${lead.contact.contactPersonNumber.replace(/\s/g, '')}` : undefined} />
              <DetailRow label="Alternate phone" value={lead.contact?.alternateNumber} />
              {!lead.contact && <p className="text-xs text-gray-400">No contact person recorded.</p>}
            </DetailSection>

            <DetailSection title="Classification">
              <DetailRow label="Vertical" value={lead.vertical?.verticalName} />
              <DetailRow label="Sector" value={lead.sector?.sectorName} />
              <DetailRow label="Source" value={lead.source?.sourceName} />
              <DetailRow label="Service type" value={lead.serviceType?.serviceTypeName} />
              {/* No longer captured on new leads; still shown for older ones that have it. */}
              {lead.event && <DetailRow label="Event" value={lead.event.eventName} />}
            </DetailSection>

            <DetailSection title="Ownership">
              <DetailRow label="Assigned to" value={who(lead.assignedToUser)} />
              <DetailRow label="Assigned by" value={who(lead.assignedByUser)} />
              <DetailRow label="BM/Contact" value={who(lead.bmUser)} />
              <DetailRow label="Created by" value={who(lead.createdByUser)} />
              <DetailRow label="Created" value={formatDateTime(lead.createdAt)} />
              <DetailRow label="Last updated" value={`${formatRelative(lead.updatedAt)} · ${formatDateTime(lead.updatedAt)}`} />
            </DetailSection>

            {(lead.remark || lead.lostReason) && (
              <DetailSection title="Notes">
                <BulletNote label="Remark" value={lead.remark} />
                {lead.lostReason && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm dark:border-rose-500/40 dark:bg-rose-500/10">
                    <span className="text-xs font-semibold text-rose-600 dark:text-rose-300">Reason lost</span>
                    <p className="mt-0.5 whitespace-pre-line text-gray-900 dark:text-gray-100">{lead.lostReason}</p>
                  </div>
                )}
              </DetailSection>
            )}

            <LeadProposalsSection leadId={lead.id} />
          </>
        )}

        {tab === 'documents' && <LeadDocumentsSection leadId={lead.id} onUploaded={reload} bare />}
      </div>
    </Drawer>
  )
}

// The same panel when only the lead's id is to hand (a proposal, project or
// invoice row): fetches the lead, and keeps it current if anyone changes it.
export function LeadDetailById({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const [lead, setLead] = useState<Lead | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [token, setToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    api<{ lead: Lead }>(`/leads/${leadId}`, { auth: true })
      .then(({ lead }) => { if (!cancelled) { setLead(lead); setError(null) } })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not open this lead.') })
    return () => { cancelled = true }
  }, [leadId, token])

  useEffect(() => {
    const onSync = (e: Event) => { if ((e as CustomEvent<{ leadId: string }>).detail?.leadId === leadId) setToken(t => t + 1) }
    window.addEventListener(LEAD_SYNC_EVENT, onSync)
    return () => window.removeEventListener(LEAD_SYNC_EVENT, onSync)
  }, [leadId])

  if (lead) return <LeadDetailModal lead={lead} onClose={onClose} />
  return (
    <Drawer label="Lead" onClose={onClose} header={<p className="text-sm font-semibold text-gray-500">{error ? 'Couldn’t open this lead' : 'Opening lead…'}</p>}>
      <div className="px-6 py-5">{error ? <ErrorBanner message={error} onRetry={() => setToken(t => t + 1)} /> : <SkeletonRows rows={5} compact />}</div>
    </Drawer>
  )
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2.5 dark:border-gray-800 dark:bg-gray-800/40">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{label}</p>
      {children}
    </div>
  )
}

const Muted = ({ children }: { children: ReactNode }) => <p className="text-sm text-gray-400 dark:text-gray-500">{children}</p>

function BulletNote({ label, value }: { label: string; value?: string | null }) {
  const lines = (value ?? '').split('\n').map(line => line.trim()).filter(Boolean)
  if (lines.length === 0) return null
  return (
    <div className="text-sm">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 font-medium text-gray-900 dark:text-gray-100">
        {lines.map((line, i) => <li key={i}>{line}</li>)}
      </ul>
    </div>
  )
}

function DetailRow({ label, value, href }: { label: string; value?: string | null; href?: string }) {
  if (!value) return null
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="shrink-0 text-gray-500 dark:text-gray-400">{label}</span>
      {href ? (
        <a href={href} className="truncate text-right font-medium text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300">{value}</a>
      ) : (
        <span className="truncate text-right font-medium text-gray-900 dark:text-gray-100">{value}</span>
      )}
    </div>
  )
}

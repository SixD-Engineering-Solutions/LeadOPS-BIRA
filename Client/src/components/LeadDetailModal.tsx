import type { Lead } from '../lib/api'
import { DetailSection } from './leadDetail/shared'
import { LeadDocumentsSection } from './leadDetail/LeadDocumentsSection'
import { LeadProposalsSection } from './leadDetail/LeadProposalsSection'
import { LeadActivitySection } from './leadDetail/LeadActivitySection'
import { LEAD_STATUS_STYLES, DEFAULT_STATUS_STYLE } from '../lib/statusStyles'
import { Modal } from './Modal'

const statusStyle = (name: string | null | undefined) => LEAD_STATUS_STYLES[name ?? ''] ?? DEFAULT_STATUS_STYLE
const fmt = (ts: string) => new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

// Full-detail modal for a single lead — plant, contact, classification,
// ownership, notes, and the activity timeline. Shared by the Leads page (row
// click) and the dashboard's Lead Assignments breakdown (lead click), so both
// surfaces show the exact same information for a given lead.
//
// The documents/proposals/activity sections each own their own fetch, form,
// and error/retry state (see components/leadDetail/) — they only need the
// lead's id, not the rest of this component.
export default function LeadDetailModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  return (
    <Modal
      title={lead.plant?.plantName ?? 'Lead details'}
      subtitle={
        <span className={`mt-0.5 inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusStyle(lead.status?.statusName)}`}>
          {lead.status?.statusName ?? 'Submitted'}
        </span>
      }
      onClose={onClose}
    >
      <DetailSection title="Client">
        <DetailRow label="Client" value={lead.plant?.client?.clientName} />
      </DetailSection>

      <DetailSection title="Plant">
        <DetailRow label="Name" value={lead.plant?.plantName} />
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
        <DetailRow label="Email" value={lead.contact?.mailId} isEmail />
        <DetailRow label="Phone" value={lead.contact?.contactPersonNumber} />
        <DetailRow label="Alternate phone" value={lead.contact?.alternateNumber} />
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
        <DetailRow label="Assigned to" value={lead.assignedToUser ? (lead.assignedToUser.userName || lead.assignedToUser.email) : undefined} />
        <DetailRow label="Assigned by" value={lead.assignedByUser ? (lead.assignedByUser.userName || lead.assignedByUser.email) : undefined} />
        <DetailRow label="BM/Contact" value={lead.bmUser ? (lead.bmUser.userName || lead.bmUser.email) : undefined} />
        <DetailRow label="Created by" value={lead.createdByUser ? (lead.createdByUser.userName || lead.createdByUser.email) : undefined} />
      </DetailSection>

      <DetailSection title="Notes">
        <BulletNote label="Remark" value={lead.remark} />
        {lead.lostReason && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm dark:border-rose-500/40 dark:bg-rose-500/10">
            <span className="text-xs font-semibold text-rose-600 dark:text-rose-300">Reason lost</span>
            <p className="mt-0.5 whitespace-pre-line text-gray-900 dark:text-gray-100">{lead.lostReason}</p>
          </div>
        )}
        <DetailRow label="Created" value={fmt(lead.createdAt)} />
        <DetailRow label="Updated" value={fmt(lead.updatedAt)} />
      </DetailSection>

      <LeadDocumentsSection leadId={lead.id} />
      <LeadProposalsSection leadId={lead.id} />
      <LeadActivitySection leadId={lead.id} />
    </Modal>
  )
}

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

function DetailRow({ label, value, isEmail = false }: { label: string; value?: string | null; isEmail?: boolean }) {
  if (!value) return null
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="shrink-0 text-gray-500 dark:text-gray-400">{label}</span>
      {isEmail ? (
        <a href={`mailto:${value}`} className="truncate text-right font-medium text-orange-500 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-300">{value}</a>
      ) : (
        <span className="truncate text-right font-medium text-gray-900 dark:text-gray-100">{value}</span>
      )}
    </div>
  )
}

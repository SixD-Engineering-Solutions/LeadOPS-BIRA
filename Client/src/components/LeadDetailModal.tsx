import type { Lead } from '../lib/api'

const STATUS_STYLES: Record<string, string> = {
  Submitted: 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-900/40 dark:text-sky-300 dark:border-sky-800',
  'In Process': 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800',
  Dead: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/40 dark:text-rose-300 dark:border-rose-800',
}
const statusStyle = (name: string | null | undefined) => STATUS_STYLES[name ?? ''] ?? 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'
const fmt = (ts: string) => new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

// Full-detail modal for a single lead — plant, contact, classification,
// ownership and notes. Shared by the Leads page (row click) and the
// dashboard's Lead Assignments breakdown (lead click), so both surfaces show
// the exact same information for a given lead.
export default function LeadDetailModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-gray-100 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{lead.plant?.plantName ?? 'Lead details'}</h3>
            <span className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusStyle(lead.status?.statusName)}`}>
              {lead.status?.statusName ?? 'Submitted'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 text-base leading-none"
            aria-label="Close"
          >✕</button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
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
          </DetailSection>

          <DetailSection title="Ownership">
            <DetailRow label="Assigned to" value={lead.assignedToUser ? (lead.assignedToUser.userName || lead.assignedToUser.email) : undefined} />
            <DetailRow label="Assigned by" value={lead.assignedByUser ? (lead.assignedByUser.userName || lead.assignedByUser.email) : undefined} />
            <DetailRow label="Created by" value={lead.createdByUser ? (lead.createdByUser.userName || lead.createdByUser.email) : undefined} />
          </DetailSection>

          <DetailSection title="Notes & timeline" last>
            <DetailRow label="Remark" value={lead.remark} />
            <DetailRow label="Created" value={fmt(lead.createdAt)} />
            <DetailRow label="Updated" value={fmt(lead.updatedAt)} />
          </DetailSection>
        </div>
      </div>
    </div>
  )
}

function DetailSection({ title, children, last = false }: { title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`${last ? '' : 'mb-4 border-b border-gray-50 pb-4 dark:border-gray-800/60'}`}>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{title}</p>
      <div className="space-y-1.5">{children}</div>
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

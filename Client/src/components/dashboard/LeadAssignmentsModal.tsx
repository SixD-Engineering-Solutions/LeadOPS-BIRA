import type { Lead, EmployeeUser } from '../../lib/api'
import { displayName, initials } from './DashboardSidebar'
import { Modal } from '../Modal'
import { EmptyState } from '../EmptyState'
import { LEAD_STATUS_STYLES, DEFAULT_STATUS_STYLE } from '../../lib/statusStyles'

const statusStyle = (name: string | null | undefined) => LEAD_STATUS_STYLES[name ?? ''] ?? DEFAULT_STATUS_STYLE
const fmtDate = (ts: string) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

function LeadRow({ lead, onSelect }: { lead: Lead; onSelect: (lead: Lead) => void }) {
  return (
    <li
      onClick={() => onSelect(lead)}
      className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-1.5 py-0.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800/60"
    >
      <span className="truncate text-gray-600 dark:text-gray-400">{lead.plant?.plantName ?? '—'}</span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="text-gray-400 dark:text-gray-400">{fmtDate(lead.updatedAt)}</span>
        <span className={`rounded-full border px-2 py-0.5 font-semibold ${statusStyle(lead.status?.statusName)}`}>
          {lead.status?.statusName ?? 'Submitted'}
        </span>
      </span>
    </li>
  )
}

// "Total Leads" tile's breakdown — for admins, every employee's assigned
// leads grouped by owner (plus an "Unassigned" bucket); for employees, just
// their own list. Shared by the dashboard home tile.
export function LeadAssignmentsModal({
  isAdmin, allLeads, assignmentGroups, unassignedLeads, onClose, onSelectLead,
}: {
  isAdmin: boolean
  allLeads: Lead[]
  assignmentGroups: { user: EmployeeUser; leads: Lead[] }[]
  unassignedLeads: Lead[]
  onClose: () => void
  onSelectLead: (lead: Lead) => void
}) {
  return (
    <Modal
      title={isAdmin ? 'Lead Assignments' : 'My Leads'}
      subtitle={`${allLeads.length} lead${allLeads.length === 1 ? '' : 's'} total${isAdmin && unassignedLeads.length > 0 ? ` · ${unassignedLeads.length} unassigned` : ''}`}
      onClose={onClose}
      bodyClassName="px-5 py-3"
    >
      {!isAdmin ? (
        allLeads.length === 0 ? (
          <EmptyState icon="users" title="No leads assigned to you yet" message="Leads an admin assigns to you will appear here." />
        ) : (
          <ul className="space-y-1.5 py-1">
            {allLeads.map(lead => <LeadRow key={lead.id} lead={lead} onSelect={onSelectLead} />)}
          </ul>
        )
      ) : assignmentGroups.length === 0 && unassignedLeads.length === 0 ? (
        <EmptyState icon="users" title="No leads yet" message="Leads raised on the Leads page will be grouped here by who they're assigned to." />
      ) : (
        <>
          {assignmentGroups.length === 0 && (
            <p className="py-2 text-center text-sm text-gray-400 dark:text-gray-400">No leads assigned to anyone yet.</p>
          )}
          {assignmentGroups.map(({ user: u, leads: userLeads }) => {
            const uName = u.userName || displayName(u.email)
            return (
              <div key={u.id} className="border-b border-gray-50 py-3 last:border-b-0 dark:border-gray-800/60">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-rose-400 to-orange-400 text-[11px] font-semibold text-white">
                    {initials(uName)}
                  </div>
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{uName}</p>
                  <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                    {userLeads.length} lead{userLeads.length === 1 ? '' : 's'}
                  </span>
                </div>
                <ul className="mt-2 ml-9 space-y-1.5">
                  {userLeads.map(lead => <LeadRow key={lead.id} lead={lead} onSelect={onSelectLead} />)}
                </ul>
              </div>
            )
          })}
          {unassignedLeads.length > 0 && (
            <div className="pt-3">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1z" />
                  </svg>
                </div>
                <p className="flex-1 text-sm font-semibold text-gray-500 dark:text-gray-400">Unassigned</p>
                <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  {unassignedLeads.length} lead{unassignedLeads.length === 1 ? '' : 's'}
                </span>
              </div>
              <ul className="mt-2 ml-9 space-y-1.5">
                {unassignedLeads.map(lead => <LeadRow key={lead.id} lead={lead} onSelect={onSelectLead} />)}
              </ul>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}

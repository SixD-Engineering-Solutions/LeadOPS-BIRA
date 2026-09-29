import type { Lead, EmployeeUser } from '../../lib/api'
import { displayName, initials } from './DashboardSidebar'

const STATUS_STYLES: Record<string, string> = {
  Submitted: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  'In Process': 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  Dead: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
}
const statusStyle = (name: string | null | undefined) => STATUS_STYLES[name ?? ''] ?? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
const fmtDate = (ts: string) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

function LeadRow({ lead, onSelect }: { lead: Lead; onSelect: (lead: Lead) => void }) {
  return (
    <li
      onClick={() => onSelect(lead)}
      className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-1.5 py-0.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800/60"
    >
      <span className="truncate text-gray-600 dark:text-gray-400">{lead.plant?.plantName ?? '—'}</span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="text-gray-400 dark:text-gray-500">{fmtDate(lead.updatedAt)}</span>
        <span className={`rounded-full px-2 py-0.5 font-semibold ${statusStyle(lead.status?.statusName)}`}>
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-gray-100 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{isAdmin ? 'Lead Assignments' : 'My Leads'}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {allLeads.length} lead{allLeads.length === 1 ? '' : 's'} total
              {isAdmin && unassignedLeads.length > 0 ? ` · ${unassignedLeads.length} unassigned` : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 text-base leading-none"
            aria-label="Close"
          >✕</button>
        </div>

        <div className="overflow-y-auto px-5 py-3">
          {!isAdmin ? (
            allLeads.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">No leads assigned to you yet.</p>
            ) : (
              <ul className="space-y-1.5 py-1">
                {allLeads.map(lead => <LeadRow key={lead.id} lead={lead} onSelect={onSelectLead} />)}
              </ul>
            )
          ) : assignmentGroups.length === 0 && unassignedLeads.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">No leads yet.</p>
          ) : (
            <>
              {assignmentGroups.length === 0 && (
                <p className="py-2 text-center text-sm text-gray-400 dark:text-gray-500">No leads assigned to anyone yet.</p>
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
        </div>
      </div>
    </div>
  )
}

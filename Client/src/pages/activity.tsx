import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Lead } from '../lib/api'
import { PageHeader } from '../components/PageHeader'
import { PAGE_CLASS } from '../lib/pageChrome'
import { DataGrid } from '../components/table/DataGrid'
import type { Column } from '../components/table/DataGrid'
import { TableToolbar, TableFooter, NoMatches, RefreshButton } from '../components/table/TableToolbar'
import { PersonChip, StatusBadge } from '../components/table/MenuSelect'
import { RelTime } from '../components/table/RelTime'
import { useTableView } from '../lib/useTableView'
import { ErrorBanner } from '../components/ErrorBanner'
import { EmptyState } from '../components/EmptyState'
import { SkeletonRows } from '../components/Skeleton'
import LeadDetailModal from '../components/LeadDetailModal'
import { BADGE_TONES } from '../lib/statusStyles'
import { toast } from '../lib/toast'

type Change = { field: string; from: string | null; to: string | null }
type Entry = {
  id: string
  at: string
  userName: string
  entity: 'lead' | 'proposal' | 'project' | 'invoice'
  entityId: string
  label: string
  leadId: string | null
  action: 'created' | 'updated' | 'deleted' | 'payment' | 'payment voided'
  summary: string | null
  changes: Change[]
}

const ENTITY: Record<Entry['entity'], string> = { lead: 'Lead', proposal: 'Proposal', project: 'Project', invoice: 'Invoice' }
const ACTION: Record<Entry['action'], { label: string; tone: string }> = {
  created: { label: 'Created', tone: BADGE_TONES.emerald },
  updated: { label: 'Changed', tone: BADGE_TONES.sky },
  deleted: { label: 'Deleted', tone: BADGE_TONES.rose },
  payment: { label: 'Payment logged', tone: BADGE_TONES.violet },
  'payment voided': { label: 'Payment voided', tone: BADGE_TONES.amber },
}
const ACTION_ORDER = Object.values(ACTION).map(a => a.label)
const SHOWN = 3
const dateTime = (ts: string) => new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }

function ChangeLine({ c, created }: { c: Change; created: boolean }) {
  return (
    <li className="truncate text-xs text-gray-600 dark:text-gray-300">
      <span className="font-medium text-gray-500 dark:text-gray-400">{c.field}:</span>{' '}
      {created ? <span className="text-gray-800 dark:text-gray-100">{c.to}</span> : (
        <>
          <span className="text-gray-400 line-through decoration-gray-300 dark:text-gray-500">{c.from ?? 'empty'}</span>
          <span className="mx-1 text-gray-400" aria-hidden="true">→</span>
          <span className="sr-only"> to </span>
          <span className="font-medium text-gray-900 dark:text-gray-100">{c.to ?? 'empty'}</span>
        </>
      )}
    </li>
  )
}

// Admins: who created, changed or deleted which lead, proposal, project or
// invoice, and when — with every changed field before and after. Recorded by
// the server as each change is saved (Server/src/utils/auditLog.ts).
export default function ActivityLog() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [openLead, setOpenLead] = useState<Lead | null>(null)

  function load() {
    api<{ entries: Entry[]; total: number }>('/activity-log', { auth: true })
      .then(r => { setEntries(r.entries); setTotal(r.total); setError(null) })
      .catch(e => setError(e instanceof Error ? e.message : 'Could not load the activity log.'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])
  const reload = () => { setLoading(true); load() }

  function openRecord(e: Entry) {
    if (!e.leadId) return
    api<{ lead: Lead }>(`/leads/${e.leadId}`, { auth: true })
      .then(r => setOpenLead(r.lead))
      .catch(() => toast('That lead has since been deleted — the log still keeps what happened to it.', { tone: 'error' }))
  }

  const view = useTableView<Entry>({
    id: 'activity-log',
    rows: entries,
    search: e => [e.userName, e.label, ENTITY[e.entity], ACTION[e.action].label, e.summary, ...e.changes.flatMap(c => [c.field, c.from, c.to])].join(' '),
    views: [
      { id: 'all', label: 'All' },
      { id: 'today', label: 'Today', match: e => new Date(e.at).getTime() >= startOfToday() },
      { id: 'week', label: 'Last 7 days', match: e => new Date(e.at).getTime() >= startOfToday() - 6 * 86_400_000 },
    ],
    filters: [
      { id: 'who', label: 'Who', value: e => e.userName },
      { id: 'type', label: 'Record', value: e => ENTITY[e.entity], order: Object.values(ENTITY) },
      { id: 'action', label: 'Action', value: e => ACTION[e.action].label, order: ACTION_ORDER },
    ],
    sorts: {
      when: { value: e => new Date(e.at).getTime(), firstDir: 'desc' },
      who: { value: e => e.userName },
      record: { value: e => e.label },
    },
    defaultSort: { id: 'when', dir: 'desc' },
  })

  const columns: Column<Entry>[] = [
    {
      id: 'when', header: 'When', sticky: true, className: 'min-w-[150px]',
      cell: e => (
        <div title={dateTime(e.at)}>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100"><RelTime ts={e.at} /></p>
          <p className="text-[11px] text-gray-400">{dateTime(e.at)}</p>
        </div>
      ),
      exportValue: e => dateTime(e.at),
    },
    { id: 'who', header: 'Who', cell: e => <PersonChip name={e.userName} />, exportValue: e => e.userName },
    {
      id: 'record', header: 'Record', className: 'min-w-[220px] max-w-[320px]',
      cell: e => (
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{ENTITY[e.entity]}</p>
          {e.leadId ? (
            <button type="button" onClick={ev => { ev.stopPropagation(); openRecord(e) }} className="block max-w-full truncate text-left text-sm font-medium text-gray-900 outline-none hover:text-orange-600 focus-visible:ring-2 focus-visible:ring-orange-300 dark:text-gray-100 dark:hover:text-orange-300">
              {e.label}
            </button>
          ) : <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{e.label}</p>}
        </div>
      ),
      exportValue: e => `${ENTITY[e.entity]}: ${e.label}`,
    },
    {
      id: 'what', header: 'What happened', className: 'min-w-[280px] max-w-[460px]',
      cell: e => {
        const created = e.action === 'created'
        const list = expanded === e.id ? e.changes : e.changes.slice(0, SHOWN)
        return (
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge label={ACTION[e.action].label} tone={ACTION[e.action].tone} />
              {e.summary && <span className="text-xs text-gray-500 dark:text-gray-400">{e.summary}</span>}
            </div>
            {list.length > 0 && <ul className="space-y-0.5">{list.map(c => <ChangeLine key={c.field} c={c} created={created} />)}</ul>}
            {e.changes.length > SHOWN && (
              <p className="text-[11px] font-medium text-orange-600 dark:text-orange-300">
                {expanded === e.id ? 'Show less' : `+${e.changes.length - SHOWN} more`}
              </p>
            )}
          </div>
        )
      },
      exportValue: e => [ACTION[e.action].label, e.summary, ...e.changes.map(c => e.action === 'created' ? `${c.field}: ${c.to}` : `${c.field}: ${c.from ?? 'empty'} → ${c.to ?? 'empty'}`)].filter(Boolean).join('; '),
    },
  ]

  return (
    <div className={PAGE_CLASS}>
      <PageHeader title="Activity log" subtitle="Who created, changed or deleted leads, proposals, projects and invoices — and exactly what changed." />

      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <TableToolbar view={view} noun="changes" placeholder="Search person, record, field or value…" exportCsv={{ filename: 'activity-log', columns }}>
          <RefreshButton onClick={reload} busy={loading} />
        </TableToolbar>

        {error && <ErrorBanner message={error} onRetry={reload} />}

        {loading && entries.length === 0 ? <SkeletonRows /> : entries.length === 0 && !error ? (
          <EmptyState icon="inbox" title="Nothing recorded yet" message="Every lead, proposal, project and invoice that’s created, changed or deleted from now on shows up here." />
        ) : (
          <>
            <DataGrid
              columns={columns}
              rows={view.rows}
              getKey={e => e.id}
              view={view}
              onRowClick={e => setExpanded(x => (x === e.id ? null : e.id))}
              isRowClickable={e => e.changes.length > SHOWN}
              rowLabel={e => `Show every change in this entry for ${e.label}`}
              empty={<NoMatches noun="changes" onClear={view.clearFilters} />}
              minWidth={860}
            />
            <TableFooter view={view} />
          </>
        )}
      </div>
      {total > entries.length && (
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">Showing the newest {entries.length.toLocaleString()} of {total.toLocaleString()} entries.</p>
      )}

      {openLead && <LeadDetailModal lead={openLead} onClose={() => setOpenLead(null)} />}
    </div>
  )
}

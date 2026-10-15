import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api, NOTIFICATION_EVENT } from '../lib/api'
import type { PipelineTrackerItem, InvoiceRegisterItem, InvoiceSectorSummary, TrackerTable, TrackerChangeRequest, LeadStatus } from '../lib/api'
import { useTrackerFields, rowLabelFor } from '../lib/trackerEditFields'
import type { TrackerFieldDefs } from '../lib/trackerEditFields'
import { isSummaryTotal, trackerFyStart, fyLabel, groupOfStatus, STATUS_GROUPS, FY_MONTHS } from '../lib/trackerReports'
import EditRowModal from '../components/tracker/EditRowModal'
import { ErrorBanner } from '../components/ErrorBanner'
import { stageStatusStyle, BADGE_TONES, DEFAULT_STATUS_STYLE } from '../lib/statusStyles'
import { formatLakhs, formatSheetValue } from '../lib/format'
import ReportsTab from '../components/tracker/ReportsTab'
import { EmptyState } from '../components/EmptyState'
import { SkeletonRows } from '../components/Skeleton'
import { LeadDetailById } from '../components/LeadDetailModal'
import { useTableView } from '../lib/useTableView'
import { DataGrid } from '../components/table/DataGrid'
import type { Column } from '../components/table/DataGrid'
import { TableToolbar, TableFooter, NoMatches, RefreshButton } from '../components/table/TableToolbar'
import { StatusBadge, PersonChip } from '../components/table/MenuSelect'
import { RowMenu } from '../components/table/RowMenu'
import type { RowAction } from '../components/table/RowMenu'
import { formatDate, formatDateTime } from '../lib/relativeTime'
import { comparePipelineValue, comparePipelineStage, expectedCloseOrder, priorityOrder, dsoOrder } from '../lib/trackerSorts'

// ─── formatting helpers ──────────────────────────────────────────────────────

const dash = <span className="text-gray-300 dark:text-gray-600">—</span>
const fmtLakhs = (v: number | null) => (v == null ? dash : formatLakhs(v))
const fmtText = (v: string | null) => (v && v.trim() ? v.trim() : dash)
const fmtDate = (ts: string | null) => (ts ? <span className="whitespace-nowrap" title={formatDateTime(ts)}>{formatDate(ts)}</span> : dash)
const clip = (v: string | null, width = 'max-w-[220px]') => <span className={`block truncate ${width}`} title={v ?? undefined}>{fmtText(v)}</span>
const text = (v: string | null) => v?.trim() || null

// A status string carries its own state — "✅ Order Received" / "🔵 Quoted" /
// "LOST due to price" — entered freehand in the original sheet. Classify it
// well enough to color it; this is display-only, so there's no fixed enum to
// validate against. Live-synced rows instead carry "<stage>: <status>" (e.g.
// "Proposal: Negotiation", see syncLeadToPipeline on the server) — colored
// exactly as that status is on its own page.
function pipelineRowStyle(row: PipelineTrackerItem): string {
  if (row.sourceLeadId) return stageStatusStyle(row.status)
  const s = (row.status ?? '').toLowerCase()
  if (s.includes('✅') || /order received|po received/.test(s)) return BADGE_TONES.emerald
  if (/\blost\b/.test(s) || s.startsWith('x ')) return BADGE_TONES.rose
  return BADGE_TONES.sky
}

// The sheet's DSO statuses lead with a coloured emoji ("🟢 Collected"); the
// badge colour already says it, so the badge drops the emoji.
const plainLabel = (s: string) => s.replace(/^[^\p{L}\p{N}]+/u, '')
function dsoTone(r: InvoiceRegisterItem): string {
  const o = dsoOrder(r)
  return o === 0 ? BADGE_TONES.rose : o === 1 ? BADGE_TONES.amber : o === 3 ? BADGE_TONES.emerald : DEFAULT_STATUS_STYLE
}

const AppBadge = () => (
  <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-px text-[10px] font-semibold text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300" title="Synced from the app — kept up to date automatically">App</span>
)
const PendingBadge = () => (
  <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-px text-[10px] font-semibold text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300" title="You've asked an admin to change this row — waiting for their decision.">Pending</span>
)

function Card({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="border-b border-gray-100 px-5 py-3 dark:border-gray-800">
        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{title}</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
      </div>
      {children}
    </div>
  )
}

// ─── editing ─────────────────────────────────────────────────────────────────

// What the tabs need to offer editing: admins edit an imported row directly,
// employees send a change request (see EditRowModal). Rows synced from the
// app's leads / invoices, and the summary's total row, aren't editable.
type RowEditor = {
  isAdmin: boolean
  defs: TrackerFieldDefs | null // editable fields, from the server; no edit actions until loaded
  pendingRowIds: Set<string> // rows this employee already has a request waiting on
  open: (table: TrackerTable, row: { id: string } & object) => void
  reloadToken: number // bumps after an edit, a request, or a notification, so the tab refetches
}

// The "Edit row" / "Request a change" item for a row's "⋯" menu.
function editAction(editor: RowEditor, table: TrackerTable, row: { id: string } & object): RowAction | null {
  if (!editor.defs) return null
  if (editor.pendingRowIds.has(row.id)) return { label: 'Change requested — awaiting approval', disabled: true, onSelect: () => {} }
  return { label: editor.isAdmin ? 'Edit row' : 'Request a change', onSelect: () => editor.open(table, row) }
}
const canEdit = (editor: RowEditor, row: { id: string }) => !!editor.defs && !editor.pendingRowIds.has(row.id)

// ─── Pipeline tab ────────────────────────────────────────────────────────────

function PipelineTab({ editor, leadStatuses }: { editor: RowEditor; leadStatuses: LeadStatus[] }) {
  const [items, setItems] = useState<PipelineTrackerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openLeadId, setOpenLeadId] = useState<string | null>(null)

  function load() {
    setLoading(true)
    api<{ items: PipelineTrackerItem[] }>('/tracker/pipeline', { auth: true })
      .then(({ items }) => { setItems(items); setError(null) })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load the pipeline tracker.'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [editor.reloadToken])

  const view = useTableView<PipelineTrackerItem>({
    id: 'tracker-pipeline',
    rows: items,
    search: r => [r.client, r.location, r.vertical, r.service, r.description, r.status, r.owner, r.bmContact, r.lastAction, r.notes].join(' '),
    views: [
      { id: 'all', label: 'All' },
      { id: 'app', label: 'From the app', match: r => !!r.sourceLeadId },
      { id: 'sheet', label: 'From the sheet', match: r => !r.sourceLeadId },
    ],
    filters: [
      { id: 'stage', label: 'Stage', value: r => groupOfStatus(r.status, leadStatuses), order: STATUS_GROUPS },
      { id: 'vertical', label: 'Vertical', value: r => text(r.vertical) },
      { id: 'owner', label: 'Owner', value: r => text(r.owner) },
      { id: 'priority', label: 'Priority', value: r => text(r.priority), order: ['High', 'Medium', 'Low'] },
    ],
    sorts: {
      client: { value: r => text(r.client) },
      vertical: { value: r => text(r.vertical) },
      service: { value: r => text(r.service) },
      value: { compare: comparePipelineValue, firstDir: 'desc' },
      status: { compare: (a, b, dir) => comparePipelineStage(a, b, dir, leadStatuses), firstDir: 'desc' },
      probability: { value: r => r.probabilityPct, firstDir: 'desc' },
      close: { value: expectedCloseOrder },
      owner: { value: r => text(r.owner) },
      priority: { value: priorityOrder },
    },
  })

  const columns: Column<PipelineTrackerItem>[] = [
    {
      id: 'client', header: 'Client', sticky: true, className: 'min-w-[200px] max-w-[260px]',
      cell: r => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100" title={r.client ?? undefined}>{r.client?.trim() || 'Unnamed client'}</p>
            {r.sourceLeadId && <AppBadge />}
            {editor.pendingRowIds.has(r.id) && <PendingBadge />}
          </div>
          {r.location && <p className="truncate text-xs text-gray-500 dark:text-gray-400">{r.location}</p>}
        </div>
      ),
    },
    { id: 'vertical', header: 'Vertical', cell: r => clip(r.vertical, 'max-w-[160px]') },
    { id: 'service', header: 'Service', cell: r => clip(r.service, 'max-w-[150px]') },
    { id: 'description', header: 'Description', cell: r => clip(r.description) },
    { id: 'value', header: 'Value', align: 'right', cell: r => (r.valueLakhs == null ? dash : <span className="font-medium text-gray-800 dark:text-gray-100">{formatSheetValue(r.valueLakhs, r.currency)}</span>) },
    { id: 'status', header: 'Status', cell: r => (r.status ? <span className="block max-w-[220px]" title={r.status}><StatusBadge label={r.status} tone={pipelineRowStyle(r)} /></span> : dash) },
    { id: 'probability', header: 'Probability', align: 'right', cell: r => (r.probabilityPct == null ? dash : `${Math.round(r.probabilityPct)}%`) },
    { id: 'close', header: 'Expected close', cell: r => fmtText(r.expectedClose) },
    { id: 'owner', header: 'Owner', cell: r => (text(r.owner) ? <PersonChip name={text(r.owner)} /> : dash) },
    { id: 'bm', header: 'BM/Contact', cell: r => fmtText(r.bmContact) },
    { id: 'followUp', header: 'Follow-up', cell: r => fmtText(r.followUpDate) },
    { id: 'lastAction', header: 'Last action', cell: r => clip(r.lastAction, 'max-w-[180px]') },
    { id: 'priority', header: 'Priority', cell: r => fmtText(r.priority) },
    { id: 'notes', header: 'Notes', cell: r => clip(r.notes) },
  ]

  const openRow = (r: PipelineTrackerItem) => (r.sourceLeadId ? setOpenLeadId(r.sourceLeadId) : editor.open('pipeline', r))

  return (
    <Card
      title="Pipeline"
      subtitle={<>Imported from the Pipeline Tracker sheet, plus every lead raised in the app (marked <AppBadge />, kept up to date) · {editor.isAdmin ? 'click a sheet row to edit it' : 'click a sheet row to request a change'}</>}
    >
      <TableToolbar view={view} noun="rows" placeholder="Search client, service, owner…">
        <RefreshButton onClick={load} busy={loading} />
      </TableToolbar>
      {error && <ErrorBanner message={error} onRetry={load} />}
      {loading && items.length === 0 ? (
        <SkeletonRows />
      ) : items.length === 0 && !error ? (
        <EmptyState icon="chart" title="No pipeline data yet" message="Imported sheet rows and leads raised in the app will appear here." />
      ) : (
        <>
          <DataGrid
            columns={columns}
            rows={view.rows}
            getKey={r => r.id}
            view={view}
            onRowClick={openRow}
            isRowClickable={r => !!r.sourceLeadId || canEdit(editor, r)}
            rowLabel={r => (r.sourceLeadId ? `Open the lead for ${r.client ?? 'this row'}` : `${editor.isAdmin ? 'Edit' : 'Request a change to'} ${r.client ?? 'this row'}`)}
            actions={r => (
              <RowMenu
                label={r.client ?? 'row'}
                actions={r.sourceLeadId ? [{ label: 'Open lead', onSelect: () => setOpenLeadId(r.sourceLeadId!) }] : [editAction(editor, 'pipeline', r)]}
              />
            )}
            empty={<NoMatches noun="rows" onClear={view.clearFilters} />}
            minWidth={2050}
          />
          <TableFooter view={view} />
        </>
      )}
      {openLeadId && <LeadDetailById leadId={openLeadId} onClose={() => setOpenLeadId(null)} />}
    </Card>
  )
}

// ─── Invoices tab ────────────────────────────────────────────────────────────

const SUMMARY_MONTHS: { key: keyof InvoiceSectorSummary; label: string; total?: boolean }[] = [
  { key: 'apr', label: 'Apr' }, { key: 'may', label: 'May' }, { key: 'jun', label: 'Jun' }, { key: 'q1Total', label: 'Q1', total: true },
  { key: 'jul', label: 'Jul' }, { key: 'aug', label: 'Aug' }, { key: 'sep', label: 'Sep' }, { key: 'q2Total', label: 'Q2', total: true },
  { key: 'oct', label: 'Oct' }, { key: 'nov', label: 'Nov' }, { key: 'dec', label: 'Dec' }, { key: 'q3Total', label: 'Q3', total: true },
  { key: 'jan', label: 'Jan' }, { key: 'feb', label: 'Feb' }, { key: 'mar', label: 'Mar' }, { key: 'q4Total', label: 'Q4', total: true },
]

// Achievement as a small bar plus the percentage (stored as a fraction).
function Achievement({ value }: { value: number | null }) {
  if (value == null) return dash
  const pct = Math.round(value * 100)
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800" aria-hidden="true">
        <span className={`block h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-orange-400' : 'bg-rose-400'}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </span>
      <span className="w-9 text-right">{pct}%</span>
    </span>
  )
}

function InvoicesTab({ editor }: { editor: RowEditor }) {
  const [summary, setSummary] = useState<InvoiceSectorSummary[]>([])
  const [register, setRegister] = useState<InvoiceRegisterItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  function load() {
    setLoading(true)
    api<{ summary: InvoiceSectorSummary[]; register: InvoiceRegisterItem[] }>('/tracker/invoices', { auth: true })
      .then(({ summary, register }) => { setSummary(summary); setRegister(register); setError(null) })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load the invoice tracker.'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [editor.reloadToken])

  const summaryColumns: Column<InvoiceSectorSummary>[] = [
    {
      id: 'sector', header: 'Sector', sticky: true, className: 'min-w-[170px]',
      cell: r => (
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{fmtText(r.sector)}</span>
          {editor.pendingRowIds.has(r.id) && <PendingBadge />}
        </div>
      ),
    },
    { id: 'bm', header: 'BM / Owner', cell: r => (isSummaryTotal(r) ? null : text(r.bmOwner) ? <PersonChip name={text(r.bmOwner)} /> : dash) },
    ...SUMMARY_MONTHS.map(m => ({
      id: m.key, header: m.total ? `${m.label} total` : m.label, align: 'right' as const,
      className: m.total ? 'bg-gray-50/70 font-semibold text-gray-800 dark:bg-gray-800/30 dark:text-gray-100' : '',
      cell: (r: InvoiceSectorSummary) => fmtLakhs(r[m.key] as number | null),
    })),
    { id: 'fyTotal', header: 'FY total', align: 'right', cell: r => <span className="font-semibold text-gray-900 dark:text-gray-100">{fmtLakhs(r.fyTotal)}</span> },
    { id: 'fyTarget', header: 'FY target', align: 'right', cell: r => fmtLakhs(r.fyTarget) },
    { id: 'achievement', header: 'Achievement', align: 'right', cell: r => <Achievement value={r.achievementPct} /> },
    { id: 'remarks', header: 'Remarks', cell: r => clip(r.remarks) },
  ]

  const isApp = (r: InvoiceRegisterItem) => !!r.sourceInvoiceId
  const view = useTableView<InvoiceRegisterItem>({
    id: 'tracker-register',
    rows: register,
    search: r => [r.client, r.sector, r.location, r.poNumber, r.invoiceNumber, r.serviceType, r.bmOwner, r.currentManager, r.dsoStatus, r.remarks].join(' '),
    views: [
      { id: 'all', label: 'All' },
      { id: 'app', label: 'From the app', match: isApp },
      { id: 'sheet', label: 'From the sheet', match: r => !isApp(r) },
      { id: 'outstanding', label: 'Outstanding', match: r => (r.balanceOutstandingLakhs ?? 0) > 0.009 },
      { id: 'overdue', label: 'Overdue', match: r => dsoOrder(r) === 0 },
    ],
    filters: [
      { id: 'sector', label: 'Sector', value: r => text(r.sector) },
      { id: 'dso', label: 'Collection', value: r => (r.dsoStatus ? plainLabel(r.dsoStatus.trim()) : null), order: ['Overdue', 'Pending', 'Not Invoiced', 'Collected'] },
      { id: 'paid', label: 'Payment received', value: r => text(r.paymentReceived), order: ['Yes', 'No'] },
      { id: 'bm', label: 'BM owner', value: r => text(r.bmOwner) },
      { id: 'month', label: 'Invoice month', value: r => text(r.invoiceMonth), order: FY_MONTHS.map(m => m.label) },
    ],
    sorts: {
      client: { value: r => text(r.client) },
      invoice: { value: r => text(r.invoiceNumber) },
      date: { value: r => (r.invoiceDate ? new Date(r.invoiceDate).getTime() : null), firstDir: 'desc' },
      amount: { value: r => r.invoiceAmountLakhs, firstDir: 'desc' },
      collected: { value: r => r.amountCollectedLakhs, firstDir: 'desc' },
      outstanding: { value: r => r.balanceOutstandingLakhs, firstDir: 'desc' },
      dso: { value: dsoOrder },
      days: { value: r => r.daysToCollect, firstDir: 'desc' },
      orderValue: { value: r => r.orderValueLakhs, firstDir: 'desc' },
      bm: { value: r => text(r.bmOwner) },
    },
  })

  const registerColumns: Column<InvoiceRegisterItem>[] = [
    {
      id: 'client', header: 'Client', sticky: true, className: 'min-w-[210px] max-w-[260px]',
      cell: r => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100" title={r.client ?? undefined}>{r.client?.trim() || 'Unnamed client'}</p>
            {isApp(r) && <AppBadge />}
            {editor.pendingRowIds.has(r.id) && <PendingBadge />}
          </div>
          <p className="truncate text-xs text-gray-500 dark:text-gray-400">{[r.sector, r.location].map(v => v?.trim()).filter(Boolean).join(' · ') || '—'}</p>
        </div>
      ),
    },
    { id: 'invoice', header: 'Invoice no.', cell: r => <span className="whitespace-nowrap">{fmtText(r.invoiceNumber)}</span> },
    { id: 'date', header: 'Invoice date', cell: r => fmtDate(r.invoiceDate) },
    { id: 'amount', header: 'Amount', align: 'right', cell: r => <span className="font-medium text-gray-800 dark:text-gray-100">{fmtLakhs(r.invoiceAmountLakhs)}</span> },
    { id: 'collected', header: 'Collected', align: 'right', cell: r => fmtLakhs(r.amountCollectedLakhs) },
    {
      id: 'outstanding', header: 'Outstanding', align: 'right',
      cell: r => ((r.balanceOutstandingLakhs ?? 0) > 0.009 ? <span className="font-semibold text-rose-600 dark:text-rose-400">{formatLakhs(r.balanceOutstandingLakhs!)}</span> : fmtLakhs(r.balanceOutstandingLakhs)),
    },
    { id: 'dso', header: 'Collection', cell: r => (r.dsoStatus ? <StatusBadge label={plainLabel(r.dsoStatus.trim())} tone={dsoTone(r)} /> : dash) },
    { id: 'days', header: 'Days to collect', align: 'right', cell: r => (r.daysToCollect == null ? dash : r.daysToCollect) },
    { id: 'due', header: 'Due', cell: r => fmtText(r.dueDate) },
    { id: 'paid', header: 'Paid?', cell: r => fmtText(r.paymentReceived) },
    { id: 'paymentDate', header: 'Payment date', cell: r => fmtDate(r.paymentDate) },
    { id: 'po', header: 'PO / WO number', cell: r => clip(r.poNumber, 'max-w-[170px]') },
    { id: 'orderValue', header: 'Order value', align: 'right', cell: r => fmtLakhs(r.orderValueLakhs) },
    { id: 'service', header: 'Service type', cell: r => clip(r.serviceType, 'max-w-[150px]') },
    { id: 'bm', header: 'BM owner', cell: r => (text(r.bmOwner) ? <PersonChip name={text(r.bmOwner)} /> : dash) },
    { id: 'manager', header: 'Current manager', cell: r => fmtText(r.currentManager) },
    { id: 'completion', header: 'Work completion', cell: r => fmtText(r.workCompletionDate) },
    { id: 'raised', header: 'Raised?', cell: r => fmtText(r.invoiceRaised) },
    { id: 'month', header: 'Month', cell: r => fmtText(r.invoiceMonth) },
    { id: 'tds', header: 'TDS', align: 'right', cell: r => fmtLakhs(r.tdsDeduction) },
    { id: 'remarks', header: 'Remarks / action', cell: r => clip(r.remarks, 'max-w-[200px]') },
    { id: 'nextAction', header: 'Next action', cell: r => fmtText(r.nextActionDate) },
  ]

  if (loading && summary.length === 0 && register.length === 0) return <SkeletonRows />
  if (error) return <ErrorBanner message={error} onRetry={load} className="" />

  return (
    <div className="flex flex-col gap-6">
      <Card title="Monthly summary by sector" subtitle={`₹ Lakhs, against ${fyLabel(trackerFyStart(register))} targets · quarter and FY totals and the total row recalculate when an amount changes`}>
        {summary.length === 0 ? (
          <EmptyState icon="chart" title="No sector summary yet" message="The FY sector summary from the tracking sheet will appear here once imported." />
        ) : (
          <DataGrid
            columns={summaryColumns}
            rows={summary}
            getKey={r => r.id}
            onRowClick={r => editor.open('sectorSummary', r)}
            isRowClickable={r => !isSummaryTotal(r) && canEdit(editor, r)}
            rowLabel={r => `${editor.isAdmin ? 'Edit' : 'Request a change to'} ${r.sector ?? 'this sector'}`}
            rowClassName={r => (isSummaryTotal(r) ? 'bg-gray-50 font-semibold dark:bg-gray-800/40 [&>td]:border-t [&>td]:border-gray-200 dark:[&>td]:border-gray-700' : '')}
            actions={r => (isSummaryTotal(r) ? null : <RowMenu label={r.sector ?? 'sector'} actions={[editAction(editor, 'sectorSummary', r)]} />)}
            minWidth={1900}
            maxHeight="none"
          />
        )}
      </Card>

      <Card
        title="Invoice register"
        subtitle={<>Order-wise invoice and collection detail from the sheet, plus every invoice generated in the app (<AppBadge />, kept up to date as it's paid) · {editor.isAdmin ? 'click a sheet row to edit it' : 'click a sheet row to request a change'}</>}
      >
        <TableToolbar view={view} noun="invoices" placeholder="Search client, invoice, PO, sector…">
          <RefreshButton onClick={load} busy={loading} />
        </TableToolbar>
        {register.length === 0 ? (
          <EmptyState icon="receipt" title="No invoices in the register yet" message="Rows imported from the tracking sheet, and invoices generated in the app, appear here." />
        ) : (
          <>
            <DataGrid
              columns={registerColumns}
              rows={view.rows}
              getKey={r => r.id}
              view={view}
              onRowClick={r => editor.open('invoiceRegister', r)}
              isRowClickable={r => !isApp(r) && canEdit(editor, r)}
              rowLabel={r => `${editor.isAdmin ? 'Edit' : 'Request a change to'} ${r.client ?? 'this row'}`}
              actions={r => (isApp(r) ? null : <RowMenu label={r.client ?? 'row'} actions={[editAction(editor, 'invoiceRegister', r)]} />)}
              empty={<NoMatches noun="invoices" onClear={view.clearFilters} />}
              minWidth={2600}
            />
            <TableFooter view={view} />
          </>
        )}
      </Card>
    </div>
  )
}

// ─── page ────────────────────────────────────────────────────────────────────

const TAB_LABELS = { pipeline: 'Pipeline', invoices: 'Invoices', report: 'Report' } as const

export default function Tracker({ isAdmin, currentUserId }: { isAdmin: boolean; currentUserId: string }) {
  const [tab, setTab] = useState<'pipeline' | 'invoices' | 'report'>('pipeline')
  const [editing, setEditing] = useState<{ table: TrackerTable; row: { id: string } & object } | null>(null)
  const [pendingRowIds, setPendingRowIds] = useState<Set<string>>(new Set())
  const [reloadToken, setReloadToken] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [leadStatuses, setLeadStatuses] = useState<LeadStatus[]>([])
  const { defs, error: fieldsError } = useTrackerFields()

  // The app's lead statuses, whose categories decide which stage an app lead
  // is at (see pipelineStatus.ts). Without them, statuses are read by name.
  useEffect(() => {
    api<{ leadStatuses: LeadStatus[] }>('/lead-statuses', { auth: true })
      .then(({ leadStatuses }) => setLeadStatuses(leadStatuses))
      .catch(() => {})
  }, [])

  // A notification can mean a request was approved (the tracker changed) or
  // declined — refetch the tab and the "Pending" badges either way.
  useEffect(() => {
    const onNotification = () => setReloadToken(t => t + 1)
    window.addEventListener(NOTIFICATION_EVENT, onNotification)
    return () => window.removeEventListener(NOTIFICATION_EVENT, onNotification)
  }, [])

  // An employee's own waiting requests, to mark those rows "Pending".
  useEffect(() => {
    if (isAdmin) return
    api<{ requests: TrackerChangeRequest[] }>('/tracker/requests/mine', { auth: true })
      .then(({ requests }) => setPendingRowIds(new Set(requests.map(r => r.rowId))))
      .catch(() => {}) // the badge is a convenience; the server still refuses a duplicate request
  }, [isAdmin, reloadToken])

  const editor: RowEditor = {
    isAdmin,
    defs,
    pendingRowIds,
    reloadToken,
    open: (table, row) => setEditing({ table, row }),
  }

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      <div className="mb-5">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Tracker</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Pipeline and invoice data imported from the tracking sheet, kept up to date with the app.</p>
      </div>

      <div className="mb-5 inline-flex rounded-xl border border-gray-200 bg-white p-1 dark:border-gray-800 dark:bg-gray-900" role="tablist" aria-label="Tracker sections">
        {(Object.keys(TAB_LABELS) as (keyof typeof TAB_LABELS)[]).map(t => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${
              tab === t
                ? 'bg-gradient-to-r from-rose-400 to-orange-400 text-white'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* The edit / request actions need the field list from the server — say
          so instead of silently showing none. */}
      {fieldsError && (
        <div role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
          {isAdmin ? 'Editing' : 'Requesting changes'} isn’t available right now: {fieldsError} Reload the page to try again.
        </div>
      )}

      {notice && (
        <div role="status" className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="text-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-200">✕</button>
        </div>
      )}

      {tab === 'pipeline' ? <PipelineTab editor={editor} leadStatuses={leadStatuses} /> : tab === 'invoices' ? <InvoicesTab editor={editor} /> : <ReportsTab leadStatuses={leadStatuses} />}

      {editing && defs && (
        <EditRowModal
          table={editing.table}
          def={defs[editing.table]}
          row={editing.row as { id: string } & Record<string, unknown>}
          rowLabel={rowLabelFor(defs[editing.table], editing.row as Record<string, unknown>)}
          isAdmin={isAdmin}
          currentUserId={currentUserId}
          onClose={() => setEditing(null)}
          onDone={message => { setEditing(null); setNotice(message); setReloadToken(t => t + 1) }}
        />
      )}
    </div>
  )
}

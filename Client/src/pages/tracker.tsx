import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { PipelineTrackerItem, InvoiceRegisterItem, InvoiceSectorSummary } from '../lib/api'
import { ErrorBanner } from '../components/ErrorBanner'
import { stageStatusStyle } from '../lib/statusStyles'
import ReportsTab from '../components/tracker/ReportsTab'

// ─── formatting helpers ──────────────────────────────────────────────────────

const dash = <span className="text-gray-300 dark:text-gray-600">—</span>
const fmtLakhs = (v: number | null) => (v == null ? dash : `₹${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}L`)
const fmtPct = (v: number | null, fraction = false) => (v == null ? dash : `${Math.round(fraction ? v * 100 : v)}%`)
const fmtText = (v: string | null) => (v && v.trim() ? v.trim() : dash)
const fmtDate = (ts: string | null) => (ts ? new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : dash)

// A status string carries its own state — "✅ Order Received" / "🔵 Quoted" /
// "LOST due to price" — entered freehand in the original sheet. Classify it
// well enough to color it; this is display-only, so there's no fixed enum to
// validate against.
// Live-synced rows instead carry "<stage>: <status>" (e.g. "Proposal: Negotiation",
// see syncLeadToPipeline on the server) — colored exactly as that status is on
// its own page.
function pipelineRowStyle(row: PipelineTrackerItem): string {
  if (row.sourceLeadId) return stageStatusStyle(row.status)
  return pipelineStatusStyle(row.status)
}

function pipelineStatusStyle(status: string | null): string {
  const s = (status ?? '').toLowerCase()
  if (s.includes('✅') || /order received|po received/.test(s)) {
    return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800'
  }
  if (/\blost\b/.test(s) || s.startsWith('x ')) {
    return 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/40 dark:text-rose-300 dark:border-rose-800'
  }
  return 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-900/40 dark:text-sky-300 dark:border-sky-800'
}

// ─── generic table shell ─────────────────────────────────────────────────────

type Col<T> = { label: string; render: (row: T) => React.ReactNode; emphasize?: boolean }

function DataTable<T>({ columns, rows, getKey, minWidth = 900 }: { columns: Col<T>[]; rows: T[]; getKey: (row: T) => string; minWidth?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" style={{ minWidth }}>
        <thead>
          <tr className="border-b border-gray-100 text-xs uppercase tracking-wider text-gray-400 dark:border-gray-800 dark:text-gray-500">
            {columns.map(c => <th key={c.label} className="whitespace-nowrap px-3 py-3 font-semibold first:pl-5">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={getKey(row)} className="border-b border-gray-50 dark:border-gray-800">
              {columns.map(c => (
                <td key={c.label} className={`whitespace-nowrap px-3 py-3 text-xs first:pl-5 ${c.emphasize ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-400'}`}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Card({ title, subtitle, headerAction, highlight = false, children }: {
  title: string
  subtitle: string
  headerAction?: React.ReactNode
  highlight?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={`rounded-2xl border shadow-sm ${highlight ? 'border-amber-300 bg-amber-50/60 dark:border-amber-700 dark:bg-amber-950/20' : 'border-gray-100 bg-white dark:border-gray-800 dark:bg-gray-900'}`}>
      <div className={`flex items-start justify-between gap-3 border-b px-5 py-3 ${highlight ? 'border-amber-200 dark:border-amber-800' : 'border-gray-100 dark:border-gray-800'}`}>
        <div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{title}</h3>
          <p className="text-xs text-gray-400 dark:text-gray-500">{subtitle}</p>
        </div>
        {headerAction}
      </div>
      {children}
    </div>
  )
}

// ─── Pipeline tab ────────────────────────────────────────────────────────────

function PipelineTab({ isAdmin }: { isAdmin: boolean }) {
  const [items, setItems] = useState<PipelineTrackerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const [clearError, setClearError] = useState<string | null>(null)

  function load() {
    setLoading(true)
    api<{ items: PipelineTrackerItem[] }>('/tracker/pipeline', { auth: true })
      .then(({ items }) => { setItems(items); setError(null) })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load the pipeline tracker.'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const trialItems = items.filter(i => i.sourceLeadId)
  const importedItems = items.filter(i => !i.sourceLeadId)

  async function handleClearTrialEntries() {
    if (!confirm(`Clear all ${trialItems.length} trial entr${trialItems.length === 1 ? 'y' : 'ies'}? This only removes live-synced rows — imported data is untouched.`)) return
    setClearing(true)
    setClearError(null)
    try {
      await api('/tracker/pipeline/trial-entries', { method: 'DELETE', auth: true })
      load()
    } catch (e) {
      setClearError(e instanceof Error ? e.message : 'Could not clear trial entries.')
    } finally {
      setClearing(false)
    }
  }

  const columns: Col<PipelineTrackerItem>[] = [
    { label: 'Vertical', render: r => fmtText(r.vertical) },
    { label: 'Client', render: r => fmtText(r.client), emphasize: true },
    { label: 'Location', render: r => fmtText(r.location) },
    { label: 'Service', render: r => fmtText(r.service) },
    { label: 'Description', render: r => <span className="block max-w-[220px] truncate" title={r.description ?? undefined}>{fmtText(r.description)}</span> },
    { label: 'Value', render: r => fmtLakhs(r.valueLakhs) },
    { label: 'Currency', render: r => fmtText(r.currency) },
    { label: 'Status', render: r => <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${pipelineRowStyle(r)}`}>{fmtText(r.status)}</span> },
    { label: 'Probability', render: r => fmtPct(r.probabilityPct) },
    { label: 'Expected close', render: r => fmtText(r.expectedClose) },
    { label: 'Owner', render: r => fmtText(r.owner) },
    { label: 'BM/Contact', render: r => fmtText(r.bmContact) },
    { label: 'Follow-up date', render: r => fmtText(r.followUpDate) },
    { label: 'Last action', render: r => <span className="block max-w-[180px] truncate" title={r.lastAction ?? undefined}>{fmtText(r.lastAction)}</span> },
    { label: 'Priority', render: r => fmtText(r.priority) },
    { label: 'Notes', render: r => <span className="block max-w-[220px] truncate" title={r.notes ?? undefined}>{fmtText(r.notes)}</span> },
  ]

  return (
    <div className="flex flex-col gap-6">
      {error && <ErrorBanner message={error} onRetry={load} />}

      {!error && trialItems.length > 0 && (
        <Card
          highlight
          title={`Live-synced trial entries (${trialItems.length})`}
          subtitle="Added automatically for every lead raised in this app, showing the stage it has reached and that stage's status (e.g. Proposal: Negotiation). Clear these before a real deployment."
          headerAction={isAdmin ? (
            <button
              onClick={handleClearTrialEntries}
              disabled={clearing}
              className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-60 dark:border-amber-700 dark:bg-gray-900 dark:text-amber-400 dark:hover:bg-amber-950/40"
            >
              {clearing ? 'Clearing…' : 'Clear all'}
            </button>
          ) : undefined}
        >
          {clearError && <p className="px-5 pt-3 text-xs text-red-500 dark:text-red-400">{clearError}</p>}
          <DataTable columns={columns} rows={trialItems} getKey={r => r.id} minWidth={1700} />
        </Card>
      )}

      <Card title={`Pipeline ${importedItems.length > 0 ? `(${importedItems.length})` : ''}`} subtitle="Imported from the FY2026–27 Pipeline Tracker sheet · read-only">
        {loading ? (
          <p className="px-5 py-10 text-center text-sm text-gray-400 dark:text-gray-500">Loading…</p>
        ) : importedItems.length === 0 && !error ? (
          <p className="px-5 py-10 text-center text-sm text-gray-400 dark:text-gray-500">No pipeline data imported yet.</p>
        ) : (
          <DataTable columns={columns} rows={importedItems} getKey={r => r.id} minWidth={1700} />
        )}
      </Card>
    </div>
  )
}

// ─── Invoices tab ────────────────────────────────────────────────────────────

function InvoicesTab({ isAdmin }: { isAdmin: boolean }) {
  const [summary, setSummary] = useState<InvoiceSectorSummary[]>([])
  const [register, setRegister] = useState<InvoiceRegisterItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const [clearError, setClearError] = useState<string | null>(null)

  function load() {
    setLoading(true)
    api<{ summary: InvoiceSectorSummary[]; register: InvoiceRegisterItem[] }>('/tracker/invoices', { auth: true })
      .then(({ summary, register }) => { setSummary(summary); setRegister(register); setError(null) })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load the invoice tracker.'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const trialEntries = register.filter(r => r.sourceInvoiceId)
  const importedRegister = register.filter(r => !r.sourceInvoiceId)

  async function handleClearTrialEntries() {
    if (!confirm(`Clear all ${trialEntries.length} trial entr${trialEntries.length === 1 ? 'y' : 'ies'}? This only removes live-synced rows — imported data is untouched.`)) return
    setClearing(true)
    setClearError(null)
    try {
      await api('/tracker/invoices/trial-entries', { method: 'DELETE', auth: true })
      load()
    } catch (e) {
      setClearError(e instanceof Error ? e.message : 'Could not clear trial entries.')
    } finally {
      setClearing(false)
    }
  }

  const summaryColumns: Col<InvoiceSectorSummary>[] = [
    { label: 'Sector', render: r => fmtText(r.sector), emphasize: true },
    { label: 'BM / Owner', render: r => fmtText(r.bmOwner) },
    { label: 'Apr', render: r => fmtLakhs(r.apr) },
    { label: 'May', render: r => fmtLakhs(r.may) },
    { label: 'Jun', render: r => fmtLakhs(r.jun) },
    { label: 'Q1 total', render: r => fmtLakhs(r.q1Total), emphasize: true },
    { label: 'Jul', render: r => fmtLakhs(r.jul) },
    { label: 'Aug', render: r => fmtLakhs(r.aug) },
    { label: 'Sep', render: r => fmtLakhs(r.sep) },
    { label: 'Q2 total', render: r => fmtLakhs(r.q2Total), emphasize: true },
    { label: 'Oct', render: r => fmtLakhs(r.oct) },
    { label: 'Nov', render: r => fmtLakhs(r.nov) },
    { label: 'Dec', render: r => fmtLakhs(r.dec) },
    { label: 'Q3 total', render: r => fmtLakhs(r.q3Total), emphasize: true },
    { label: 'Jan', render: r => fmtLakhs(r.jan) },
    { label: 'Feb', render: r => fmtLakhs(r.feb) },
    { label: 'Mar', render: r => fmtLakhs(r.mar) },
    { label: 'Q4 total', render: r => fmtLakhs(r.q4Total), emphasize: true },
    { label: 'FY total', render: r => fmtLakhs(r.fyTotal), emphasize: true },
    { label: 'FY target', render: r => fmtLakhs(r.fyTarget) },
    { label: 'Achievement', render: r => fmtPct(r.achievementPct, true) },
    { label: 'Remarks', render: r => fmtText(r.remarks) },
  ]

  const registerColumns: Col<InvoiceRegisterItem>[] = [
    { label: 'Sector', render: r => fmtText(r.sector) },
    { label: 'Client', render: r => fmtText(r.client), emphasize: true },
    { label: 'Location', render: r => fmtText(r.location) },
    { label: 'PO / WO number', render: r => fmtText(r.poNumber) },
    { label: 'Order value', render: r => fmtLakhs(r.orderValueLakhs) },
    { label: 'Service type', render: r => fmtText(r.serviceType) },
    { label: 'BM owner', render: r => fmtText(r.bmOwner) },
    { label: 'Work completion', render: r => fmtText(r.workCompletionDate) },
    { label: 'Invoice raised?', render: r => fmtText(r.invoiceRaised) },
    { label: 'Invoice number', render: r => fmtText(r.invoiceNumber) },
    { label: 'Invoice date', render: r => fmtDate(r.invoiceDate) },
    { label: 'Invoice amount', render: r => fmtLakhs(r.invoiceAmountLakhs) },
    { label: 'TDS/deduction', render: r => fmtLakhs(r.tdsDeduction) },
    { label: 'Invoice month', render: r => fmtText(r.invoiceMonth) },
    { label: 'Due date', render: r => fmtText(r.dueDate) },
    { label: 'Payment received?', render: r => fmtText(r.paymentReceived) },
    { label: 'Current manager', render: r => fmtText(r.currentManager) },
    { label: 'Payment date', render: r => fmtDate(r.paymentDate) },
    { label: 'Amount collected', render: r => fmtLakhs(r.amountCollectedLakhs) },
    { label: 'Balance outstanding', render: r => fmtLakhs(r.balanceOutstandingLakhs) },
    { label: 'Days to collect', render: r => (r.daysToCollect == null ? dash : r.daysToCollect) },
    { label: 'DSO status', render: r => fmtText(r.dsoStatus) },
    { label: 'Remarks / action', render: r => <span className="block max-w-[180px] truncate" title={r.remarks ?? undefined}>{fmtText(r.remarks)}</span> },
    { label: 'Next action date', render: r => fmtText(r.nextActionDate) },
  ]

  if (loading) return <p className="px-5 py-10 text-center text-sm text-gray-400 dark:text-gray-500">Loading…</p>
  if (error) return <ErrorBanner message={error} onRetry={load} className="" />

  return (
    <div className="flex flex-col gap-6">
      <Card title="Monthly summary by sector" subtitle="₹ Lakhs, against FY2026–27 targets · read-only">
        {summary.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-gray-400 dark:text-gray-500">No summary data imported yet.</p>
        ) : (
          <DataTable columns={summaryColumns} rows={summary} getKey={r => r.id} minWidth={2000} />
        )}
      </Card>

      {trialEntries.length > 0 && (
        <Card
          highlight
          title={`Live-synced trial entries (${trialEntries.length})`}
          subtitle="Added automatically when an invoice raised in this app is paid in full — clear these before a real deployment."
          headerAction={isAdmin ? (
            <button
              onClick={handleClearTrialEntries}
              disabled={clearing}
              className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-60 dark:border-amber-700 dark:bg-gray-900 dark:text-amber-400 dark:hover:bg-amber-950/40"
            >
              {clearing ? 'Clearing…' : 'Clear all'}
            </button>
          ) : undefined}
        >
          {clearError && <p className="px-5 pt-3 text-xs text-red-500 dark:text-red-400">{clearError}</p>}
          <DataTable columns={registerColumns} rows={trialEntries} getKey={r => r.id} minWidth={2400} />
        </Card>
      )}

      <Card title={`Invoice register ${importedRegister.length > 0 ? `(${importedRegister.length})` : ''}`} subtitle="Order-wise invoice and collection detail · read-only">
        {importedRegister.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-gray-400 dark:text-gray-500">No invoice register data imported yet.</p>
        ) : (
          <DataTable columns={registerColumns} rows={importedRegister} getKey={r => r.id} minWidth={2400} />
        )}
      </Card>
    </div>
  )
}

// ─── page ────────────────────────────────────────────────────────────────────

const TAB_LABELS = { pipeline: 'Pipeline', invoices: 'Invoices', report: 'Report' } as const

export default function Tracker({ isAdmin }: { isAdmin: boolean }) {
  const [tab, setTab] = useState<'pipeline' | 'invoices' | 'report'>('pipeline')

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      <div className="mb-5">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Tracker</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Pipeline and invoice data imported from the FY2026–27 tracking sheet.</p>
      </div>

      <div className="mb-5 inline-flex rounded-xl border border-gray-200 bg-white p-1 dark:border-gray-800 dark:bg-gray-900">
        {(Object.keys(TAB_LABELS) as (keyof typeof TAB_LABELS)[]).map(t => (
          <button
            key={t}
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

      {tab === 'pipeline' ? <PipelineTab isAdmin={isAdmin} /> : tab === 'invoices' ? <InvoicesTab isAdmin={isAdmin} /> : <ReportsTab />}
    </div>
  )
}

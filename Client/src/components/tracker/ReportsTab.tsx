import { useEffect, useState } from 'react'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList } from 'recharts'
import { api } from '../../lib/api'
import type { PipelineTrackerItem, InvoiceRegisterItem, InvoiceSectorSummary } from '../../lib/api'
import { useTheme } from '../../lib/theme'
import { ErrorBanner } from '../ErrorBanner'
import WeeklyLineChart from '../WeeklyLineChart'
import PipelineStatusModal from './PipelineStatusModal'
import { SkeletonCards } from '../Skeleton'

type FyMonthKey = 'apr' | 'may' | 'jun' | 'jul' | 'aug' | 'sep' | 'oct' | 'nov' | 'dec' | 'jan' | 'feb' | 'mar'
const FY_MONTHS: { key: FyMonthKey; label: string }[] = [
  { key: 'apr', label: 'Apr' }, { key: 'may', label: 'May' }, { key: 'jun', label: 'Jun' },
  { key: 'jul', label: 'Jul' }, { key: 'aug', label: 'Aug' }, { key: 'sep', label: 'Sep' },
  { key: 'oct', label: 'Oct' }, { key: 'nov', label: 'Nov' }, { key: 'dec', label: 'Dec' },
  { key: 'jan', label: 'Jan' }, { key: 'feb', label: 'Feb' }, { key: 'mar', label: 'Mar' },
]

// Same classification `pipelineStatusStyle` (in tracker.tsx) uses to color a
// badge — duplicated here as plain data rather than a CSS class, so it can
// drive a chart. The sheet's status text is freehand, so this is a
// best-effort bucket, not a fixed enum.
// Rows synced from app leads carry "<stage>: <status>" instead (see
// syncLeadToPipeline on the server): reaching a project or invoice means the
// order was won; a dead lead or lost proposal is lost.
function classifyPipelineStatus(status: string | null): 'Won' | 'Lost' | 'Active' {
  const s = (status ?? '').toLowerCase()
  if (/^(project|invoice):/.test(s) || s === 'proposal: won') return 'Won'
  if (s === 'lead: dead' || s === 'proposal: lost') return 'Lost'
  if (s.includes('✅') || /order received|po received/.test(s)) return 'Won'
  if (/\blost\b/.test(s) || s.startsWith('x ')) return 'Lost'
  return 'Active'
}

const STATUS_COLORS: Record<string, string> = { Won: '#10b981', Lost: '#f43f5e', Active: '#0ea5e9' }

// "Grouped" view of Pipeline by status: folds the sheet's freehand
// near-duplicates ("🔵 Quoted", "Quoted By this week", "Bid Submited"…) and the
// app's "<stage>: <status>" values into a handful of sales stages. Display
// only — the rows keep their exact status. Listed in pipeline order.
const STATUS_GROUPS = ['Enquiry / Discussion', 'Quoted / Offer Sent', 'Negotiation / Follow-up', 'On Hold', 'Won', 'Lost'] as const
type StatusGroup = (typeof STATUS_GROUPS)[number]

function groupPipelineStatus(status: string | null): StatusGroup {
  const outcome = classifyPipelineStatus(status)
  if (outcome !== 'Active') return outcome
  const s = (status ?? '').toLowerCase()
  if (/\bhold\b/.test(s)) return 'On Hold'
  if (/negotiation|follow-up|po is in|under process|awaiting|value case/.test(s)) return 'Negotiation / Follow-up'
  if (/tender floated/.test(s)) return 'Enquiry / Discussion' // tender only just released — nothing quoted yet
  if (/quot|offer|bid|tendering|proposal: (draft|submitted)/.test(s)) return 'Quoted / Offer Sent'
  return 'Enquiry / Discussion'
}

const outcomeColor = (group: string) => STATUS_COLORS[group] ?? STATUS_COLORS.Active
const DSO_COLORS: Record<string, string> = {
  '🟢 Collected': '#10b981',
  '🔴 Overdue': '#f43f5e',
  '🟡 Pending': '#f59e0b',
  '⬛ Not Invoiced': '#9ca3af',
}
const PAYMENT_COLORS: Record<string, string> = { Yes: '#10b981', No: '#f43f5e', 'Not marked': '#9ca3af' }

function countBy<T>(items: T[], keyOf: (item: T) => string): { name: string; value: number }[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    const k = keyOf(item)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return [...counts.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
}

function ChartCard({ title, subtitle, action, children }: { title: string; subtitle: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{title}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

function PieBreakdown({ data, colors, height = 240 }: { data: { name: string; value: number }[]; colors: Record<string, string>; height?: number }) {
  const isDark = useTheme() === 'dark'
  const tickColor = isDark ? '#9ca3af' : '#4b5563'
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
          {data.map(d => <Cell key={d.name} fill={colors[d.name] ?? '#94a3b8'} />)}
        </Pie>
        <Tooltip contentStyle={{ background: isDark ? '#1f2937' : '#fff', border: 'none', borderRadius: 8, fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 12, color: tickColor }} />
      </PieChart>
    </ResponsiveContainer>
  )
}

const BAR_LABEL_WIDTH = 200
const BAR_LABEL_MAX_CHARS = 28
const BAR_ROW_HEIGHT = 40

// Category labels are the sheet's freehand status text — often long, and
// Recharts' default tick wraps it onto two lines, which knocks the leading
// emoji out of line with its bar. One line, ellipsized, full text on hover.
function BarCategoryTick({ x, y, payload, fill }: { x?: number; y?: number; payload?: { value: string }; fill: string }) {
  const full = payload?.value ?? ''
  const text = full.length > BAR_LABEL_MAX_CHARS ? `${full.slice(0, BAR_LABEL_MAX_CHARS - 1).trimEnd()}…` : full
  return (
    <text x={x} y={y} dx={-10} textAnchor="end" dominantBaseline="central" fontSize={12} fill={fill}>
      <title>{full}</title>
      {text}
    </text>
  )
}

function BarBreakdown({ data, color = '#f97316', colorOf, height, onSelect }: {
  data: { name: string; value: number }[]
  color?: string
  colorOf?: (name: string) => string // per-bar color; falls back to `color`
  height?: number
  onSelect?: (name: string) => void
}) {
  const isDark = useTheme() === 'dark'
  const gridColor = isDark ? '#1f2937' : '#f1f5f9'
  const tickColor = isDark ? '#9ca3af' : '#4b5563'
  const chartHeight = height ?? Math.max(240, data.length * BAR_ROW_HEIGHT + 40)
  return (
    <ResponsiveContainer width="100%" height={chartHeight}>
      {/* Clicking anywhere on a row selects it, not just the bar — a count-of-1
          bar is only a few pixels wide. */}
      <BarChart
        data={data} layout="vertical" margin={{ top: 8, right: 40, left: 8, bottom: 8 }} barCategoryGap="30%"
        onClick={onSelect ? (state: { activeLabel?: string | number }) => { if (state?.activeLabel != null) onSelect(String(state.activeLabel)) } : undefined}
        style={onSelect ? { cursor: 'pointer' } : undefined}
      >
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={gridColor} />
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: tickColor }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" width={BAR_LABEL_WIDTH} interval={0} tick={<BarCategoryTick fill={tickColor} />} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }} contentStyle={{ background: isDark ? '#1f2937' : '#fff', border: 'none', borderRadius: 8, fontSize: 12 }} />
        <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} maxBarSize={22}>
          {colorOf && data.map(d => <Cell key={d.name} fill={colorOf(d.name)} />)}
          <LabelList dataKey="value" position="right" fontSize={11} fill={tickColor} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function SectorBarChart({ data }: { data: { sector: string; fyTotal: number; fyTarget: number }[] }) {
  const isDark = useTheme() === 'dark'
  const gridColor = isDark ? '#1f2937' : '#f1f5f9'
  const tickColor = isDark ? '#6b7280' : '#9ca3af'
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 24 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
        <XAxis dataKey="sector" tick={{ fontSize: 10, fill: tickColor }} axisLine={false} tickLine={false} angle={-20} textAnchor="end" interval={0} height={50} />
        <YAxis tick={{ fontSize: 11, fill: tickColor }} axisLine={false} tickLine={false} tickFormatter={v => `₹${v}L`} />
        <Tooltip formatter={v => `₹${Number(v)}L`} contentStyle={{ background: isDark ? '#1f2937' : '#fff', border: 'none', borderRadius: 8, fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="fyTotal" name="Achieved" fill="#10b981" radius={[4, 4, 0, 0]} />
        <Bar dataKey="fyTarget" name="Target" fill="#94a3b8" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// Monthly and status-driven charts covering both the Pipeline and Invoice
// tracker data — fetches both independently of the other two tabs, same
// per-tab-owns-its-data pattern PipelineTab/InvoicesTab already use.
export default function ReportsTab() {
  const [pipeline, setPipeline] = useState<PipelineTrackerItem[]>([])
  const [summary, setSummary] = useState<InvoiceSectorSummary[]>([])
  const [register, setRegister] = useState<InvoiceRegisterItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null)
  const [statusView, setStatusView] = useState<'grouped' | 'exact'>('grouped')

  function load() {
    setLoading(true)
    Promise.all([
      api<{ items: PipelineTrackerItem[] }>('/tracker/pipeline', { auth: true }),
      api<{ summary: InvoiceSectorSummary[]; register: InvoiceRegisterItem[] }>('/tracker/invoices', { auth: true }),
    ])
      .then(([pipelineRes, invoiceRes]) => {
        // Imported sheet rows and rows synced from app leads / paid invoices
        // together — the app's data is what keeps these charts current.
        setPipeline(pipelineRes.items)
        setSummary(invoiceRes.summary)
        setRegister(invoiceRes.register)
        setError(null)
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load report data.'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  if (loading) return <SkeletonCards count={4} />
  if (error) return <ErrorBanner message={error} onRetry={load} />

  const statusCounts = countBy(pipeline, p => classifyPipelineStatus(p.status))
  const rawStatusOf = (p: PipelineTrackerItem) => p.status?.trim() || 'Unspecified'
  const statusKeyOf = statusView === 'grouped' ? (p: PipelineTrackerItem) => groupPipelineStatus(p.status) : rawStatusOf
  const statusBars = statusView === 'grouped'
    ? STATUS_GROUPS.map(name => ({ name, value: pipeline.filter(p => groupPipelineStatus(p.status) === name).length })).filter(g => g.value > 0)
    : countBy(pipeline, rawStatusOf)
  // Same green/red/blue as the Pipeline health pie beside it.
  const statusBarColor = (name: string) => outcomeColor(statusView === 'grouped' ? name : classifyPipelineStatus(name))
  // The sheet's sector summary is a fixed FY2026–27 table; collections from
  // invoices paid in the app are added on top, by payment month and sector.
  const liveCollected = register.filter(r => r.sourceInvoiceId && r.paymentDate && r.amountCollectedLakhs)
  const fyMonthOf = (iso: string): FyMonthKey | null => {
    const d = new Date(iso)
    const inFy = (d.getFullYear() === 2026 && d.getMonth() >= 3) || (d.getFullYear() === 2027 && d.getMonth() <= 2)
    return inFy ? FY_MONTHS[(d.getMonth() + 9) % 12].key : null
  }
  const round2 = (n: number) => Math.round(n * 100) / 100
  const total = summary.find(s => s.sector === 'TOTAL')
  const monthlyTrend = FY_MONTHS.map(({ key, label }) => ({
    month: label,
    collected: round2(Number(total?.[key] ?? 0) + liveCollected.filter(r => fyMonthOf(r.paymentDate!) === key).reduce((sum, r) => sum + r.amountCollectedLakhs!, 0)),
  }))
  const sectorMap = new Map<string, { sector: string; fyTotal: number; fyTarget: number }>()
  for (const s of summary.filter(s => s.sector !== 'TOTAL')) {
    const name = s.sector ?? '—'
    sectorMap.set(name.toLowerCase(), { sector: name, fyTotal: s.fyTotal ?? 0, fyTarget: s.fyTarget ?? 0 })
  }
  for (const r of liveCollected) {
    if (!fyMonthOf(r.paymentDate!)) continue
    const name = r.sector?.trim() || 'Unspecified'
    const entry = sectorMap.get(name.toLowerCase()) ?? { sector: name, fyTotal: 0, fyTarget: 0 }
    entry.fyTotal = round2(entry.fyTotal + r.amountCollectedLakhs!)
    sectorMap.set(name.toLowerCase(), entry)
  }
  const sectorPerformance = [...sectorMap.values()]
  const dsoBreakdown = countBy(register, r => r.dsoStatus?.trim() || 'Unspecified')
  const paymentBreakdown = countBy(register, r => {
    const v = r.paymentReceived?.trim().toUpperCase()
    return v === 'YES' ? 'Yes' : v === 'NO' ? 'No' : 'Not marked'
  })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-gray-400">Pipeline</h3>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title="Pipeline health" subtitle="Every open lead classified as Won, Lost, or still Active">
            <PieBreakdown data={statusCounts} colors={STATUS_COLORS} />
          </ChartCard>
          <ChartCard
            title="Pipeline by status"
            subtitle={statusView === 'grouped'
              ? 'Similar statuses grouped into sales stages · click a row to see its leads'
              : 'Every exact status, from the imported sheet and the app · click a row to see its leads'}
            action={
              <div className="flex shrink-0 rounded-lg border border-gray-200 p-0.5 text-[11px] font-semibold dark:border-gray-700" role="group" aria-label="Status view">
                {(['grouped', 'exact'] as const).map(v => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setStatusView(v)}
                    aria-pressed={statusView === v}
                    className={`rounded-md px-2.5 py-1 transition ${statusView === v
                      ? 'bg-orange-500 text-white'
                      : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
                  >
                    {v === 'grouped' ? 'Grouped' : 'Exact'}
                  </button>
                ))}
              </div>
            }
          >
            <BarBreakdown data={statusBars} colorOf={statusBarColor} onSelect={setSelectedStatus} />
          </ChartCard>
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-gray-400">Invoices</h3>
        <div className="flex flex-col gap-4">
          <WeeklyLineChart
            title="Monthly collections"
            subtitle="Total invoice value collected each month across all sectors, FY2026–27"
            data={monthlyTrend}
            xKey="month"
            periodLabel="Month of"
            series={[{ key: 'collected', name: 'Collected (₹L)', color: '#10b981' }]}
            formatValue={v => `₹${v}L`}
          />
          <ChartCard title="Sector performance" subtitle="Amount collected vs FY target, by sector">
            <SectorBarChart data={sectorPerformance} />
          </ChartCard>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="Collection status (DSO)" subtitle="Every raised invoice, by collection status">
              <PieBreakdown data={dsoBreakdown} colors={DSO_COLORS} />
            </ChartCard>
            <ChartCard title="Payment received" subtitle="Whether payment has been marked received">
              <PieBreakdown data={paymentBreakdown} colors={PAYMENT_COLORS} />
            </ChartCard>
          </div>
        </div>
      </div>

      {selectedStatus && (
        <PipelineStatusModal
          status={selectedStatus}
          rows={pipeline.filter(p => statusKeyOf(p) === selectedStatus)}
          showRowStatus={statusView === 'grouped'}
          onClose={() => setSelectedStatus(null)}
        />
      )}
    </div>
  )
}

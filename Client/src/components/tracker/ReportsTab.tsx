import { useEffect, useState } from 'react'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { api } from '../../lib/api'
import type { PipelineTrackerItem, InvoiceRegisterItem, InvoiceSectorSummary } from '../../lib/api'
import { useTheme } from '../../lib/theme'
import { ErrorBanner } from '../ErrorBanner'
import WeeklyLineChart from '../WeeklyLineChart'

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
function classifyPipelineStatus(status: string | null): 'Won' | 'Lost' | 'Active' {
  const s = (status ?? '').toLowerCase()
  if (s.includes('✅') || /order received|po received/.test(s)) return 'Won'
  if (/\blost\b/.test(s) || s.startsWith('x ')) return 'Lost'
  return 'Active'
}

const STATUS_COLORS: Record<string, string> = { Won: '#10b981', Lost: '#f43f5e', Active: '#0ea5e9' }
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

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{title}</h3>
      <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
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

function BarBreakdown({ data, color = '#f97316', height }: { data: { name: string; value: number }[]; color?: string; height?: number }) {
  const isDark = useTheme() === 'dark'
  const gridColor = isDark ? '#1f2937' : '#f1f5f9'
  const tickColor = isDark ? '#6b7280' : '#9ca3af'
  const chartHeight = height ?? Math.max(220, data.length * 26)
  return (
    <ResponsiveContainer width="100%" height={chartHeight}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={gridColor} />
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: tickColor }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 10, fill: tickColor }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={{ background: isDark ? '#1f2937' : '#fff', border: 'none', borderRadius: 8, fontSize: 12 }} />
        <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} />
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
        <Tooltip formatter={(v: number) => `₹${v}L`} contentStyle={{ background: isDark ? '#1f2937' : '#fff', border: 'none', borderRadius: 8, fontSize: 12 }} />
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

  function load() {
    setLoading(true)
    Promise.all([
      api<{ items: PipelineTrackerItem[] }>('/tracker/pipeline', { auth: true }),
      api<{ summary: InvoiceSectorSummary[]; register: InvoiceRegisterItem[] }>('/tracker/invoices', { auth: true }),
    ])
      .then(([pipelineRes, invoiceRes]) => {
        // Live-synced trial rows are excluded here — they're pre-deployment
        // test data (see the Pipeline/Invoices tabs), not real historical
        // performance.
        setPipeline(pipelineRes.items.filter(i => !i.sourceLeadId))
        setSummary(invoiceRes.summary)
        setRegister(invoiceRes.register.filter(r => !r.sourceInvoiceId))
        setError(null)
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load report data.'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  if (loading) return <p className="px-5 py-10 text-center text-sm text-gray-400 dark:text-gray-500">Loading…</p>
  if (error) return <ErrorBanner message={error} onRetry={load} />

  const statusCounts = countBy(pipeline, p => classifyPipelineStatus(p.status))
  const rawStatusCounts = countBy(pipeline, p => p.status?.trim() || 'Unspecified')
  const total = summary.find(s => s.sector === 'TOTAL')
  const monthlyTrend = total ? FY_MONTHS.map(({ key, label }) => ({ month: label, collected: Number(total[key] ?? 0) })) : []
  const sectorPerformance = summary
    .filter(s => s.sector !== 'TOTAL')
    .map(s => ({ sector: s.sector ?? '—', fyTotal: s.fyTotal ?? 0, fyTarget: s.fyTarget ?? 0 }))
  const dsoBreakdown = countBy(register, r => r.dsoStatus?.trim() || 'Unspecified')
  const paymentBreakdown = countBy(register, r => {
    const v = r.paymentReceived?.trim().toUpperCase()
    return v === 'YES' ? 'Yes' : v === 'NO' ? 'No' : 'Not marked'
  })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Pipeline</h3>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title="Pipeline health" subtitle="Every open lead classified as Won, Lost, or still Active">
            <PieBreakdown data={statusCounts} colors={STATUS_COLORS} />
          </ChartCard>
          <ChartCard title="Pipeline by status" subtitle="Count of items per exact status recorded in the sheet">
            <BarBreakdown data={rawStatusCounts} />
          </ChartCard>
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Invoices</h3>
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
    </div>
  )
}

import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList } from 'recharts'
import type { PipelineTrackerItem, InvoiceRegisterItem, InvoiceSectorSummary, LeadStatus } from '../../lib/api'
import { useTheme } from '../../lib/theme'
import { formatCount, formatLakhs } from '../../lib/format'
import Segmented from './Segmented'
import {
  FY_MONTHS, FY_QUARTERS, OUTCOMES, STATUS_COLORS, DSO_COLORS, PAYMENT_COLORS,
  outcomeOfStatus, groupOfStatus, expectedClosePeriod, fyMonthOf, trackerFyStart, fyLabel,
  dsoLabel, paymentLabel, monthlyCollections, sectorMonthly, round2,
} from '../../lib/trackerReports'
import type { FyMonthKey, StatusGroup } from '../../lib/trackerReports'

type PeriodMode = 'month' | 'quarter'
type Period = { key: string; label: string; short: string; months: FyMonthKey[]; quarter: number }

const MONTH_PERIODS: Period[] = FY_MONTHS.map((m, i) => ({ key: m.key, label: m.label, short: m.label, months: [m.key], quarter: Math.floor(i / 3) + 1 }))
const QUARTER_PERIODS: Period[] = FY_QUARTERS.map((q, i) => ({ ...q, short: `Q${i + 1}`, quarter: i + 1 }))

// Stacked by stage, so each stage needs its own color: the open stages are one
// blue ramp, light → dark as a deal moves along (stepped separately for the
// dark surface), on hold is amber, and won / lost keep the green / red they
// have everywhere else. Stacked bottom → top with Lost first, so red and
// green never touch — the pair red-green colorblind readers can't separate.
const STAGE_STACK: StatusGroup[] = ['Lost', 'Enquiry / Discussion', 'Quoted / Offer Sent', 'Negotiation / Follow-up', 'On Hold', 'Won']
const stageColors = (isDark: boolean): Record<StatusGroup, string> => ({
  Lost: STATUS_COLORS.Lost,
  'Enquiry / Discussion': '#86b6ef',
  'Quoted / Offer Sent': isDark ? '#3987e5' : '#2a78d6',
  'Negotiation / Follow-up': isDark ? '#1c5cab' : '#104281',
  'On Hold': '#f59e0b',
  Won: STATUS_COLORS.Won,
})
// Same reason: keep the green and red segments apart.
const DSO_ORDER = ['🟢 Collected', '🟡 Pending', '🔴 Overdue', '⬛ Not Invoiced']
const PAYMENT_STACK = ['Yes', 'Not marked', 'No']
const NEUTRAL = '#94a3b8'
// The sheet's DSO statuses start with a colored emoji ("🟢 Collected"); next to
// a colored legend dot or swatch that's the same cue twice, so charts drop it.
const plainLabel = (s: string) => s.replace(/^[^\p{L}\p{N}]+/u, '')
const COLLECTED = '#10b981'

function Card({ title, subtitle, note, children }: { title: string; subtitle: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-3">
        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{title}</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
        {note && <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">{note}</p>}
      </div>
      {children}
    </div>
  )
}

function useChartColors() {
  const isDark = useTheme() === 'dark'
  return {
    isDark,
    grid: isDark ? '#1f2937' : '#f1f5f9',
    tick: isDark ? '#9ca3af' : '#4b5563',
    surface: isDark ? '#111827' : '#ffffff', // the card behind the chart — used for the gap between stacked segments
    cursor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
  }
}

type Row = { period: string; label: string; total: number } & Record<string, number | string>

function StackTooltip({ active, payload, categories, colorOf, format }: {
  active?: boolean
  payload?: { payload: Row }[]
  categories: string[]
  colorOf: (c: string) => string
  format: (v: number) => string
}) {
  const { isDark } = useChartColors()
  const row = active ? payload?.[0]?.payload : undefined
  if (!row) return null
  return (
    <div className={`min-w-[180px] rounded-lg px-3 py-2 text-xs shadow-lg ${isDark ? 'bg-gray-800 text-gray-100' : 'bg-white text-gray-800 ring-1 ring-gray-100'}`}>
      <div className="mb-1.5 flex justify-between gap-4 font-semibold">
        <span>{row.label}</span>
        <span>{format(row.total)}</span>
      </div>
      {categories.filter(c => Number(row[c]) > 0).map(c => (
        <div key={c} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: colorOf(c) }} />
            <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>{plainLabel(c)}</span>
          </span>
          <span className="tabular-nums">{format(Number(row[c]))}</span>
        </div>
      ))}
      {row.total === 0 && <div className={isDark ? 'text-gray-400' : 'text-gray-500'}>Nothing in this period</div>}
    </div>
  )
}

type SegmentProps = { x?: number; y?: number; width?: number; height?: number; fill?: string; payload?: Row }

// One segment of a stacked column, with a thin surface-colored line on top to
// separate it from the next segment. The top segment gets rounded corners and
// the column's total above it.
function StackSegment({ x, y, width, height, fill, gap, top, label, labelColor }: {
  x: number; y: number; width: number; height: number; fill?: string; gap: string
  top: boolean; label: string; labelColor: string
}) {
  if (height <= 0 || width <= 0) return null
  const r = top ? Math.min(5, height, width / 2) : 0
  const d = `M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`
  return (
    <g>
      <path d={d} fill={fill} />
      {!top && <line x1={x} x2={x + width} y1={y + 0.75} y2={y + 0.75} stroke={gap} strokeWidth={1.5} />}
      {top && <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill={labelColor}>{label}</text>}
    </g>
  )
}

// One column per period, split into its categories, total on top. Categories
// keep the same order and color in every column so periods compare at a glance;
// a category that's empty in every period is left out of the chart and legend.
function StackedPeriodChart({ periods, categories, valueAt, colorOf, format = formatCount, height = 280 }: {
  periods: Period[]
  categories: string[]
  valueAt: (period: Period, category: string) => number
  colorOf: (category: string) => string
  format?: (v: number) => string
  height?: number
}) {
  const c = useChartColors()
  const shown = categories.filter(cat => periods.some(p => valueAt(p, cat) > 0))
  const data: Row[] = periods.map(p => {
    const row: Row = { period: p.short, label: p.label, total: 0 }
    for (const cat of shown) { const v = valueAt(p, cat); row[cat] = v; row.total = round2(row.total + v) }
    return row
  })
  // The highest non-empty segment in a column — it gets the rounded top and the
  // column total, whichever category it happens to be.
  const topCategory = (row: Row) => [...shown].reverse().find(cat => Number(row[cat]) > 0)
  if (shown.length === 0) return <p className="py-10 text-center text-xs text-gray-400">No data for any period yet.</p>

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 22, right: 8, left: -8, bottom: 0 }} barCategoryGap={periods.length > 4 ? '22%' : '38%'}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={c.grid} />
        <XAxis dataKey="period" tick={{ fontSize: 11, fill: c.tick }} axisLine={false} tickLine={false} interval={0} />
        <YAxis tick={{ fontSize: 11, fill: c.tick }} axisLine={false} tickLine={false} allowDecimals={false} width={44} tickFormatter={v => (format === formatCount ? String(v) : `₹${v}L`)} />
        <Tooltip cursor={{ fill: c.cursor }} content={<StackTooltip categories={shown} colorOf={colorOf} format={format} />} />
        <Legend
          iconType="circle"
          iconSize={8}
          itemSorter={null} // keep the stack order, not alphabetical
          wrapperStyle={{ fontSize: 11, paddingTop: 6 }}
          formatter={value => <span style={{ color: c.tick }}>{plainLabel(String(value))}</span>}
        />
        {shown.map(cat => (
          <Bar
            key={cat}
            dataKey={cat}
            name={cat}
            stackId="period"
            fill={colorOf(cat)}
            maxBarSize={periods.length > 4 ? 40 : 72}
            shape={(props: unknown) => {
              const { x = 0, y = 0, width = 0, height = 0, fill, payload } = props as SegmentProps
              return <StackSegment x={x} y={y} width={width} height={height} fill={fill} gap={c.surface}
                top={!!payload && topCategory(payload) === cat} label={payload ? format(payload.total) : ''} labelColor={c.tick} />
            }}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

// One value per period (collections) — single-series columns.
function PeriodColumns({ data, format }: { data: { period: string; label: string; value: number }[]; format: (v: number) => string }) {
  const c = useChartColors()
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 22, right: 8, left: -8, bottom: 0 }} barCategoryGap={data.length > 4 ? '22%' : '38%'}>
        <defs>
          <linearGradient id="collectedFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLLECTED} stopOpacity={1} />
            <stop offset="100%" stopColor={COLLECTED} stopOpacity={0.55} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={c.grid} />
        <XAxis dataKey="period" tick={{ fontSize: 11, fill: c.tick }} axisLine={false} tickLine={false} interval={0} />
        <YAxis tick={{ fontSize: 11, fill: c.tick }} axisLine={false} tickLine={false} width={52} tickFormatter={v => `₹${v}L`} />
        <Tooltip
          cursor={{ fill: c.cursor }}
          labelFormatter={(_, p) => (p?.[0]?.payload as { label?: string } | undefined)?.label ?? ''}
          formatter={v => [format(Number(v)), 'Collected']}
          contentStyle={{ background: c.isDark ? '#1f2937' : '#fff', border: 'none', borderRadius: 8, fontSize: 12 }}
        />
        <Bar dataKey="value" fill="url(#collectedFill)" radius={[5, 5, 0, 0]} maxBarSize={data.length > 4 ? 40 : 72}>
          <LabelList dataKey="value" position="top" fontSize={11} fontWeight={600} fill={c.tick} formatter={(v: unknown) => (Number(v) > 0 ? format(Number(v)) : '')} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// Sector × period grid, each cell shaded by amount on one shared green scale —
// reads well even with twelve months across, where columns per sector wouldn't.
function SectorHeatmap({ periods, sectors, valueAt }: {
  periods: Period[]
  sectors: string[]
  valueAt: (sector: string, period: Period) => number
}) {
  const cells = sectors.map(s => periods.map(p => valueAt(s, p)))
  const max = Math.max(0, ...cells.flat())
  const colTotals = periods.map((_, pi) => round2(cells.reduce((sum, row) => sum + row[pi], 0)))
  if (sectors.length === 0) return <p className="py-10 text-center text-xs text-gray-400">No data for any period yet.</p>

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-separate border-spacing-1 text-xs" style={{ minWidth: periods.length > 4 ? 860 : 520 }}>
        <thead>
          <tr className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">
            <th className="w-36 px-2 py-1 text-left font-semibold">Sector</th>
            {periods.map(p => <th key={p.key} className="px-2 py-1 text-center font-semibold">{p.short}</th>)}
            <th className="w-28 px-2 py-1 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {sectors.map((s, si) => {
            const rowTotal = round2(cells[si].reduce((a, b) => a + b, 0))
            return (
              <tr key={s}>
                <th scope="row" className="whitespace-nowrap px-2 py-1 text-left font-medium text-gray-700 dark:text-gray-300">{s}</th>
                {periods.map((p, pi) => {
                  const v = cells[si][pi]
                  const t = max > 0 ? v / max : 0
                  return (
                    <td
                      key={p.key}
                      title={`${s} · ${p.label}: ${v > 0 ? formatLakhs(v) : 'nothing collected'}`}
                      className={`h-9 rounded-md px-1.5 text-center tabular-nums ${v > 0 ? (t > 0.45 ? 'font-semibold text-white' : 'font-medium text-gray-800 dark:text-gray-100') : 'bg-gray-50 text-gray-300 dark:bg-gray-800 dark:text-gray-600'}`}
                      style={v > 0 ? { background: `rgba(16, 185, 129, ${0.14 + 0.86 * t})` } : undefined}
                    >
                      {v > 0 ? formatLakhs(v) : '—'}
                    </td>
                  )
                })}
                <td className="whitespace-nowrap px-2 py-1 text-right font-semibold tabular-nums text-gray-900 dark:text-gray-100">{rowTotal > 0 ? formatLakhs(rowTotal) : '—'}</td>
              </tr>
            )
          })}
          <tr>
            <th scope="row" className="border-t border-gray-100 px-2 pt-2 text-left font-semibold text-gray-500 dark:border-gray-800 dark:text-gray-400">All sectors</th>
            {colTotals.map((v, i) => (
              <td key={periods[i].key} className="border-t border-gray-100 px-1.5 pt-2 text-center font-semibold tabular-nums text-gray-700 dark:border-gray-800 dark:text-gray-300">
                {v > 0 ? formatLakhs(v) : '—'}
              </td>
            ))}
            <td className="border-t border-gray-100 px-2 pt-2 text-right font-bold tabular-nums text-gray-900 dark:border-gray-800 dark:text-gray-100">
              {formatLakhs(round2(colTotals.reduce((a, b) => a + b, 0)))}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// Reports' "Comparisons" view: every Overview chart split by month or by
// quarter of the tracker's financial year, periods side by side. Pipeline rows are placed by
// their expected close; invoices by invoice date; collections by the month
// they were collected in.
export default function ComparisonView({ pipeline, summary, register, leadStatuses }: {
  pipeline: PipelineTrackerItem[]
  summary: InvoiceSectorSummary[]
  register: InvoiceRegisterItem[]
  leadStatuses: LeadStatus[]
}) {
  const [mode, setMode] = useState<PeriodMode>('quarter')
  const stageColor = stageColors(useTheme() === 'dark')
  const periods = mode === 'month' ? MONTH_PERIODS : QUARTER_PERIODS
  const unit = mode === 'month' ? 'month' : 'quarter'
  const fyStart = trackerFyStart(register)
  const fy = fyLabel(fyStart)

  // Pipeline, by expected close. A bare "Q2" can't be placed in a month.
  const placed = pipeline.map(p => ({ row: p, at: expectedClosePeriod(p.expectedClose, fyStart) }))
  const inPeriod = (at: ReturnType<typeof expectedClosePeriod>, p: Period) =>
    !!at && (mode === 'quarter' ? at.quarter === p.quarter : !!at.month && p.months.includes(at.month))
  const unplaced = placed.filter(x => !periods.some(p => inPeriod(x.at, p))).length
  const pipelineCount = (p: Period, test: (row: PipelineTrackerItem) => boolean) =>
    placed.filter(x => inPeriod(x.at, p) && test(x.row)).length
  const pipelineNote = unplaced > 0
    ? `${formatCount(unplaced)} of ${formatCount(pipeline.length)} leads have no expected close ${mode === 'month' ? 'month' : 'date'} in ${fy} and aren't counted.`
    : undefined

  // Invoices, by invoice date.
  const invoiceMonth = register.map(r => ({ row: r, month: r.invoiceDate ? fyMonthOf(r.invoiceDate, fyStart) : null }))
  const invoiceCount = (p: Period, test: (row: InvoiceRegisterItem) => boolean) =>
    invoiceMonth.filter(x => x.month && p.months.includes(x.month) && test(x.row)).length
  const undated = invoiceMonth.filter(x => !x.month).length
  const invoiceNote = undated > 0 ? `${formatCount(undated)} invoices have no invoice date in ${fy} and aren't counted.` : undefined
  const dsoCategories = [...new Set(register.map(dsoLabel))].sort((a, b) => {
    const ia = DSO_ORDER.indexOf(a), ib = DSO_ORDER.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
  })

  // Collections, by the month collected.
  const collected = monthlyCollections(summary, register, fyStart)
  const sectors = sectorMonthly(summary, register, fyStart)
  const sumMonths = (months: Record<FyMonthKey, number>, p: Period) => round2(p.months.reduce((s, m) => s + months[m], 0))
  const sectorNames = sectors.filter(s => periods.some(p => sumMonths(s.months, p) > 0)).map(s => s.sector)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Compare by</span>
        <Segmented
          label="Compare by"
          value={mode}
          onChange={setMode}
          options={[{ value: 'quarter', label: 'Quarters' }, { value: 'month', label: 'Months' }]}
        />
        <span className="text-[11px] text-gray-400 dark:text-gray-500">{fy} · hover a column for its breakdown</span>
      </div>

      <div>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-gray-400">Pipeline</h3>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card title={`Pipeline health by ${unit}`} subtitle="Leads by expected close, split into Won, Active and Lost" note={pipelineNote}>
            <StackedPeriodChart
              periods={periods}
              categories={[...OUTCOMES]}
              valueAt={(p, cat) => pipelineCount(p, r => outcomeOfStatus(r.status, leadStatuses) === cat)}
              colorOf={cat => STATUS_COLORS[cat]}
            />
          </Card>
          <Card title={`Pipeline by stage, by ${unit}`} subtitle="Leads by expected close, split into sales stages" note={pipelineNote}>
            <StackedPeriodChart
              periods={periods}
              categories={STAGE_STACK}
              valueAt={(p, cat) => pipelineCount(p, r => groupOfStatus(r.status, leadStatuses) === cat)}
              colorOf={cat => stageColor[cat as StatusGroup]}
            />
          </Card>
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-gray-400">Invoices</h3>
        <div className="flex flex-col gap-4">
          <Card title={`Collections by ${unit}`} subtitle="Total invoice value collected across all sectors">
            <PeriodColumns format={formatLakhs} data={periods.map(p => ({ period: p.short, label: p.label, value: sumMonths(collected, p) }))} />
          </Card>
          <Card title={`Sector performance by ${unit}`} subtitle="Amount collected in each sector · darker green means more">
            <SectorHeatmap
              periods={periods}
              sectors={sectorNames}
              valueAt={(name, p) => sumMonths(sectors.find(s => s.sector === name)!.months, p)}
            />
          </Card>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card title={`Collection status (DSO) by ${unit}`} subtitle="Raised invoices by invoice date, split by collection status" note={invoiceNote}>
              <StackedPeriodChart
                periods={periods}
                categories={dsoCategories}
                valueAt={(p, cat) => invoiceCount(p, r => dsoLabel(r) === cat)}
                colorOf={cat => DSO_COLORS[cat] ?? NEUTRAL}
              />
            </Card>
            <Card title={`Payment received by ${unit}`} subtitle="Raised invoices by invoice date, split by whether payment is marked received" note={invoiceNote}>
              <StackedPeriodChart
                periods={periods}
                categories={PAYMENT_STACK}
                valueAt={(p, cat) => invoiceCount(p, r => paymentLabel(r) === cat)}
                colorOf={cat => PAYMENT_COLORS[cat]}
              />
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

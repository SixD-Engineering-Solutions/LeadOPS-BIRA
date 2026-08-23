import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useTheme } from '../lib/theme'

export type Series = { key: string; name: string; color: string }

type Props = {
  title: string
  subtitle?: string
  data: Record<string, string | number>[]
  xKey: string
  series: Series[]
  height?: number
}

// Custom tooltip: reads each series value by key (dedupes the Area+Line pair).
function ChartTooltip({ active, payload, label, series }: {
  active?: boolean
  payload?: { dataKey?: string | number; value?: number }[]
  label?: string
  series: Series[]
}) {
  if (!active || !payload?.length) return null
  const valueOf = (k: string) => payload.find(p => p.dataKey === k)?.value
  return (
    <div className="rounded-lg border border-gray-100 bg-white px-3 py-2 shadow-md dark:border-gray-700 dark:bg-gray-800">
      <p className="text-[11px] font-medium text-gray-400 dark:text-gray-500">Week of {label}</p>
      {series.map(s => (
        <p key={s.key} className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-gray-100">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
          {valueOf(s.key) ?? 0}
          <span className="font-normal text-gray-500 dark:text-gray-400">{s.name}</span>
        </p>
      ))}
    </div>
  )
}

/**
 * Reusable multi-series weekly trend chart. Smooth (monotone) lines with a soft
 * drop-shadow "lift" and gradient area fills for a little depth. Two hues
 * validated for colorblind separation; a legend labels the series.
 */
export default function WeeklyLineChart({ title, subtitle, data, xKey, series, height = 300 }: Props) {
  const isDark = useTheme() === 'dark'
  const gridColor = isDark ? '#1f2937' : '#f1f5f9'
  const tickColor = isDark ? '#6b7280' : '#9ca3af'
  const cursorColor = isDark ? '#374151' : '#e5e7eb'
  const dotFill = isDark ? '#111827' : '#fff'

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{title}</h3>
          {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>}
        </div>
        {/* legend (identity is never color-alone) */}
        <div className="flex items-center gap-4">
          {series.map(s => (
            <span key={s.key} className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 12, right: 12, left: -18, bottom: 0 }}>
          <defs>
            {series.map(s => (
              <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
            {/* soft lift for the 3D feel */}
            <filter id="line-lift" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#0f172a" floodOpacity="0.22" />
            </filter>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
          <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: tickColor }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: tickColor }} axisLine={false} tickLine={false} width={30} />
          <Tooltip cursor={{ stroke: cursorColor, strokeWidth: 1 }} content={<ChartTooltip series={series} />} />
          {/* gradient fills under each line */}
          {series.map(s => (
            <Area key={`a-${s.key}`} type="monotone" dataKey={s.key} stroke="none" fill={`url(#fill-${s.key})`} isAnimationActive={false} />
          ))}
          {/* the lifted lines on top */}
          {series.map(s => (
            <Line
              key={`l-${s.key}`}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={2.5}
              style={{ filter: 'url(#line-lift)' }}
              dot={{ r: 3, fill: dotFill, stroke: s.color, strokeWidth: 2 }}
              activeDot={{ r: 5, fill: dotFill, stroke: s.color, strokeWidth: 2.5 }}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

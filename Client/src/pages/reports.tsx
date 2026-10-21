import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { LeadStatus } from '../lib/api'
import { PageHeader } from '../components/PageHeader'
import { RefreshButton } from '../components/table/TableToolbar'
import Segmented from '../components/Segmented'
import { SalesReport } from '../components/reports/SalesReport'
import ReportsTab from '../components/tracker/ReportsTab'
import { PAGE_CLASS } from '../lib/pageChrome'

type Tab = 'sales' | 'overview' | 'compare'
const TAB_LABEL: Record<Tab, string> = { sales: 'Sales', overview: 'Pipeline & invoicing', compare: 'Monthly & quarterly' }
const TAB_NOTE: Record<Tab, string> = {
  sales: 'Leads, proposal outcomes and team conversion from the app.',
  overview: 'The Tracker’s pipeline and invoicing for the financial year — every chart opens its rows.',
  compare: 'The Tracker’s figures split month by month and quarter by quarter, side by side on the same scale.',
}
// Sales covers a chosen stretch back from today; the Tracker tabs always
// cover the financial year the Tracker sheet holds.
const PERIODS = [
  { months: 3, weeks: 13, label: '3 months' },
  { months: 6, weeks: 26, label: '6 months' },
  { months: 12, weeks: 52, label: '12 months' },
] as const

const remembered = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  try { const v = sessionStorage.getItem(key) as T | null; return v && allowed.includes(v) ? v : fallback } catch { return fallback }
}

// Every chart in one place: Sales (admins) and the Tracker's reports (everyone,
// as before on Tracker → Report). The tab and period are remembered for this
// browser tab.
export default function Reports({ isAdmin }: { isAdmin: boolean }) {
  const tabs: Tab[] = isAdmin ? ['sales', 'overview', 'compare'] : ['overview', 'compare']
  const [tab, setTab] = useState<Tab>(() => remembered('leadops.reports.tab', tabs, tabs[0]))
  const [period, setPeriod] = useState<string>(() => remembered('leadops.reports.period', PERIODS.map(p => p.label), '6 months'))
  const [token, setToken] = useState(0)
  const [leadStatuses, setLeadStatuses] = useState<LeadStatus[]>([])

  useEffect(() => { try { sessionStorage.setItem('leadops.reports.tab', tab); sessionStorage.setItem('leadops.reports.period', period) } catch { /* not remembered */ } }, [tab, period])
  useEffect(() => {
    api<{ leadStatuses: LeadStatus[] }>('/lead-statuses', { auth: true }).then(r => setLeadStatuses(r.leadStatuses)).catch(() => {})
  }, [])

  const p = PERIODS.find(x => x.label === period) ?? PERIODS[1]

  return (
    <div className={PAGE_CLASS}>
      <PageHeader title="Reports" crumb={TAB_LABEL[tab]} subtitle={TAB_NOTE[tab]}>
        <RefreshButton onClick={() => setToken(t => t + 1)} />
      </PageHeader>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented size="md" label="Report" value={tab} onChange={setTab} options={tabs.map(t => ({ value: t, label: TAB_LABEL[t] }))} />
        {tab === 'sales' ? (
          <Segmented label="Period" value={period} onChange={setPeriod} options={PERIODS.map(x => ({ value: x.label, label: `Last ${x.label}` }))} />
        ) : (
          <span className="text-xs text-gray-500 dark:text-gray-400">Period: the financial year in the Tracker</span>
        )}
      </div>

      {tab === 'sales'
        ? <SalesReport key={token} months={p.months} weeks={p.weeks} />
        : <ReportsTab key={`${tab}-${token}`} leadStatuses={leadStatuses} view={tab} />}
    </div>
  )
}

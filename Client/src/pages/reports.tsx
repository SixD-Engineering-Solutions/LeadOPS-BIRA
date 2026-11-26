import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { LeadStatus } from '../lib/api'
import { PageHeader } from '../components/PageHeader'
import { RefreshButton } from '../components/table/TableToolbar'
import Segmented from '../components/Segmented'
import { SalesReport } from '../components/reports/SalesReport'
import { TeamComparison } from '../components/reports/TeamComparison'
import ReportsTab from '../components/tracker/ReportsTab'
import { PAGE_CLASS } from '../lib/pageChrome'

type Tab = 'sales' | 'team' | 'overview' | 'compare'
const TAB_LABEL: Record<Tab, string> = { sales: 'Sales', team: 'Team comparison', overview: 'Pipeline & invoicing', compare: 'Monthly & quarterly' }
const TAB_NOTE: Record<Tab, string> = {
  sales: 'Leads and proposal outcomes from the app.',
  team: 'Compare team members side by side on leads and conversion — only people with at least one lead are included.',
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
// The team comparison can also look at everything since the start.
const TEAM_PERIODS = [...PERIODS, { months: 0, weeks: 0, label: 'All time' }] as const

const remembered = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  try { const v = sessionStorage.getItem(key) as T | null; return v && allowed.includes(v) ? v : fallback } catch { return fallback }
}

// Every chart in one place: Sales (admins) and the Tracker's reports (everyone,
// as before on Tracker → Report). The tab and period are remembered for this
// browser tab.
export default function Reports({ isAdmin }: { isAdmin: boolean }) {
  const tabs: Tab[] = isAdmin ? ['sales', 'team', 'overview', 'compare'] : ['overview', 'compare']
  const [tab, setTab] = useState<Tab>(() => remembered('leadops.reports.tab', tabs, tabs[0]))
  const [period, setPeriod] = useState<string>(() => remembered('leadops.reports.period', PERIODS.map(p => p.label), '6 months'))
  const [teamPeriod, setTeamPeriod] = useState<string>(() => remembered('leadops.reports.teamPeriod', TEAM_PERIODS.map(p => p.label), '6 months'))
  const [token, setToken] = useState(0)
  const [leadStatuses, setLeadStatuses] = useState<LeadStatus[]>([])

  useEffect(() => { try { sessionStorage.setItem('leadops.reports.tab', tab); sessionStorage.setItem('leadops.reports.period', period); sessionStorage.setItem('leadops.reports.teamPeriod', teamPeriod) } catch { /* not remembered */ } }, [tab, period, teamPeriod])
  useEffect(() => {
    api<{ leadStatuses: LeadStatus[] }>('/lead-statuses', { auth: true }).then(r => setLeadStatuses(r.leadStatuses)).catch(() => {})
  }, [])

  const p = PERIODS.find(x => x.label === period) ?? PERIODS[1]
  const tp = TEAM_PERIODS.find(x => x.label === teamPeriod) ?? TEAM_PERIODS[1]

  return (
    <div className={PAGE_CLASS}>
      <PageHeader title="Reports" crumb={TAB_LABEL[tab]} subtitle={TAB_NOTE[tab]}>
        <RefreshButton onClick={() => setToken(t => t + 1)} />
      </PageHeader>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented size="md" label="Report" value={tab} onChange={setTab} options={tabs.map(t => ({ value: t, label: TAB_LABEL[t] }))} />
        {tab === 'sales' ? (
          <Segmented label="Period" value={period} onChange={setPeriod} options={PERIODS.map(x => ({ value: x.label, label: `Last ${x.label}` }))} />
        ) : tab === 'team' ? (
          <Segmented label="Period" value={teamPeriod} onChange={setTeamPeriod} options={TEAM_PERIODS.map(x => ({ value: x.label, label: x.months ? `Last ${x.label}` : x.label }))} />
        ) : (
          <span className="text-xs text-gray-500 dark:text-gray-400">Period: the financial year in the Tracker</span>
        )}
      </div>

      {tab === 'sales'
        ? <SalesReport key={token} months={p.months} weeks={p.weeks} />
        : tab === 'team'
        ? <TeamComparison key={`${token}-${tp.months}`} months={tp.months} />
        : <ReportsTab key={`${tab}-${token}`} leadStatuses={leadStatuses} view={tab} />}
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import type { AuthUser, Lead } from '../lib/api'
import Leads from './leads'
import Reports from './reports'
import Team from './team'
import Tasks from './tasks'
import Proposals from './proposals'
import Projects from './projects'
import Invoices from './invoices'
import Tracker from './tracker'
import NotificationBell from '../components/NotificationBell'
import ThemeToggle from '../components/ThemeToggle'
import LeadDetailModal from '../components/LeadDetailModal'
import { Icon, icons } from '../components/dashboard/icons'
import { DashboardSidebar, displayName, type NavItem } from '../components/dashboard/DashboardSidebar'
import { StatTiles } from '../components/dashboard/StatTiles'
import { FollowUpsPanel } from '../components/dashboard/FollowUpsPanel'
import { PendingPaymentsPanel } from '../components/dashboard/PendingPaymentsPanel'
import { TasksPanel } from '../components/dashboard/TasksPanel'
import { LeadAssignmentsModal } from '../components/dashboard/LeadAssignmentsModal'
import { useLeadStats } from '../hooks/useLeadStats'
import { useProposalStats } from '../hooks/useProposalStats'
import { usePendingInvoices } from '../hooks/usePendingInvoices'
import { useMyTasks } from '../hooks/useMyTasks'
import { useFollowUps } from '../hooks/useFollowUps'
import { api } from '../lib/api'

// ─── module cards shown in the main area ────────────────────────────────────────

// `action` = the clear call-to-action label. `glow` = the hover border/shadow tint.
type Module = { key: string; title: string; desc: string; icon: string; action: string; accent: string; glow: string }

const CORE_MODULES: Module[] = [
  { key: 'lead-gen', title: 'Leads', desc: 'Capture new leads and track the ones assigned to you.', icon: icons.leadGen, action: 'Open', accent: 'from-rose-400 to-orange-400', glow: 'rgba(251,146,60,0.45)' },
  { key: 'proposals', title: 'Proposals', desc: 'Quote value and probability, track to Won or Lost.', icon: icons.proposals, action: 'Open', accent: 'from-violet-400 to-fuchsia-400', glow: 'rgba(167,139,250,0.45)' },
  { key: 'projects', title: 'Projects', desc: 'Work orders and execution tracking after order.', icon: icons.projects, action: 'Open', accent: 'from-teal-400 to-emerald-400', glow: 'rgba(45,212,191,0.45)' },
  { key: 'invoices', title: 'Invoices', desc: 'Bill a project and track payments received.', icon: icons.invoices, action: 'Open', accent: 'from-indigo-400 to-blue-400', glow: 'rgba(129,140,248,0.45)' },
  { key: 'tasks', title: 'Tasks', desc: 'Your follow-ups and to-dos in one place.', icon: icons.tasks, action: 'Open', accent: 'from-amber-400 to-orange-400', glow: 'rgba(251,191,36,0.45)' },
  { key: 'tracker', title: 'Tracker', desc: 'Imported pipeline and invoice data, at a glance.', icon: icons.tracker, action: 'Open', accent: 'from-lime-400 to-emerald-400', glow: 'rgba(163,230,53,0.45)' },
]

const ADMIN_MODULES: Module[] = [
  { key: 'reports', title: 'Reports', desc: 'Pipeline, conversion and activity analytics.', icon: icons.reports, action: 'View', accent: 'from-emerald-400 to-teal-400', glow: 'rgba(52,211,153,0.45)' },
  { key: 'team', title: 'Team Management', desc: 'Manage members, roles and permissions.', icon: icons.team, action: 'Manage', accent: 'from-rose-400 to-pink-400', glow: 'rgba(251,113,133,0.45)' },
]

// ─── component ──────────────────────────────────────────────────────────────────

export default function Dashboard({ user, onSignOut }: { user: AuthUser; onSignOut: () => void }) {
  const role = user.role ?? 'employee'
  const name = displayName(user.email)
  const isAdmin = role === 'admin'

  const modules = isAdmin ? [...CORE_MODULES, ...ADMIN_MODULES] : CORE_MODULES

  const navItems: NavItem[] = [
    { key: 'dashboard', label: 'Dashboard', icon: icons.dashboard },
    { key: 'lead-gen', label: 'Leads', icon: icons.leadGen },
    { key: 'proposals', label: 'Proposals', icon: icons.proposals },
    { key: 'projects', label: 'Projects', icon: icons.projects },
    { key: 'invoices', label: 'Invoices', icon: icons.invoices },
    { key: 'tasks', label: 'Tasks', icon: icons.tasks },
    { key: 'tracker', label: 'Tracker', icon: icons.tracker },
    ...(isAdmin ? [{ key: 'reports', label: 'Reports', icon: icons.reports }, { key: 'team', label: 'Team', icon: icons.team }] : []),
  ]

  // Remember the current tab across page refreshes — sessionStorage, scoped to
  // this tab, so a new tab's fresh session doesn't jump to wherever another
  // already-open tab happens to be.
  const [active, setActive] = useState(() => sessionStorage.getItem('leadops_tab') ?? 'dashboard')
  useEffect(() => { sessionStorage.setItem('leadops_tab', active) }, [active])
  const onDashboard = active === 'dashboard'

  // Sidebar starts collapsed to icons; hovering over it reveals the full menu.
  // On narrow screens there's no hover, so the sidebar is off-canvas instead —
  // toggled open by the header's menu button — and always shows full labels
  // while open, since there's no icon-only state worth having there.
  const [hovered, setHovered] = useState(false)
  const collapsed = !hovered
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const expanded = !collapsed || mobileNavOpen
  const [demoNote, setDemoNote] = useState<string | null>(null)

  const [showAssignments, setShowAssignments] = useState(false)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)

  const { stats, allLeads, employees, error: leadStatsError, reload: reloadLeadStats } = useLeadStats(onDashboard, isAdmin)
  const { proposalStats, error: proposalStatsError, reload: reloadProposalStats } = useProposalStats(onDashboard)
  const { pendingInvoices, error: pendingInvoicesError, reload: reloadPendingInvoices } = usePendingInvoices(onDashboard)
  const { myTasks, loaded: myTasksLoaded, error: myTasksError, reload: reloadMyTasks } = useMyTasks(onDashboard, isAdmin)
  const { followUps, error: followUpsError, reload: reloadFollowUps } = useFollowUps(onDashboard)

  // Opens the full lead detail modal from a follow-up entry (which only carries
  // a slim lead summary) by fetching the complete Lead record.
  function openLeadById(leadId: string) {
    api<{ lead: Lead }>(`/leads/${leadId}`, { auth: true }).then(({ lead }) => setSelectedLead(lead)).catch(() => {})
  }

  // Assigned leads grouped by whoever they're currently assigned to, for the
  // "Total Leads" tile's breakdown modal. Only groups with leads are kept —
  // employees with nothing assigned aren't relevant to "who has what".
  const assignmentGroups = useMemo(() => {
    const byUser = new Map<string, Lead[]>()
    for (const lead of allLeads) {
      if (!lead.assignedToUserId) continue
      const bucket = byUser.get(lead.assignedToUserId)
      if (bucket) bucket.push(lead)
      else byUser.set(lead.assignedToUserId, [lead])
    }
    return employees
      .map(u => ({ user: u, leads: byUser.get(u.id) ?? [] }))
      .filter(g => g.leads.length > 0)
      .sort((a, b) => b.leads.length - a.leads.length)
  }, [allLeads, employees])
  const unassignedLeads = useMemo(() => allLeads.filter(l => !l.assignedToUserId), [allLeads])

  // These keys render real views; everything else is a demo placeholder.
  const REAL_VIEWS = new Set(['dashboard', 'lead-gen', 'leads', 'reports', 'team', 'tasks', 'proposals', 'projects', 'invoices', 'tracker'])

  function openModule(m: { key: string; label?: string; title?: string }) {
    setActive(m.key)
    setDemoNote(REAL_VIEWS.has(m.key) ? null : `“${m.label ?? m.title}” is a demo module — coming soon.`)
    setMobileNavOpen(false) // picking a section closes the off-canvas nav on mobile
  }

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">

      <DashboardSidebar
        name={name}
        role={role}
        isAdmin={isAdmin}
        navItems={navItems}
        active={active}
        expanded={expanded}
        mobileNavOpen={mobileNavOpen}
        onHoverChange={setHovered}
        onCloseMobileNav={() => setMobileNavOpen(false)}
        onSelect={openModule}
        onSignOut={onSignOut}
      />

      {/* ── Main ────────────────────────────────────────────────────────────── */}
      <main className="flex-1 scroll-pt-20 overflow-y-auto">
        {/* top bar */}
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-3 border-b border-gray-200 bg-white/95 px-4 backdrop-blur dark:border-gray-800 dark:bg-gray-900/95 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            {/* menu button — opens the off-canvas nav on mobile, where the sidebar is hidden */}
            <button onClick={() => setMobileNavOpen(true)} className="shrink-0 rounded-xl border border-gray-200 bg-white p-2 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 md:hidden" aria-label="Open menu">
              <Icon d={icons.menu} className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold">Welcome back, {name.split(' ')[0]}</h1>
              <p className="truncate text-xs text-gray-500 dark:text-gray-400">Here's what's happening in your workspace today.</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <ThemeToggle />
            <NotificationBell />
          </div>
        </header>

        {active === 'lead-gen' || active === 'leads' ? (
          <Leads isAdmin={isAdmin} />
        ) : active === 'reports' && isAdmin ? (
          <Reports />
        ) : active === 'team' ? (
          <Team currentUserId={user.id} />
        ) : active === 'tasks' ? (
          <Tasks isAdmin={isAdmin} />
        ) : active === 'proposals' ? (
          <Proposals />
        ) : active === 'projects' ? (
          <Projects />
        ) : active === 'invoices' ? (
          <Invoices isAdmin={isAdmin} />
        ) : active === 'tracker' ? (
          <Tracker />
        ) : (
        <div className="mx-auto max-w-6xl px-6 py-6">
          {demoNote && (
            <div className="mb-5 flex items-center justify-between rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5 text-sm text-orange-700 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300">
              <span>{demoNote}</span>
              <button onClick={() => setDemoNote(null)} className="text-orange-400 hover:text-orange-600 dark:text-orange-500 dark:hover:text-orange-300">✕</button>
            </div>
          )}

          <StatTiles
            stats={stats}
            proposalStats={proposalStats}
            leadStatsError={leadStatsError}
            proposalStatsError={proposalStatsError}
            onRetryLeadStats={reloadLeadStats}
            onRetryProposalStats={reloadProposalStats}
            onOpenAssignments={() => setShowAssignments(true)}
            onOpenProposals={() => openModule({ key: 'proposals', label: 'Proposals' })}
            onOpenPipeline={() => openModule({ key: 'tracker', label: 'Tracker' })}
          />

          <FollowUpsPanel
            followUps={followUps}
            error={followUpsError}
            onRetry={reloadFollowUps}
            onOpenLead={openLeadById}
          />

          <PendingPaymentsPanel
            pendingInvoices={pendingInvoices}
            error={pendingInvoicesError}
            onRetry={reloadPendingInvoices}
            onOpenInvoices={() => openModule({ key: 'invoices', label: 'Invoices' })}
          />

          <TasksPanel
            isAdmin={isAdmin}
            myTasks={myTasks}
            loaded={myTasksLoaded}
            error={myTasksError}
            onRetry={reloadMyTasks}
            onViewAll={() => openModule({ key: 'tasks', label: 'Tasks' })}
          />

          {/* modules */}
          <div className="mt-8 mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">Modules</h2>
            <span className="text-xs text-gray-400 dark:text-gray-400">Demo — select any card</span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map(m => (
              <button
                key={m.key}
                onClick={() => openModule(m)}
                style={{ '--glow': m.glow } as React.CSSProperties}
                className="group flex flex-col items-start rounded-2xl border border-gray-100 bg-white p-5 text-left shadow-sm transition-all duration-200
                  hover:-translate-y-1 hover:border-[color:var(--glow)] hover:shadow-[0_16px_36px_-12px_var(--glow)] dark:border-gray-800 dark:bg-gray-900"
              >
                <div className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${m.accent} text-white`}>
                  <Icon d={m.icon} className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-sm font-bold text-gray-900 dark:text-gray-100">{m.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{m.desc}</p>
                {/* clear action label */}
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-orange-500">
                  {m.action}
                  <svg className="h-3.5 w-3.5 transition group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </span>
              </button>
            ))}
          </div>
        </div>
        )}
      </main>

      {/* ── Lead assignment breakdown modal (admin), or "my leads" list (employee) ── */}
      {showAssignments && (
        <LeadAssignmentsModal
          isAdmin={isAdmin}
          allLeads={allLeads}
          assignmentGroups={assignmentGroups}
          unassignedLeads={unassignedLeads}
          onClose={() => setShowAssignments(false)}
          onSelectLead={lead => { setSelectedLead(lead) }}
        />
      )}

      {selectedLead && <LeadDetailModal lead={selectedLead} onClose={() => setSelectedLead(null)} />}
    </div>
  )
}

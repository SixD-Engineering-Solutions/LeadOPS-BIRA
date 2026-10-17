import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon, icons } from './icons'
import { Popover, MenuItem, MenuDivider } from '../table/Popover'
import type { NavBadge } from '../../hooks/useNavBadges'

export type NavItem = { key: string; label: string; icon: string }
export type NavGroup = { label?: string; items: NavItem[] }

/** Turn an email into a display name: "jane.doe@x.com" -> "Jane Doe". */
export function displayName(email: string): string {
  const raw = email.split('@')[0].replace(/[._-]+/g, ' ').trim()
  return raw.replace(/\b\w/g, c => c.toUpperCase()) || 'User'
}

export function initials(name: string): string {
  const parts = name.split(' ').filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'U'
}

const BADGE_TONE = {
  rose: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
} as const
const DOT_TONE = { rose: 'bg-rose-500', amber: 'bg-amber-500' } as const

// The app's left navigation: logo, the modules in groups (with a count on
// anything that needs attention), and the signed-in person's menu at the
// bottom. Always open on a desktop — the person can fold it to icons
// themselves (remembered), and then each icon names itself on hover. On
// narrow screens it's off-canvas instead, opened by the top bar's menu button.
export function DashboardSidebar({
  name, email, role, groups, badges, active, collapsed, onToggleCollapsed, mobileNavOpen, onCloseMobileNav, onSelect, onSignOut,
}: {
  name: string
  email: string
  role: string
  groups: NavGroup[]
  badges: Partial<Record<string, NavBadge>>
  active: string
  collapsed: boolean
  onToggleCollapsed: () => void
  mobileNavOpen: boolean
  onCloseMobileNav: () => void
  onSelect: (item: NavItem) => void
  onSignOut: () => void
}) {
  // The off-canvas menu on a phone always shows labels.
  const narrow = collapsed && !mobileNavOpen
  const isAdmin = role === 'admin'
  const [profileAnchor, setProfileAnchor] = useState<HTMLElement | null>(null)

  return (
    <>
      {/* Backdrop — mobile only, closes the off-canvas nav on tap. */}
      {mobileNavOpen && (
        <div onClick={onCloseMobileNav} className="fixed inset-0 z-[45] bg-black/40 md:hidden" aria-hidden="true" />
      )}
      <aside
        aria-label="Main navigation"
        className={`fixed inset-y-0 left-0 z-50 flex shrink-0 flex-col border-r border-gray-200 bg-white transition-transform duration-200 dark:border-gray-800 dark:bg-gray-900
          md:static md:z-auto md:transition-[width]
          ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0
          ${narrow ? 'w-[72px]' : 'w-60'}`}
      >
        {/* logo + fold */}
        <div className={`flex h-16 shrink-0 items-center gap-2 border-b border-gray-100 dark:border-gray-800 ${narrow ? 'justify-center px-2' : 'px-5'}`}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-rose-400 to-orange-400 font-bold text-white">L</div>
          {!narrow && <span className="text-lg font-bold tracking-tight">LeadOps</span>}
          <button onClick={onCloseMobileNav} className="ml-auto rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 md:hidden dark:hover:bg-gray-800 dark:hover:text-gray-300" aria-label="Close menu">
            <Icon d={icons.close} className="h-5 w-5" />
          </button>
        </div>

        {/* nav */}
        <nav className={`flex-1 overflow-y-auto py-3 ${narrow ? 'px-2' : 'px-3'}`}>
          {groups.map((g, gi) => (
            <div key={g.label ?? gi} className={gi > 0 ? 'mt-4' : ''}>
              {g.label && (narrow
                ? <div className="mx-auto mb-2 h-px w-6 bg-gray-200 dark:bg-gray-800" aria-hidden="true" />
                : <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{g.label}</p>)}
              <ul className="flex flex-col gap-0.5">
                {g.items.map(item => (
                  <li key={item.key}>
                    <NavButton item={item} active={active === item.key} narrow={narrow} badge={badges[item.key]} onSelect={() => onSelect(item)} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* fold toggle — desktop only */}
        <div className={`hidden shrink-0 md:block ${narrow ? 'px-2' : 'px-3'} pb-1`}>
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={narrow ? 'Expand sidebar' : 'Collapse sidebar'}
            title={narrow ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`flex w-full items-center rounded-xl py-2 text-xs font-medium text-gray-400 outline-none transition hover:bg-gray-50 hover:text-gray-700 focus-visible:ring-2 focus-visible:ring-orange-300 dark:hover:bg-gray-800 dark:hover:text-gray-200 ${narrow ? 'justify-center' : 'gap-3 px-3'}`}
          >
            <Icon d={icons.chevronLeft} className={`h-4 w-4 shrink-0 transition-transform ${narrow ? 'rotate-180' : ''}`} />
            {!narrow && 'Collapse'}
          </button>
        </div>

        {/* signed-in person: profile + sign out */}
        <div className="shrink-0 border-t border-gray-100 p-2 dark:border-gray-800">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={!!profileAnchor}
            aria-label={`Account: ${name}`}
            onClick={e => setProfileAnchor(profileAnchor ? null : e.currentTarget)}
            className={`flex w-full items-center rounded-xl p-2 text-left outline-none transition hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-orange-300 dark:hover:bg-gray-800 ${narrow ? 'justify-center' : 'gap-3'} ${profileAnchor ? 'bg-gray-50 dark:bg-gray-800' : ''}`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-rose-400 to-orange-400 text-sm font-semibold text-white">{initials(name)}</span>
            {!narrow && (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{name}</span>
                <span className="block truncate text-[11px] capitalize text-gray-500 dark:text-gray-400">{role}</span>
              </span>
            )}
            {!narrow && <Icon d="M8 9l4-4 4 4m0 6l-4 4-4-4" className="h-4 w-4 shrink-0 text-gray-400" />}
          </button>
          {profileAnchor && (
            <Popover anchor={profileAnchor} onClose={() => setProfileAnchor(null)} label="Account" minWidth={230}>
              <div className="px-2.5 pb-2 pt-1.5">
                <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{name}</p>
                <p className="truncate text-xs text-gray-500 dark:text-gray-400">{email}</p>
                <span className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${isAdmin ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-300' : 'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${isAdmin ? 'bg-orange-500' : 'bg-sky-500'}`} />
                  {role}
                </span>
              </div>
              <MenuDivider />
              <MenuItem danger onSelect={() => { setProfileAnchor(null); onSignOut() }}>
                <Icon d={icons.signout} className="h-4 w-4" />
                Sign out
              </MenuItem>
            </Popover>
          )}
        </div>
      </aside>
    </>
  )
}

function NavButton({ item, active, narrow, badge, onSelect }: { item: NavItem; active: boolean; narrow: boolean; badge?: NavBadge; onSelect: () => void }) {
  // Folded to icons: the label (and any count) appears beside the icon on
  // hover or keyboard focus — drawn outside the scrolling nav so it isn't clipped.
  const [tip, setTip] = useState<DOMRect | null>(null)
  const show = (e: React.SyntheticEvent<HTMLElement>) => { if (narrow) setTip(e.currentTarget.getBoundingClientRect()) }
  const hide = () => setTip(null)

  return (
    <>
      <button
        onClick={onSelect}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        aria-current={active ? 'page' : undefined}
        aria-label={narrow ? `${item.label}${badge ? ` — ${badge.title}` : ''}` : undefined}
        className={`relative flex w-full items-center rounded-xl py-2 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-orange-300
          ${narrow ? 'justify-center px-2' : 'gap-3 px-3'}
          ${active
            ? 'bg-gradient-to-r from-rose-50 to-orange-50 text-orange-600 dark:from-rose-950/40 dark:to-orange-950/40 dark:text-orange-400'
            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'}`}
      >
        <Icon d={item.icon} className={`h-5 w-5 shrink-0 ${active ? 'text-orange-500 dark:text-orange-400' : 'text-gray-400 dark:text-gray-400'}`} />
        {!narrow && <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>}
        {badge && !narrow && (
          <span title={badge.title} className={`shrink-0 rounded-full px-1.5 py-px text-[11px] font-semibold tabular-nums ${BADGE_TONE[badge.tone]}`}>{badge.count}</span>
        )}
        {badge && narrow && <span className={`absolute right-2 top-1.5 h-2 w-2 rounded-full ring-2 ring-white dark:ring-gray-900 ${DOT_TONE[badge.tone]}`} aria-hidden="true" />}
      </button>
      {tip && narrow && createPortal(
        <div
          role="tooltip"
          style={{ top: tip.top + tip.height / 2, left: tip.right + 10 }}
          className="popover-in pointer-events-none fixed z-[70] -translate-y-1/2 whitespace-nowrap rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg dark:bg-gray-700"
        >
          {item.label}
          {badge && <span className="ml-1.5 text-gray-300">· {badge.title}</span>}
        </div>,
        document.body,
      )}
    </>
  )
}

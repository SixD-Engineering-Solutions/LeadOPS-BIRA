import { Icon, icons } from './icons'

export type NavItem = { key: string; label: string; icon: string }

/** Turn an email into a display name: "jane.doe@x.com" -> "Jane Doe". */
export function displayName(email: string): string {
  const raw = email.split('@')[0].replace(/[._-]+/g, ' ').trim()
  return raw.replace(/\b\w/g, c => c.toUpperCase()) || 'User'
}

export function initials(name: string): string {
  const parts = name.split(' ').filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'U'
}

// The app's left navigation — logo, signed-in user, module list, sign out.
// Starts collapsed to icons; hovering over it (desktop) reveals full labels.
// On narrow screens there's no hover, so it's off-canvas instead, toggled by
// the header's menu button, and always shows full labels while open.
export function DashboardSidebar({
  name, role, isAdmin, navItems, active, expanded, mobileNavOpen,
  onHoverChange, onCloseMobileNav, onSelect, onSignOut,
}: {
  name: string
  role: string
  isAdmin: boolean
  navItems: NavItem[]
  active: string
  expanded: boolean
  mobileNavOpen: boolean
  onHoverChange: (hovered: boolean) => void
  onCloseMobileNav: () => void
  onSelect: (item: NavItem) => void
  onSignOut: () => void
}) {
  return (
    <>
      {/* Backdrop — mobile only, closes the off-canvas nav on tap. */}
      {mobileNavOpen && (
        <div onClick={onCloseMobileNav} className="fixed inset-0 z-20 bg-black/40 md:hidden" aria-hidden="true" />
      )}
      <aside
        onMouseEnter={() => onHoverChange(true)}
        onMouseLeave={() => onHoverChange(false)}
        className={`fixed inset-y-0 left-0 z-30 flex shrink-0 flex-col border-r border-gray-200 bg-white transition-transform duration-200 dark:border-gray-800 dark:bg-gray-900
          md:static md:transition-[width]
          ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0
          ${expanded ? 'w-64' : 'w-20'}`}
      >
        {/* logo */}
        <div className={`flex h-16 items-center gap-2 border-b border-gray-100 dark:border-gray-800 ${expanded ? 'px-6' : 'justify-center px-2'}`}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-rose-400 to-orange-400 text-white font-bold">L</div>
          {expanded && <span className="text-lg font-bold tracking-tight">LeadOps</span>}
          {/* close button — mobile only */}
          <button onClick={onCloseMobileNav} className="ml-auto rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300 md:hidden" aria-label="Close menu">
            <Icon d={icons.close} className="h-5 w-5" />
          </button>
        </div>

        {/* user profile */}
        <div className={`border-b border-gray-100 py-4 dark:border-gray-800 ${expanded ? 'px-4' : 'px-2'}`}>
          <div className={`flex items-center rounded-xl bg-gray-50 p-3 dark:bg-gray-800 ${expanded ? 'gap-3' : 'justify-center'}`}>
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-rose-400 to-orange-400 text-white font-semibold">
              {initials(name)}
            </div>
            {expanded && (
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{name}</p>
                <span
                  className={`mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize
                    ${isAdmin ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-300' : 'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300'}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${isAdmin ? 'bg-orange-500' : 'bg-sky-500'}`} />
                  {role}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* nav */}
        <nav className={`flex-1 overflow-y-auto py-4 ${expanded ? 'px-3' : 'px-2'}`}>
          {expanded && <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Menu</p>}
          <ul className="flex flex-col gap-1">
            {navItems.map(item => (
              <li key={item.key}>
                <button
                  onClick={() => onSelect(item)}
                  title={!expanded ? item.label : undefined}
                  className={`flex w-full items-center rounded-xl py-2.5 text-sm font-medium transition
                    ${expanded ? 'gap-3 px-3' : 'justify-center px-2'}
                    ${active === item.key
                      ? 'bg-gradient-to-r from-rose-50 to-orange-50 text-orange-600 dark:from-rose-950/40 dark:to-orange-950/40 dark:text-orange-400'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'}`}
                >
                  <Icon d={item.icon} className={`h-5 w-5 shrink-0 ${active === item.key ? 'text-orange-500 dark:text-orange-400' : 'text-gray-400 dark:text-gray-500'}`} />
                  {expanded && item.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* sign out */}
        <div className="border-t border-gray-100 p-3 dark:border-gray-800">
          <button
            onClick={onSignOut}
            title={!expanded ? 'Sign out' : undefined}
            className={`flex w-full items-center rounded-xl py-2.5 text-sm font-medium text-gray-600 transition hover:bg-red-50 hover:text-red-600 dark:text-gray-400 dark:hover:bg-red-950/40 dark:hover:text-red-400
              ${expanded ? 'gap-3 px-3' : 'justify-center px-2'}`}
          >
            <Icon d={icons.signout} className="h-5 w-5 shrink-0" />
            {expanded && 'Sign out'}
          </button>
        </div>
      </aside>
    </>
  )
}

// The one place the role names live. Everything else — validators, access
// rules, notifications — imports from here instead of repeating the strings.
//
//   admin     everything
//   bd        business development: leads → proposals → projects, on their own
//             assigned leads (read-only on invoices of those projects)
//   accounts  invoicing and payments, from the moment a project is completed
export const ROLES = { admin: 'admin', bd: 'bd', accounts: 'accounts' } as const
export type Role = (typeof ROLES)[keyof typeof ROLES]
export const ROLE_VALUES = [ROLES.admin, ROLES.bd, ROLES.accounts] as const

// The role a new team member gets when none is chosen.
export const DEFAULT_ROLE: Role = ROLES.bd

// Who can own leads, projects and tasks. Admins oversee and accounts bill, so
// neither is ever the assignee.
export const ASSIGNABLE_ROLES: readonly Role[] = [ROLES.bd]
export const isAssignableRole = (role: string | null | undefined): boolean => ASSIGNABLE_ROLES.includes(role as Role)

export const ROLE_LABELS: Record<Role, string> = { admin: 'an admin', bd: 'a BD team member', accounts: 'an accounts team member' }

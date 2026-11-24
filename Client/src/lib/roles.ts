// The one place the role names live on the client (the server has the same list
// in Server/src/utils/roles.ts). Menus, labels and "who can do what" all read
// from here instead of repeating the strings.
//
//   admin     everything
//   bd        business development: leads → proposals → projects, on their own
//             assigned leads; can see (not change) invoices on those projects
//   accounts  invoicing and payments, from the moment a project is completed
export const ROLES = { admin: 'admin', bd: 'bd', accounts: 'accounts' } as const
export type Role = (typeof ROLES)[keyof typeof ROLES]

export const DEFAULT_ROLE: Role = ROLES.bd

export const ROLE_INFO: Record<Role, { label: string; article: string; hint: string }> = {
  admin: { label: 'Admin', article: 'an admin', hint: 'Full access' },
  bd: { label: 'BD', article: 'a BD team member', hint: 'Leads to projects — their own assigned work' },
  accounts: { label: 'Accounts', article: 'an accounts team member', hint: 'Invoicing and payments on completed projects' },
}
export const ROLE_LIST: Role[] = [ROLES.admin, ROLES.bd, ROLES.accounts]

export const roleLabel = (role: string | null | undefined): string => ROLE_INFO[role as Role]?.label ?? String(role ?? '')

// Who can own leads, projects and tasks — admins oversee and accounts bill, so neither is an assignee.
export const isAssignableRole = (role: string | null | undefined): boolean => role === ROLES.bd

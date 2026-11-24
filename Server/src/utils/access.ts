import { prisma } from '../prisma'
import { Prisma } from '../generated/prisma/client'
import { ROLES, Role } from './roles'

// Shared by every route that gates a write to "admin, or the person this
// record is currently assigned to" — was duplicated byte-for-byte across
// leads.ts, proposals.ts, projects.ts, invoices.ts, and documents.ts.

export async function getRole(userId: string | undefined): Promise<Role | null> {
  if (!userId) return null
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  return (user?.role as Role | undefined) ?? null
}

export async function isAdmin(userId: string | undefined): Promise<boolean> {
  return (await getRole(userId)) === ROLES.admin
}

// Who is asking, in the terms the access rules need.
export type Access = { admin: boolean; accounts: boolean; bd: boolean }
export async function getAccess(userId: string | undefined): Promise<Access> {
  const role = await getRole(userId)
  return { admin: role === ROLES.admin, accounts: role === ROLES.accounts, bd: role === ROLES.bd }
}

// Invoices (create, edit, record payments) belong to Accounts — and admins.
export const canManageInvoices = (a: Access) => a.admin || a.accounts

// A lead is accessible if you're an admin, or it's assigned to you — used
// wherever a route needs to check access to a lead it's not itself the
// resource for (a proposal/project/document referencing one). Accounts have
// no lead access: nothing is assigned to them.
export async function canAccessLead(leadId: string, userId: string | undefined, admin: boolean) {
  return prisma.lead.findFirst({ where: { id: leadId, deletedAt: null, ...(admin ? {} : { assignedToUserId: userId }) } })
}

// Which projects someone can see: admins all; BD the ones on their own leads;
// Accounts the ones handed over to them for invoicing (completed in the app),
// plus any that already carry an invoice.
export function projectScope(a: Access, userId: string | undefined): Prisma.ProjectWhereInput {
  if (a.admin) return {}
  if (a.accounts) return { OR: [{ billingHandoffAt: { not: null } }, { invoices: { some: { deletedAt: null } } }] }
  return { lead: { assignedToUserId: userId } }
}

// Invoices follow their project — except Accounts, who see every invoice.
export function invoiceScope(a: Access, userId: string | undefined): Prisma.InvoiceWhereInput {
  if (a.admin || a.accounts) return {}
  return { project: { lead: { assignedToUserId: userId } } }
}

// Same idea, one level down — a project is accessible per `projectScope`.
export async function canAccessProject(projectId: string, userId: string | undefined, a: Access) {
  return prisma.project.findFirst({ where: { id: projectId, deletedAt: null, ...projectScope(a, userId) } })
}

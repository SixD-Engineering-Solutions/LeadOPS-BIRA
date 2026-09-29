import { prisma } from '../prisma'

// Shared by every route that gates a write to "admin, or the employee this
// record is currently assigned to" — was duplicated byte-for-byte across
// leads.ts, proposals.ts, projects.ts, invoices.ts, and documents.ts.

export async function isAdmin(userId: string | undefined): Promise<boolean> {
  if (!userId) return false
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  return user?.role === 'admin'
}

// A lead is accessible if you're an admin, or it's assigned to you — used
// wherever a route needs to check access to a lead it's not itself the
// resource for (a proposal/project/document referencing one).
export async function canAccessLead(leadId: string, userId: string | undefined, admin: boolean) {
  return prisma.lead.findFirst({ where: { id: leadId, deletedAt: null, ...(admin ? {} : { assignedToUserId: userId }) } })
}

// Same idea, one level down — a project is accessible if you're an admin, or
// its lead is assigned to you.
export async function canAccessProject(projectId: string, userId: string | undefined, admin: boolean) {
  return prisma.project.findFirst({ where: { id: projectId, deletedAt: null, ...(admin ? {} : { lead: { assignedToUserId: userId } }) } })
}

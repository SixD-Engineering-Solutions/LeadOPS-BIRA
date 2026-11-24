import { prisma } from '../prisma'
import { notifyUser } from './notify'
import { ROLES } from '../utils/roles'

// When a project is completed in the app, invoicing passes to the Accounts
// team: the project is stamped with `billingHandoffAt` (that is what puts it in
// their queue — see projectScope in utils/access.ts) and every active Accounts
// user is notified. No account is named here: the team is whoever currently
// holds the accounts role. With nobody in that role yet, the admins are told
// instead, so a completed project is never silently unbilled.
//
// Only a status change made in the app triggers this. Projects that arrive
// completed through the sheet sync are history, not new work for Accounts.

type ProjectLike = {
  id: string
  leadId: string
  workOrderNo: string
  projectName: string
  lead?: { plant?: { plantName?: string | null; client?: { clientName?: string | null } | null } | null } | null
}

const whoFor = (p: ProjectLike) => [p.lead?.plant?.client?.clientName, p.lead?.plant?.plantName].filter(Boolean).join(' · ')

export async function handOffToAccounts(project: ProjectLike): Promise<void> {
  await prisma.project.update({ where: { id: project.id }, data: { billingHandoffAt: new Date() } })
  const accounts = await prisma.user.findMany({ where: { role: ROLES.accounts, isActive: true }, select: { id: true } })
  const recipients = accounts.length ? accounts : await prisma.user.findMany({ where: { role: ROLES.admin, isActive: true }, select: { id: true } })
  const where = whoFor(project)
  const message = `${project.workOrderNo} · ${project.projectName}${where ? ` (${where})` : ''} is completed — ready for invoicing.`
  // Not tied to the lead: Accounts have no access to leads, so the
  // notification must not point at one.
  await Promise.all(recipients.map(u => notifyUser(u.id, message, null).catch(() => {})))
}

// A completed project reopened before anything was invoiced leaves the queue.
// If it already has invoices it stays, so billing in progress isn't orphaned.
export async function withdrawHandoff(projectId: string): Promise<void> {
  const invoiced = await prisma.invoice.count({ where: { projectId, deletedAt: null } })
  if (invoiced === 0) await prisma.project.update({ where: { id: projectId }, data: { billingHandoffAt: null } })
}

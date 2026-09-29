import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../prisma'
import { Prisma } from '../generated/prisma/client'
import { authenticate, requireAdmin, AuthRequest } from '../middleware/authenticate'
import { broadcastProjectUpdate } from '../services/notify'
import { nextSequenceNumber, TX_OPTS } from '../utils/sequence'
import { isAdmin, canAccessLead } from '../utils/access'
import { sendError } from '../utils/errors'
import { syncLeadToPipeline, syncTrackerBestEffort } from '../utils/pipelineSync'

const router = Router()
router.use(authenticate)

export const PROJECT_STATUSES = ['Not Started', 'In Progress', 'On Hold', 'Completed'] as const
export const BILLING_STAGES = ['Not Started', 'Advance Received', 'Partial Billing', 'Final Billing', 'Fully Billed'] as const

const projectInclude = {
  lead: { select: { id: true, plant: { select: { id: true, plantName: true, client: { select: { id: true, clientName: true } } } } } },
  location: { select: { id: true, city: true, state: true } },
  responsibleUser: { select: { id: true, userName: true, email: true } },
  proposal: { select: { id: true, proposalNumber: true } },
} as const

// Same visibility rule as leads.ts: employees only see projects on their own leads, admins see all.

// Pass a transaction client when creating a project in the same transaction,
// so reserving the number and creating the row succeed or fail together.
export function nextWorkOrderNo(client: typeof prisma | Prisma.TransactionClient = prisma): Promise<string> {
  return nextSequenceNumber(client, 'project', 'WO')
}

// GET /projects
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const admin = await isAdmin(req.userId)
  const leadId = req.query.leadId ? String(req.query.leadId) : undefined
  const projects = await prisma.project.findMany({
    where: {
      deletedAt: null,
      ...(leadId ? { leadId } : {}),
      ...(admin ? {} : { lead: { assignedToUserId: req.userId } }),
    },
    include: projectInclude,
    orderBy: { createdAt: 'desc' },
  })
  res.json({ projects })
})

router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const admin = await isAdmin(req.userId)
  const project = await prisma.project.findFirst({
    where: { id: String(req.params.id), deletedAt: null, ...(admin ? {} : { lead: { assignedToUserId: req.userId } }) },
    include: projectInclude,
  })
  if (!project) {
    sendError(res, 404, 'Project not found.')
    return
  }
  res.json({ project })
})

// POST /projects — for work raised directly, without going through a Won
// proposal (the Won-proposal path auto-creates one instead, see proposals.ts).
const createSchema = z.object({
  leadId: z.string().min(1),
  projectName: z.string().min(1, 'Project name is required.'),
  locationId: z.string().optional(),
  startDate: z.coerce.date().optional(),
  completionDate: z.coerce.date().optional(),
  responsibleUserId: z.string().optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  billingStage: z.enum(BILLING_STAGES).optional(),
})

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = createSchema.safeParse(req.body)
  if (!parse.success) {
    sendError(res, 400, parse.error.issues[0]?.message ?? 'Invalid project data.')
    return
  }
  const d = parse.data
  const admin = await isAdmin(req.userId)
  const lead = await canAccessLead(d.leadId, req.userId, admin)
  if (!lead) {
    sendError(res, 404, 'Lead not found.')
    return
  }
  if (d.responsibleUserId) {
    const engineer = await prisma.user.findUnique({ where: { id: d.responsibleUserId }, select: { role: true } })
    if (engineer?.role === 'admin') {
      sendError(res, 400, 'Projects cannot be assigned to an admin user.')
      return
    }
  }
  try {
    // Reserving the work order number and creating the row are one atomic
    // unit — if the create fails validation after the number's reserved, the
    // whole transaction rolls back rather than burning a number on a project
    // that was never actually created (a rolled-back number is a harmless gap
    // either way, but there's no reason not to keep them together).
    const project = await prisma.$transaction(async tx => {
      const workOrderNo = await nextWorkOrderNo(tx)
      const created = await tx.project.create({
        data: {
          workOrderNo,
          leadId: d.leadId,
          projectName: d.projectName.trim(),
          locationId: d.locationId || null,
          startDate: d.startDate ?? null,
          completionDate: d.completionDate ?? null,
          responsibleUserId: d.responsibleUserId || null,
          status: d.status ?? 'Not Started',
          billingStage: d.billingStage ?? 'Not Started',
          createdByUserId: req.userId!,
        },
        include: projectInclude,
      })
      return created
    }, TX_OPTS)
    // Refreshes the lead's Pipeline row with the new project's status.
    // After the transaction, not inside it.
    await syncTrackerBestEffort(() => syncLeadToPipeline(prisma, d.leadId))
    broadcastProjectUpdate(project.id)
    res.status(201).json({ project })
  } catch {
    sendError(res, 400, 'Could not create project.')
  }
})

// PATCH /projects/:id
const updateSchema = z.object({
  projectName: z.string().min(1).optional(),
  locationId: z.string().nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  completionDate: z.coerce.date().nullable().optional(),
  responsibleUserId: z.string().nullable().optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  billingStage: z.enum(BILLING_STAGES).optional(),
})

router.patch('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = updateSchema.safeParse(req.body)
  if (!parse.success) {
    sendError(res, 400, 'Invalid update data.')
    return
  }
  const admin = await isAdmin(req.userId)
  const existing = await prisma.project.findFirst({
    where: { id: String(req.params.id), deletedAt: null, ...(admin ? {} : { lead: { assignedToUserId: req.userId } }) },
  })
  if (!existing) {
    sendError(res, 404, 'Project not found.')
    return
  }

  const d = parse.data
  if (d.responsibleUserId) {
    const engineer = await prisma.user.findUnique({ where: { id: d.responsibleUserId }, select: { role: true } })
    if (engineer?.role === 'admin') {
      sendError(res, 400, 'Projects cannot be assigned to an admin user.')
      return
    }
  }

  const data: Record<string, unknown> = {}
  if (d.projectName) data.projectName = d.projectName.trim()
  if ('locationId' in d) data.locationId = d.locationId || null
  if ('startDate' in d) data.startDate = d.startDate
  if ('completionDate' in d) data.completionDate = d.completionDate
  if ('responsibleUserId' in d) data.responsibleUserId = d.responsibleUserId || null
  if (d.status) data.status = d.status
  if (d.billingStage) data.billingStage = d.billingStage

  try {
    const project = await prisma.project.update({ where: { id: existing.id }, data, include: projectInclude })
    await syncTrackerBestEffort(() => syncLeadToPipeline(prisma, existing.leadId))
    broadcastProjectUpdate(project.id)
    res.json({ project })
  } catch {
    sendError(res, 400, 'Could not update project.')
  }
})

// DELETE /projects/:id — admin-only soft delete, same pattern as leads/tasks/proposals.
router.delete('/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await prisma.project.findFirst({ where: { id: String(req.params.id), deletedAt: null } })
  if (!existing) {
    sendError(res, 404, 'Project not found.')
    return
  }
  await prisma.project.update({ where: { id: existing.id }, data: { deletedAt: new Date() } })
  await syncTrackerBestEffort(() => syncLeadToPipeline(prisma, existing.leadId))
  broadcastProjectUpdate(existing.id)
  res.json({ message: 'Project deleted.' })
})

export default router

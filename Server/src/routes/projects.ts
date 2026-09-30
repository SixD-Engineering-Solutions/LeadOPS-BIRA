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
// Engineer and both dates are mandatory on every project — here, on the
// Won → project auto-create (proposals.ts), and they can't be cleared later.
const createSchema = z.object({
  leadId: z.string().min(1),
  projectName: z.string().min(1, 'Project name is required.'),
  locationId: z.string().optional(),
  startDate: z.coerce.date({ message: 'Start date is required.' }),
  completionDate: z.coerce.date({ message: 'Completion date is required.' }),
  responsibleUserId: z.string({ message: 'Responsible engineer is required.' }).min(1, 'Responsible engineer is required.'),
  status: z.enum(PROJECT_STATUSES).optional(),
  billingStage: z.enum(BILLING_STAGES).optional(),
}).refine(d => d.completionDate >= d.startDate, { message: 'Completion date can’t be before the start date.' })

/** Checks a would-be project engineer: must be an active, non-admin user.
 *  Returns an error message, or null when fine. */
export async function checkEngineer(userId: string): Promise<string | null> {
  const engineer = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } })
  if (!engineer || !engineer.isActive) return 'Responsible engineer not found.'
  if (engineer.role === 'admin') return 'Projects cannot be assigned to an admin user.'
  return null
}

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
  const engineerError = await checkEngineer(d.responsibleUserId)
  if (engineerError) {
    sendError(res, 400, engineerError)
    return
  }
  try {
    // Reserving the work order number and creating the row are one atomic
    // unit — if the create fails validation after the number's reserved, the
    // whole transaction rolls back rather than burning a number on a project
    // that was never actually created (a rolled-back number is a harmless gap
    // either way, but there's no reason not to keep them together).
    // One project per lead — same rule as proposals. The lead row is locked
    // first so two simultaneous creates can't both pass the check; refusing
    // before the number's reserved (and rolling back) burns no work order no.
    const project = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM leads WHERE id = ${d.leadId} FOR UPDATE`
      const existing = await tx.project.findFirst({ where: { leadId: d.leadId, deletedAt: null }, select: { workOrderNo: true } })
      if (existing) throw new DuplicateProjectError(existing.workOrderNo)
      const workOrderNo = await nextWorkOrderNo(tx)
      const created = await tx.project.create({
        data: {
          workOrderNo,
          leadId: d.leadId,
          projectName: d.projectName.trim(),
          locationId: d.locationId || null,
          startDate: d.startDate,
          completionDate: d.completionDate,
          responsibleUserId: d.responsibleUserId,
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
  } catch (err) {
    if (err instanceof DuplicateProjectError) {
      sendError(res, 409, `This lead already has a project (${err.workOrderNo}). Update that one instead of creating a new one.`)
      return
    }
    sendError(res, 400, 'Could not create project.')
  }
})

class DuplicateProjectError extends Error {
  constructor(readonly workOrderNo: string) { super('Lead already has a project.') }
}

// PATCH /projects/:id
const updateSchema = z.object({
  projectName: z.string().min(1).optional(),
  locationId: z.string().nullable().optional(),
  // Mandatory fields: can be changed, never cleared (no null).
  startDate: z.coerce.date().optional(),
  completionDate: z.coerce.date().optional(),
  responsibleUserId: z.string().min(1, 'Responsible engineer is required.').optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  billingStage: z.enum(BILLING_STAGES).optional(),
})

router.patch('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = updateSchema.safeParse(req.body)
  if (!parse.success) {
    sendError(res, 400, parse.error.issues[0]?.message ?? 'Invalid update data.')
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
    const engineerError = await checkEngineer(d.responsibleUserId)
    if (engineerError) {
      sendError(res, 400, engineerError)
      return
    }
  }
  // The project as it will be after this update — date order and the
  // mandatory fields are checked on that, not just on what was sent.
  const next = {
    startDate: d.startDate ?? existing.startDate,
    completionDate: d.completionDate ?? existing.completionDate,
    responsibleUserId: d.responsibleUserId ?? existing.responsibleUserId,
  }
  if (next.startDate && next.completionDate && next.completionDate < next.startDate) {
    sendError(res, 400, 'Completion date can’t be before the start date.')
    return
  }
  // Projects from before these fields were mandatory may still lack them:
  // they can be filled in, but the work can't move on until they are.
  if (d.status && d.status !== 'Not Started' && (!next.responsibleUserId || !next.startDate || !next.completionDate)) {
    sendError(res, 400, 'Assign a responsible engineer and start/completion dates before changing the status.')
    return
  }

  const data: Record<string, unknown> = {}
  if (d.projectName) data.projectName = d.projectName.trim()
  if ('locationId' in d) data.locationId = d.locationId || null
  if (d.startDate) data.startDate = d.startDate
  if (d.completionDate) data.completionDate = d.completionDate
  if (d.responsibleUserId) data.responsibleUserId = d.responsibleUserId
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

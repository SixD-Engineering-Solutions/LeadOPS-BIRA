import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../prisma'
import { authenticate, requireAdmin, AuthRequest } from '../middleware/authenticate'
import { broadcastProjectUpdate } from '../services/notify'

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
async function isAdmin(userId: string | undefined): Promise<boolean> {
  if (!userId) return false
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  return user?.role === 'admin'
}
async function canAccessLead(leadId: string, userId: string | undefined, admin: boolean) {
  return prisma.lead.findFirst({ where: { id: leadId, deletedAt: null, ...(admin ? {} : { assignedToUserId: userId }) } })
}

export async function nextWorkOrderNo(): Promise<string> {
  const count = await prisma.project.count()
  return `WO-${String(count + 1).padStart(4, '0')}`
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
    res.status(404).json({ error: 'Project not found.' })
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
    res.status(400).json({ error: parse.error.issues[0]?.message ?? 'Invalid project data.' })
    return
  }
  const d = parse.data
  const admin = await isAdmin(req.userId)
  const lead = await canAccessLead(d.leadId, req.userId, admin)
  if (!lead) {
    res.status(404).json({ error: 'Lead not found.' })
    return
  }
  if (d.responsibleUserId) {
    const engineer = await prisma.user.findUnique({ where: { id: d.responsibleUserId }, select: { role: true } })
    if (engineer?.role === 'admin') {
      res.status(400).json({ error: 'Projects cannot be assigned to an admin user.' })
      return
    }
  }
  try {
    const project = await prisma.project.create({
      data: {
        workOrderNo: await nextWorkOrderNo(),
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
    broadcastProjectUpdate(project.id)
    res.status(201).json({ project })
  } catch {
    res.status(400).json({ error: 'Could not create project.' })
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
    res.status(400).json({ error: 'Invalid update data.' })
    return
  }
  const admin = await isAdmin(req.userId)
  const existing = await prisma.project.findFirst({
    where: { id: String(req.params.id), deletedAt: null, ...(admin ? {} : { lead: { assignedToUserId: req.userId } }) },
  })
  if (!existing) {
    res.status(404).json({ error: 'Project not found.' })
    return
  }

  const d = parse.data
  if (d.responsibleUserId) {
    const engineer = await prisma.user.findUnique({ where: { id: d.responsibleUserId }, select: { role: true } })
    if (engineer?.role === 'admin') {
      res.status(400).json({ error: 'Projects cannot be assigned to an admin user.' })
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
    broadcastProjectUpdate(project.id)
    res.json({ project })
  } catch {
    res.status(400).json({ error: 'Could not update project.' })
  }
})

// DELETE /projects/:id — admin-only soft delete, same pattern as leads/tasks/proposals.
router.delete('/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await prisma.project.findFirst({ where: { id: String(req.params.id), deletedAt: null } })
  if (!existing) {
    res.status(404).json({ error: 'Project not found.' })
    return
  }
  await prisma.project.update({ where: { id: existing.id }, data: { deletedAt: new Date() } })
  broadcastProjectUpdate(existing.id)
  res.json({ message: 'Project deleted.' })
})

export default router

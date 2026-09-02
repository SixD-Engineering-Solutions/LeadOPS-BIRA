import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../prisma'
import { authenticate, requireAdmin, AuthRequest } from '../middleware/authenticate'
import { broadcastProposalUpdate, broadcastProjectUpdate } from '../services/notify'
import { nextWorkOrderNo } from './projects'

const router = Router()
router.use(authenticate)

export const PROPOSAL_STATUSES = ['Draft', 'Submitted', 'Follow-up', 'Negotiation', 'Won', 'Lost', 'Hold'] as const

const proposalInclude = {
  lead: { select: { id: true, plant: { select: { id: true, plantName: true, client: { select: { id: true, clientName: true } } } } } },
  createdByUser: { select: { id: true, userName: true, email: true } },
} as const

// Same visibility rule as leads.ts: employees only see proposals on their own leads, admins see all.
async function isAdmin(userId: string | undefined): Promise<boolean> {
  if (!userId) return false
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  return user?.role === 'admin'
}
async function canAccessLead(leadId: string, userId: string | undefined, admin: boolean) {
  return prisma.lead.findFirst({ where: { id: leadId, deletedAt: null, ...(admin ? {} : { assignedToUserId: userId }) } })
}

// GET /proposals — all proposals (admin), or just the ones on the current
// user's own leads (employee). Optional ?leadId= to scope to one lead.
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const admin = await isAdmin(req.userId)
  const leadId = req.query.leadId ? String(req.query.leadId) : undefined
  const proposals = await prisma.proposal.findMany({
    where: {
      deletedAt: null,
      ...(leadId ? { leadId } : {}),
      ...(admin ? {} : { lead: { assignedToUserId: req.userId } }),
    },
    include: proposalInclude,
    orderBy: { createdAt: 'desc' },
  })
  res.json({ proposals })
})

router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const admin = await isAdmin(req.userId)
  const proposal = await prisma.proposal.findFirst({
    where: { id: String(req.params.id), deletedAt: null, ...(admin ? {} : { lead: { assignedToUserId: req.userId } }) },
    include: proposalInclude,
  })
  if (!proposal) {
    res.status(404).json({ error: 'Proposal not found.' })
    return
  }
  res.json({ proposal })
})

// POST /proposals — proposalNumber is assigned by the server (PROP-0001, sequential).
const createSchema = z.object({
  leadId: z.string().min(1),
  projectName: z.string().optional(),
  value: z.coerce.number().optional(),
  submissionDate: z.coerce.date().optional(),
  status: z.enum(PROPOSAL_STATUSES).optional(),
  probabilityPct: z.coerce.number().int().min(0).max(100).optional(),
  expectedOrderDate: z.coerce.date().optional(),
})

async function nextProposalNumber(): Promise<string> {
  const count = await prisma.proposal.count()
  return `PROP-${String(count + 1).padStart(4, '0')}`
}

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = createSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message ?? 'Invalid proposal data.' })
    return
  }
  const d = parse.data
  const admin = await isAdmin(req.userId)
  const lead = await canAccessLead(d.leadId, req.userId, admin)
  if (!lead) {
    res.status(404).json({ error: 'Lead not found.' })
    return
  }
  // Retry once on a proposal-number collision (two simultaneous creates) — rare
  // for this team's volume, so a single retry is enough rather than a lock.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const proposal = await prisma.proposal.create({
        data: {
          proposalNumber: await nextProposalNumber(),
          leadId: d.leadId,
          projectName: d.projectName?.trim() || null,
          value: d.value ?? null,
          submissionDate: d.submissionDate ?? null,
          status: d.status ?? 'Draft',
          probabilityPct: d.probabilityPct ?? null,
          expectedOrderDate: d.expectedOrderDate ?? null,
          createdByUserId: req.userId!,
        },
        include: proposalInclude,
      })
      broadcastProposalUpdate(proposal.id)
      res.status(201).json({ proposal })
      return
    } catch {
      if (attempt === 1) {
        res.status(400).json({ error: 'Could not create proposal. Please try again.' })
        return
      }
    }
  }
})

// PATCH /proposals/:id — update status/value/probability/dates. Same
// visibility rule as GET: employees can only touch proposals on their own leads.
const updateSchema = z.object({
  projectName: z.string().nullable().optional(),
  value: z.coerce.number().nullable().optional(),
  submissionDate: z.coerce.date().nullable().optional(),
  status: z.enum(PROPOSAL_STATUSES).optional(),
  probabilityPct: z.coerce.number().int().min(0).max(100).nullable().optional(),
  expectedOrderDate: z.coerce.date().nullable().optional(),
})

router.patch('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = updateSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid update data.' })
    return
  }
  const admin = await isAdmin(req.userId)
  const existing = await prisma.proposal.findFirst({
    where: { id: String(req.params.id), deletedAt: null, ...(admin ? {} : { lead: { assignedToUserId: req.userId } }) },
  })
  if (!existing) {
    res.status(404).json({ error: 'Proposal not found.' })
    return
  }

  const d = parse.data
  const data: Record<string, unknown> = {}
  if ('projectName' in d) data.projectName = d.projectName?.trim() || null
  if ('value' in d) data.value = d.value
  if ('submissionDate' in d) data.submissionDate = d.submissionDate
  if (d.status) data.status = d.status
  if ('probabilityPct' in d) data.probabilityPct = d.probabilityPct
  if ('expectedOrderDate' in d) data.expectedOrderDate = d.expectedOrderDate

  try {
    const proposal = await prisma.proposal.update({ where: { id: existing.id }, data, include: proposalInclude })
    broadcastProposalUpdate(proposal.id)

    // Marking a proposal Won graduates it into an actual project to execute —
    // auto-create one (once) if it doesn't already have one.
    if (data.status === 'Won') {
      const alreadyHasProject = await prisma.project.findUnique({ where: { proposalId: proposal.id } })
      if (!alreadyHasProject) {
        const lead = await prisma.lead.findUnique({ where: { id: proposal.leadId }, select: { plant: { select: { plantName: true, locationId: true } } } })
        const project = await prisma.project.create({
          data: {
            workOrderNo: await nextWorkOrderNo(),
            proposalId: proposal.id,
            leadId: proposal.leadId,
            projectName: proposal.projectName || lead?.plant.plantName || 'Untitled project',
            locationId: lead?.plant.locationId ?? null,
            createdByUserId: req.userId!,
          },
        })
        broadcastProjectUpdate(project.id)
      }
    }

    res.json({ proposal })
  } catch {
    res.status(400).json({ error: 'Could not update proposal.' })
  }
})

// DELETE /proposals/:id — admin-only soft delete, same pattern as leads/tasks.
router.delete('/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await prisma.proposal.findFirst({ where: { id: String(req.params.id), deletedAt: null } })
  if (!existing) {
    res.status(404).json({ error: 'Proposal not found.' })
    return
  }
  await prisma.proposal.update({ where: { id: existing.id }, data: { deletedAt: new Date() } })
  broadcastProposalUpdate(existing.id)
  res.json({ message: 'Proposal deleted.' })
})

export default router

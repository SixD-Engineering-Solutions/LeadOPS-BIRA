import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../prisma'
import { authenticate, requireAdmin, AuthRequest } from '../middleware/authenticate'
import { broadcastProposalUpdate, broadcastProjectUpdate } from '../services/notify'
import { nextWorkOrderNo } from './projects'
import { syncLeadToPipeline, syncTrackerBestEffort } from '../utils/pipelineSync'
import { nextSequenceNumber, TX_OPTS } from '../utils/sequence'
import { isAdmin, canAccessLead } from '../utils/access'
import { sendError } from '../utils/errors'

const router = Router()
router.use(authenticate)

export const PROPOSAL_STATUSES = ['Draft', 'Submitted', 'Follow-up', 'Negotiation', 'Won', 'Lost', 'Hold'] as const

const proposalInclude = {
  lead: { select: { id: true, plant: { select: { id: true, plantName: true, client: { select: { id: true, clientName: true } } } } } },
  createdByUser: { select: { id: true, userName: true, email: true } },
} as const

// Same visibility rule as leads.ts: employees only see proposals on their own leads, admins see all.

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
    sendError(res, 404, 'Proposal not found.')
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

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = createSchema.safeParse(req.body)
  if (!parse.success) {
    sendError(res, 400, parse.error.issues[0]?.message ?? 'Invalid proposal data.')
    return
  }
  const d = parse.data
  const admin = await isAdmin(req.userId)
  const lead = await canAccessLead(d.leadId, req.userId, admin)
  if (!lead) {
    sendError(res, 404, 'Lead not found.')
    return
  }
  try {
    // Reserving the proposal number and creating the row together, so a
    // failed create can't burn a number without ever producing a proposal.
    // (This replaces the old count()+1 + retry-on-collision approach — that
    // could still hand two concurrent requests the same number in the gap
    // between reading the count and either one's create landing; the atomic
    // counter here can't be read the same way twice.)
    // One proposal per lead: revise the existing one instead of raising
    // another. Locking the lead row first makes the check hold under two
    // simultaneous creates (the second waits, then sees the first's row).
    // Checked before the number is reserved, and the transaction rolls back
    // on refusal either way, so no proposal number is burned.
    const proposal = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM leads WHERE id = ${d.leadId} FOR UPDATE`
      const existing = await tx.proposal.findFirst({ where: { leadId: d.leadId, deletedAt: null }, select: { proposalNumber: true } })
      if (existing) throw new DuplicateProposalError(existing.proposalNumber)
      const proposalNumber = await nextSequenceNumber(tx, 'proposal', 'PROP')
      return tx.proposal.create({
        data: {
          proposalNumber,
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
    }, TX_OPTS)
    await syncTrackerBestEffort(() => syncLeadToPipeline(prisma, d.leadId))
    broadcastProposalUpdate(proposal.id)
    res.status(201).json({ proposal })
  } catch (err) {
    if (err instanceof DuplicateProposalError) {
      sendError(res, 409, `This lead already has a proposal (${err.proposalNumber}). Update that one instead of raising a new one.`)
      return
    }
    sendError(res, 400, 'Could not create proposal.')
  }
})

class DuplicateProposalError extends Error {
  constructor(readonly proposalNumber: string) { super('Lead already has a proposal.') }
}

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
    sendError(res, 400, 'Invalid update data.')
    return
  }
  const admin = await isAdmin(req.userId)
  const existing = await prisma.proposal.findFirst({
    where: { id: String(req.params.id), deletedAt: null, ...(admin ? {} : { lead: { assignedToUserId: req.userId } }) },
  })
  if (!existing) {
    sendError(res, 404, 'Proposal not found.')
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
    // The status update and the Won→Project auto-create are one transaction:
    // if the project create fails, the status change rolls back with it,
    // rather than leaving a proposal marked "Won" with no project ever
    // created (which could otherwise happen if the create failed for any
    // reason after the status had already been committed on its own).
    //
    // The "does it already have a project" check is a fast pre-check, not the
    // actual duplicate-prevention guarantee — under Postgres's default READ
    // COMMITTED isolation, two near-simultaneous "mark Won" requests on the
    // same proposal could both see "no project yet" before either commits.
    // What actually prevents a duplicate is `Project.proposalId` being
    // `@unique`: the second transaction's create throws a unique-constraint
    // error, caught below, and its status change rolls back too — an
    // acceptable outcome (an unfriendly error) for an outcome (no duplicate
    // project, ever) that's the actual requirement.
    const result = await prisma.$transaction(async tx => {
      const proposal = await tx.proposal.update({ where: { id: existing.id }, data, include: proposalInclude })
      let project = null
      if (data.status === 'Won') {
        // One project per lead: if the lead already has one (say, raised by
        // hand before the proposal was won), link it to this proposal rather
        // than creating a second.
        await tx.$queryRaw`SELECT id FROM leads WHERE id = ${proposal.leadId} FOR UPDATE`
        const alreadyHasProject =
          (await tx.project.findUnique({ where: { proposalId: proposal.id } })) ??
          (await tx.project.findFirst({ where: { leadId: proposal.leadId, deletedAt: null } }))
        if (alreadyHasProject && !alreadyHasProject.proposalId) {
          await tx.project.update({ where: { id: alreadyHasProject.id }, data: { proposalId: proposal.id } })
        }
        if (!alreadyHasProject) {
          const lead = await tx.lead.findUnique({ where: { id: proposal.leadId }, select: { plant: { select: { plantName: true, locationId: true } } } })
          project = await tx.project.create({
            data: {
              workOrderNo: await nextWorkOrderNo(tx),
              proposalId: proposal.id,
              leadId: proposal.leadId,
              projectName: proposal.projectName || lead?.plant.plantName || 'Untitled project',
              locationId: lead?.plant.locationId ?? null,
              createdByUserId: req.userId!,
            },
          })
        }
      }
      return { proposal, project }
    }, TX_OPTS)
    // After the transaction, not inside it — this is the exact transaction
    // the "no duplicate Won→Project" concurrency test hammers.
    await syncTrackerBestEffort(() => syncLeadToPipeline(prisma, result.proposal.leadId))
    broadcastProposalUpdate(result.proposal.id)
    if (result.project) broadcastProjectUpdate(result.project.id)
    res.json({ proposal: result.proposal })
  } catch {
    sendError(res, 400, 'Could not update proposal.')
  }
})

// DELETE /proposals/:id — admin-only soft delete, same pattern as leads/tasks.
router.delete('/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await prisma.proposal.findFirst({ where: { id: String(req.params.id), deletedAt: null } })
  if (!existing) {
    sendError(res, 404, 'Proposal not found.')
    return
  }
  await prisma.proposal.update({ where: { id: existing.id }, data: { deletedAt: new Date() } })
  await syncTrackerBestEffort(() => syncLeadToPipeline(prisma, existing.leadId))
  broadcastProposalUpdate(existing.id)
  res.json({ message: 'Proposal deleted.' })
})

export default router

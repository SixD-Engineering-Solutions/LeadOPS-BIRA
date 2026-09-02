import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../prisma'
import { authenticate, AuthRequest } from '../middleware/authenticate'
import { broadcastActivityUpdate } from '../services/notify'

const router = Router()
router.use(authenticate)

const ACTIVITY_TYPES = ['Call', 'Visit', 'Meeting', 'Mail', 'Proposal'] as const

const activityInclude = {
  user: { select: { id: true, userName: true, email: true } },
  lead: { select: { id: true, plant: { select: { id: true, plantName: true } } } },
} as const

// Same visibility rule as leads.ts: employees only see their own leads, admins see all.
async function isAdmin(userId: string | undefined): Promise<boolean> {
  if (!userId) return false
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  return user?.role === 'admin'
}
async function canAccessLead(leadId: string, userId: string | undefined, admin: boolean) {
  return prisma.lead.findFirst({ where: { id: leadId, deletedAt: null, ...(admin ? {} : { assignedToUserId: userId }) } })
}

// GET /activities?leadId=xxx — timeline for one lead
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const leadId = req.query.leadId ? String(req.query.leadId) : undefined
  if (!leadId) {
    res.status(400).json({ error: 'leadId is required.' })
    return
  }
  const admin = await isAdmin(req.userId)
  const lead = await canAccessLead(leadId, req.userId, admin)
  if (!lead) {
    res.status(404).json({ error: 'Lead not found.' })
    return
  }
  const activities = await prisma.activity.findMany({ where: { leadId }, include: activityInclude, orderBy: { activityDate: 'desc' } })
  res.json({ activities })
})

// GET /activities/follow-ups — today / overdue / upcoming (next 7 days) buckets.
// Uses only each lead's most recent activity that has a next action date, so a
// lead that's already been followed up on doesn't keep showing a stale reminder.
router.get('/follow-ups', async (req: AuthRequest, res: Response): Promise<void> => {
  const admin = await isAdmin(req.userId)
  const activities = await prisma.activity.findMany({
    where: {
      nextActionDate: { not: null },
      lead: { deletedAt: null, ...(admin ? {} : { assignedToUserId: req.userId }) },
    },
    include: activityInclude,
    orderBy: [{ leadId: 'asc' }, { activityDate: 'desc' }],
  })

  const latestByLead = new Map<string, (typeof activities)[number]>()
  for (const a of activities) if (!latestByLead.has(a.leadId)) latestByLead.set(a.leadId, a)

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000)
  const in7Days = new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000)

  const today: (typeof activities)[number][] = []
  const overdue: (typeof activities)[number][] = []
  const upcoming: (typeof activities)[number][] = []
  for (const a of latestByLead.values()) {
    const d = new Date(a.nextActionDate!)
    if (d < startOfToday) overdue.push(a)
    else if (d < endOfToday) today.push(a)
    else if (d < in7Days) upcoming.push(a)
  }
  res.json({ today, overdue, upcoming })
})

// POST /activities — log a call/visit/meeting/mail/proposal against a lead.
const createSchema = z.object({
  leadId: z.string().min(1),
  activityType: z.enum(ACTIVITY_TYPES),
  activityDate: z.coerce.date().optional(),
  notes: z.string().optional(),
  nextActionDate: z.coerce.date().nullable().optional(),
})

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = createSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message ?? 'Invalid activity data.' })
    return
  }
  const d = parse.data
  const admin = await isAdmin(req.userId)
  const lead = await canAccessLead(d.leadId, req.userId, admin)
  if (!lead) {
    res.status(404).json({ error: 'Lead not found.' })
    return
  }
  try {
    const activity = await prisma.activity.create({
      data: {
        leadId: d.leadId,
        userId: req.userId!,
        activityType: d.activityType,
        activityDate: d.activityDate ?? new Date(),
        notes: d.notes?.trim() || null,
        nextActionDate: d.nextActionDate ?? null,
      },
      include: activityInclude,
    })
    broadcastActivityUpdate(activity.leadId)
    res.status(201).json({ activity })
  } catch {
    res.status(400).json({ error: 'Could not create activity.' })
  }
})

export default router

import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../prisma'
import { authenticate, AuthRequest } from '../middleware/authenticate'

// Expos/visits are org-wide reference data (like Client/Vertical/Sector), not
// scoped to one employee — every authenticated user can view and add them.
const router = Router()
router.use(authenticate)

export const EVENT_TYPES = ['Expo', 'Visit'] as const

// GET /events — includes a live leads-generated count per event.
router.get('/', async (_req, res) => {
  const events = await prisma.event.findMany({
    include: { _count: { select: { leads: true } } },
    orderBy: { eventDate: 'desc' },
  })
  res.json({ events: events.map(e => ({ ...e, leadsGenerated: e._count.leads, _count: undefined })) })
})

const createSchema = z.object({
  eventName: z.string().min(1, 'Event name is required.'),
  eventType: z.enum(EVENT_TYPES).optional(),
  eventDate: z.coerce.date().optional(),
})

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = createSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message ?? 'Invalid event data.' })
    return
  }
  const d = parse.data
  const event = await prisma.event.create({
    data: {
      eventName: d.eventName.trim(),
      eventType: d.eventType ?? 'Expo',
      eventDate: d.eventDate ?? null,
      createdByUserId: req.userId!,
    },
  })
  res.status(201).json({ event: { ...event, leadsGenerated: 0 } })
})

export default router

import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../prisma'
import { authenticate, requireAdmin, AuthRequest } from '../middleware/authenticate'

// Client-relationship-level data, not tied to one lead/employee — visible to
// everyone, same as the Client/Catalog reference data.
const router = Router()
router.use(authenticate)

export const EMPANELMENT_STATUSES = ['Applied', 'Under Review', 'Empanelled', 'Rejected', 'Expired'] as const

const empanelmentInclude = {
  client: { select: { id: true, clientName: true } },
  serviceType: { select: { id: true, serviceTypeName: true } },
  createdByUser: { select: { id: true, userName: true, email: true } },
} as const

router.get('/', async (_req, res) => {
  const empanelments = await prisma.empanelment.findMany({
    where: { deletedAt: null },
    include: empanelmentInclude,
    orderBy: { createdAt: 'desc' },
  })
  res.json({ empanelments })
})

const createSchema = z.object({
  clientId: z.string().min(1),
  serviceTypeId: z.string().optional(),
  status: z.enum(EMPANELMENT_STATUSES).optional(),
  renewalDate: z.coerce.date().optional(),
})

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = createSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message ?? 'Invalid empanelment data.' })
    return
  }
  const d = parse.data
  try {
    const empanelment = await prisma.empanelment.create({
      data: {
        clientId: d.clientId,
        serviceTypeId: d.serviceTypeId || null,
        status: d.status ?? 'Applied',
        renewalDate: d.renewalDate ?? null,
        createdByUserId: req.userId!,
      },
      include: empanelmentInclude,
    })
    res.status(201).json({ empanelment })
  } catch {
    res.status(400).json({ error: 'Could not create empanelment. Does the client exist?' })
  }
})

const updateSchema = z.object({
  status: z.enum(EMPANELMENT_STATUSES).optional(),
  renewalDate: z.coerce.date().nullable().optional(),
})

router.patch('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = updateSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid update data.' })
    return
  }
  const existing = await prisma.empanelment.findFirst({ where: { id: String(req.params.id), deletedAt: null } })
  if (!existing) {
    res.status(404).json({ error: 'Empanelment not found.' })
    return
  }
  const d = parse.data
  const data: Record<string, unknown> = {}
  if (d.status) data.status = d.status
  if ('renewalDate' in d) data.renewalDate = d.renewalDate
  const empanelment = await prisma.empanelment.update({ where: { id: existing.id }, data, include: empanelmentInclude })
  res.json({ empanelment })
})

router.delete('/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await prisma.empanelment.findFirst({ where: { id: String(req.params.id), deletedAt: null } })
  if (!existing) {
    res.status(404).json({ error: 'Empanelment not found.' })
    return
  }
  await prisma.empanelment.update({ where: { id: existing.id }, data: { deletedAt: new Date() } })
  res.json({ message: 'Empanelment deleted.' })
})

export default router

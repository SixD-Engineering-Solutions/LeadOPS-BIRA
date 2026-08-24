import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../prisma'
import { authenticate, requireAdmin, AuthRequest } from '../middleware/authenticate'
import { notifyUser, broadcastLeadUpdate } from '../services/notify'

const router = Router()
router.use(authenticate)

// Related data attached to every lead we return, with only display-relevant fields.
const leadInclude = {
  plant: { select: { id: true, plantName: true, companyName: true, plantCode: true, location: { select: { id: true, city: true, state: true, country: true, address: true } } } },
  vertical: { select: { id: true, verticalName: true } },
  sector: { select: { id: true, sectorName: true } },
  contact: { select: { id: true, contactPersonName: true, designation: true, contactPersonNumber: true, alternateNumber: true, mailId: true, isPrimaryContact: true } },
  assignedToUser: { select: { id: true, userName: true, email: true } },
  assignedByUser: { select: { id: true, userName: true, email: true } },
  createdByUser: { select: { id: true, userName: true, email: true } },
  status: { select: { id: true, statusName: true, statusCategory: true } },
} as const

// Employees only see leads currently assigned to them — never another
// employee's leads, even ones they themselves created or handed off; admins
// see everything.
async function isAdmin(userId: string | undefined): Promise<boolean> {
  if (!userId) return false
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  return user?.role === 'admin'
}

function visibilityFilter(userId: string | undefined) {
  return { assignedToUserId: userId }
}

// GET /leads — all non-deleted leads with related data (admins), or just the
// ones the current user is connected to (employees).
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const admin = await isAdmin(req.userId)
  const leads = await prisma.lead.findMany({
    where: admin ? { deletedAt: null } : { deletedAt: null, ...visibilityFilter(req.userId) },
    include: leadInclude,
    orderBy: { createdAt: 'desc' },
  })
  res.json({ leads })
})

// GET /leads/:id — same visibility rule as the list.
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const admin = await isAdmin(req.userId)
  const lead = await prisma.lead.findFirst({
    where: {
      id: String(req.params.id),
      deletedAt: null,
      ...(admin ? {} : visibilityFilter(req.userId)),
    },
    include: leadInclude,
  })
  if (!lead) {
    res.status(404).json({ error: 'Lead not found.' })
    return
  }
  res.json({ lead })
})

// ── find-or-create helpers (case-insensitive by name) ───────────────────────
const ci = (value: string) => ({ equals: value, mode: 'insensitive' as const })

async function foreLocation(city: string) {
  return (await prisma.location.findFirst({ where: { city: ci(city) } })) ?? prisma.location.create({ data: { city } })
}
async function forePlant(name: string, locationId: string | null) {
  const found = await prisma.plant.findFirst({ where: { plantName: ci(name) } })
  if (found) {
    if (locationId && !found.locationId) return prisma.plant.update({ where: { id: found.id }, data: { locationId } })
    return found
  }
  return prisma.plant.create({ data: { plantName: name, locationId } })
}
async function foreContact(name: string, plantId: string, email: string | null, phone: string | null) {
  const existing = await prisma.contact.findFirst({ where: { plantId, contactPersonName: ci(name) } })
  if (existing) {
    const data: { mailId?: string; contactPersonNumber?: string } = {}
    if (email && !existing.mailId) data.mailId = email
    if (phone && !existing.contactPersonNumber) data.contactPersonNumber = phone
    return Object.keys(data).length ? prisma.contact.update({ where: { id: existing.id }, data }) : existing
  }
  return prisma.contact.create({ data: { plantId, contactPersonName: name, mailId: email, contactPersonNumber: phone } })
}
async function foreVertical(name: string) {
  return (await prisma.vertical.findFirst({ where: { verticalName: ci(name) } })) ?? prisma.vertical.create({ data: { verticalName: name } })
}
async function foreSector(name: string) {
  return (await prisma.sector.findFirst({ where: { sectorName: ci(name) } })) ?? prisma.sector.create({ data: { sectorName: name } })
}
const STATUS_CATEGORY: Record<string, string> = { submitted: 'Open', 'in process': 'In Progress', dead: 'Closed Lost' }
async function foreStatus(name: string) {
  const found = await prisma.leadStatus.findFirst({ where: { statusName: ci(name) } })
  if (found) return found
  return prisma.leadStatus.create({ data: { statusName: name, statusCategory: STATUS_CATEGORY[name.toLowerCase()] ?? null } })
}
async function foreUser(input: string) {
  const isEmail = /\S+@\S+\.\S+/.test(input)
  const found = await prisma.user.findFirst({ where: isEmail ? { email: ci(input) } : { userName: ci(input) } })
  if (found) return found
  const email = isEmail ? input.toLowerCase() : `${input.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '')}@leadops.local`
  return (await prisma.user.findUnique({ where: { email } })) ?? prisma.user.create({ data: { userName: isEmail ? null : input, email } })
}

// POST /leads — accepts typed names; reuses or creates the linked records.
const createSchema = z.object({
  plantName: z.string().min(1, 'Plant is required.'),
  city: z.string().optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().email('Contact email must be a valid email address.').optional().or(z.literal('')),
  contactNumber: z.string().optional(),
  verticalName: z.string().optional(),
  sectorName: z.string().optional(),
  assignedToName: z.string().optional(),
  statusName: z.string().optional(),
  remark: z.string().optional(),
})
const clean = (s?: string) => s?.trim() || ''

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = createSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message ?? 'Invalid lead data.' })
    return
  }
  const d = parse.data
  try {
    const location = clean(d.city) ? await foreLocation(clean(d.city)) : null
    const plant = await forePlant(clean(d.plantName), location?.id ?? null)
    const contact = clean(d.contactName) ? await foreContact(clean(d.contactName), plant.id, clean(d.contactEmail) || null, clean(d.contactNumber) || null) : null
    const vertical = clean(d.verticalName) ? await foreVertical(clean(d.verticalName)) : null
    const sector = clean(d.sectorName) ? await foreSector(clean(d.sectorName)) : null
    const assigned = clean(d.assignedToName) ? await foreUser(clean(d.assignedToName)) : null
    if (assigned?.role === 'admin') {
      res.status(400).json({ error: 'Leads cannot be assigned to an admin user.' })
      return
    }
    const status = await foreStatus(clean(d.statusName) || 'Submitted')

    const lead = await prisma.lead.create({
      data: {
        plantId: plant.id,
        contactId: contact?.id ?? null,
        verticalId: vertical?.id ?? null,
        sectorId: sector?.id ?? null,
        assignedToUserId: assigned?.id ?? null,
        assignedByUserId: assigned?.id ? req.userId! : null,
        statusId: status.id,
        remark: clean(d.remark) || null,
        createdByUserId: req.userId!,
      },
      include: leadInclude,
    })
    broadcastLeadUpdate(lead.id)
    if (lead.assignedToUserId && lead.assignedToUserId !== req.userId) {
      notifyUser(lead.assignedToUserId, `You've been assigned a new lead: ${lead.plant.plantName}`, lead.id)
        .catch(err => console.error('notifyUser failed:', err.message))
    }
    res.status(201).json({ lead })
  } catch {
    res.status(400).json({ error: 'Could not create lead.' })
  }
})

// PATCH /leads/:id — change status (by name), reassign, or edit the remark.
const updateSchema = z.object({
  statusName: z.string().optional(),
  assignedToUserId: z.string().nullable().optional(),
  remark: z.string().nullable().optional(),
})

router.patch('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = updateSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid update data.' })
    return
  }
  const existing = await prisma.lead.findFirst({ where: { id: String(req.params.id), deletedAt: null } })
  if (!existing) {
    res.status(404).json({ error: 'Lead not found.' })
    return
  }

  const data: { statusId?: string; assignedToUserId?: string | null; assignedByUserId?: string | null; remark?: string | null } = {}
  if (parse.data.statusName?.trim()) data.statusId = (await foreStatus(parse.data.statusName.trim())).id
  if ('assignedToUserId' in parse.data) {
    if (parse.data.assignedToUserId) {
      const target = await prisma.user.findUnique({ where: { id: parse.data.assignedToUserId }, select: { role: true } })
      if (target?.role === 'admin') {
        res.status(400).json({ error: 'Leads cannot be assigned to an admin user.' })
        return
      }
    }
    data.assignedToUserId = parse.data.assignedToUserId ?? null
    // Whoever performs the (re)assignment becomes "assigned by" — clearing the
    // assignee (unassigning) clears this too, since no one is assigning it anymore.
    data.assignedByUserId = data.assignedToUserId ? req.userId! : null
  }
  if ('remark' in parse.data) data.remark = parse.data.remark ?? null

  try {
    const lead = await prisma.lead.update({
      where: { id: existing.id },
      data, // updatedAt refreshes automatically (@updatedAt)
      include: leadInclude,
    })
    broadcastLeadUpdate(lead.id)
    if (
      data.assignedToUserId &&
      data.assignedToUserId !== existing.assignedToUserId &&
      data.assignedToUserId !== req.userId
    ) {
      notifyUser(data.assignedToUserId, `You've been assigned a lead: ${lead.plant.plantName}`, lead.id)
        .catch(err => console.error('notifyUser failed:', err.message))
    }
    res.json({ lead })
  } catch {
    res.status(400).json({ error: 'Could not update lead.' })
  }
})

// DELETE /leads/:id — soft delete (sets deleted_at; row is kept for audit).
// Admin-only: entries stay until an admin explicitly removes them.
router.delete('/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await prisma.lead.findFirst({ where: { id: String(req.params.id), deletedAt: null } })
  if (!existing) {
    res.status(404).json({ error: 'Lead not found.' })
    return
  }
  await prisma.lead.update({ where: { id: existing.id }, data: { deletedAt: new Date() } })
  broadcastLeadUpdate(existing.id)
  res.json({ message: 'Lead deleted.' })
})

export default router

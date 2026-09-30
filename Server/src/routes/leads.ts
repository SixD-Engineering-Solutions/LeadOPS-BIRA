import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../prisma'
import { authenticate, requireAdmin, AuthRequest } from '../middleware/authenticate'
import { notifyUser, broadcastLeadUpdate, broadcastProposalUpdate, broadcastProjectUpdate, broadcastInvoiceUpdate } from '../services/notify'
import { TX_OPTS } from '../utils/sequence'
import { isAdmin } from '../utils/access'
import { syncLeadToPipeline, syncTrackerBestEffort } from '../utils/pipelineSync'
import { sendError } from '../utils/errors'

const router = Router()
router.use(authenticate)

// Related data attached to every lead we return, with only display-relevant fields.
const leadInclude = {
  plant: { select: { id: true, plantName: true, companyName: true, plantCode: true, client: { select: { id: true, clientName: true } }, location: { select: { id: true, city: true, state: true, country: true, address: true } } } },
  vertical: { select: { id: true, verticalName: true } },
  sector: { select: { id: true, sectorName: true } },
  source: { select: { id: true, sourceName: true } },
  serviceType: { select: { id: true, serviceTypeName: true } },
  event: { select: { id: true, eventName: true } },
  contact: { select: { id: true, contactPersonName: true, designation: true, contactPersonNumber: true, alternateNumber: true, mailId: true, isPrimaryContact: true } },
  assignedToUser: { select: { id: true, userName: true, email: true } },
  assignedByUser: { select: { id: true, userName: true, email: true } },
  createdByUser: { select: { id: true, userName: true, email: true } },
  status: { select: { id: true, statusName: true, statusCategory: true } },
} as const

// Employees only see leads currently assigned to them — never another
// employee's leads, even ones they themselves created or handed off; admins
// see everything.
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
    sendError(res, 404, 'Lead not found.')
    return
  }
  res.json({ lead })
})

// ── find-or-create helpers (case-insensitive by name) ───────────────────────
const ci = (value: string) => ({ equals: value, mode: 'insensitive' as const })

async function foreLocation(city: string) {
  return (await prisma.location.findFirst({ where: { city: ci(city) } })) ?? prisma.location.create({ data: { city } })
}
async function foreClient(name: string) {
  return (await prisma.client.findFirst({ where: { clientName: ci(name) } })) ?? prisma.client.create({ data: { clientName: name } })
}
async function forePlant(name: string, locationId: string | null, clientId: string | null) {
  const found = await prisma.plant.findFirst({ where: { plantName: ci(name) } })
  if (found) {
    const data: { locationId?: string; clientId?: string } = {}
    if (locationId && !found.locationId) data.locationId = locationId
    if (clientId && !found.clientId) data.clientId = clientId
    return Object.keys(data).length ? prisma.plant.update({ where: { id: found.id }, data }) : found
  }
  return prisma.plant.create({ data: { plantName: name, locationId, clientId } })
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
async function foreSource(name: string) {
  return (await prisma.leadSource.findFirst({ where: { sourceName: ci(name) } })) ?? prisma.leadSource.create({ data: { sourceName: name } })
}
async function foreServiceType(name: string) {
  return (await prisma.serviceType.findFirst({ where: { serviceTypeName: ci(name) } })) ?? prisma.serviceType.create({ data: { serviceTypeName: name } })
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
  clientName: z.string().optional(),
  city: z.string().optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().email('Contact email must be a valid email address.').optional().or(z.literal('')),
  contactNumber: z.string().optional(),
  verticalName: z.string().optional(),
  sectorName: z.string().optional(),
  sourceName: z.string().optional(),
  serviceTypeName: z.string().optional(),
  eventId: z.string().optional(),
  assignedToName: z.string().optional(),
  statusName: z.string().optional(),
  remark: z.string().optional(),
  lostReason: z.string().optional(),
})
const clean = (s?: string) => s?.trim() || ''

// A lead marked Dead must say why — required on create and on every change
// to Dead, and cleared when the lead is revived.
const isDead = (statusName?: string | null) => clean(statusName ?? undefined).toLowerCase() === 'dead'
const LOST_REASON_REQUIRED = 'Give a reason why the lead was lost (at least 3 characters).'
const validReason = (r?: string | null) => clean(r ?? undefined).length >= 3

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = createSchema.safeParse(req.body)
  if (!parse.success) {
    sendError(res, 400, parse.error.issues[0]?.message ?? 'Invalid lead data.')
    return
  }
  const d = parse.data
  if (isDead(d.statusName) && !validReason(d.lostReason)) {
    sendError(res, 400, LOST_REASON_REQUIRED)
    return
  }
  try {
    const location = clean(d.city) ? await foreLocation(clean(d.city)) : null
    const client = clean(d.clientName) ? await foreClient(clean(d.clientName)) : null
    const plant = await forePlant(clean(d.plantName), location?.id ?? null, client?.id ?? null)
    const contact = clean(d.contactName) ? await foreContact(clean(d.contactName), plant.id, clean(d.contactEmail) || null, clean(d.contactNumber) || null) : null
    const vertical = clean(d.verticalName) ? await foreVertical(clean(d.verticalName)) : null
    const sector = clean(d.sectorName) ? await foreSector(clean(d.sectorName)) : null
    const source = clean(d.sourceName) ? await foreSource(clean(d.sourceName)) : null
    const serviceType = clean(d.serviceTypeName) ? await foreServiceType(clean(d.serviceTypeName)) : null
    const assigned = clean(d.assignedToName) ? await foreUser(clean(d.assignedToName)) : null
    if (assigned?.role === 'admin') {
      sendError(res, 400, 'Leads cannot be assigned to an admin user.')
      return
    }
    const status = await foreStatus(clean(d.statusName) || 'Submitted')

    const lead = await prisma.lead.create({
      data: {
        plantId: plant.id,
        contactId: contact?.id ?? null,
        verticalId: vertical?.id ?? null,
        sectorId: sector?.id ?? null,
        sourceId: source?.id ?? null,
        serviceTypeId: serviceType?.id ?? null,
        eventId: clean(d.eventId) || null,
        assignedToUserId: assigned?.id ?? null,
        assignedByUserId: assigned?.id ? req.userId! : null,
        statusId: status.id,
        remark: clean(d.remark) || null,
        lostReason: isDead(d.statusName) ? clean(d.lostReason) : null,
        createdByUserId: req.userId!,
      },
      include: leadInclude,
    })
    await syncTrackerBestEffort(() => syncLeadToPipeline(prisma, lead.id))
    broadcastLeadUpdate(lead.id)
    if (lead.assignedToUserId && lead.assignedToUserId !== req.userId) {
      notifyUser(lead.assignedToUserId, `You've been assigned a new lead: ${lead.plant.plantName}`, lead.id)
        .catch(err => console.error('notifyUser failed:', err.message))
    }
    res.status(201).json({ lead })
  } catch {
    sendError(res, 400, 'Could not create lead.')
  }
})

// PATCH /leads/:id — change status (by name), reassign, or edit the remark.
const updateSchema = z.object({
  statusName: z.string().optional(),
  assignedToUserId: z.string().nullable().optional(),
  remark: z.string().nullable().optional(),
  lostReason: z.string().optional(),
})

router.patch('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = updateSchema.safeParse(req.body)
  if (!parse.success) {
    sendError(res, 400, 'Invalid update data.')
    return
  }
  const existing = await prisma.lead.findFirst({ where: { id: String(req.params.id), deletedAt: null }, include: { status: { select: { statusName: true } } } })
  if (!existing) {
    sendError(res, 404, 'Lead not found.')
    return
  }

  const data: { statusId?: string; assignedToUserId?: string | null; assignedByUserId?: string | null; remark?: string | null; lostReason?: string | null } = {}
  if (parse.data.statusName?.trim()) {
    const toDead = isDead(parse.data.statusName)
    if (toDead && !isDead(existing.status?.statusName) && !validReason(parse.data.lostReason)) {
      sendError(res, 400, LOST_REASON_REQUIRED)
      return
    }
    data.statusId = (await foreStatus(parse.data.statusName.trim())).id
    if (toDead && validReason(parse.data.lostReason)) data.lostReason = clean(parse.data.lostReason)
    if (!toDead) data.lostReason = null
  } else if (parse.data.lostReason !== undefined && isDead(existing.status?.statusName)) {
    // Editing the reason on an already-dead lead — still can't be emptied.
    if (!validReason(parse.data.lostReason)) {
      sendError(res, 400, LOST_REASON_REQUIRED)
      return
    }
    data.lostReason = clean(parse.data.lostReason)
  }
  if ('assignedToUserId' in parse.data) {
    if (parse.data.assignedToUserId) {
      const target = await prisma.user.findUnique({ where: { id: parse.data.assignedToUserId }, select: { role: true } })
      if (target?.role === 'admin') {
        sendError(res, 400, 'Leads cannot be assigned to an admin user.')
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
    await syncTrackerBestEffort(() => syncLeadToPipeline(prisma, lead.id))
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
    sendError(res, 400, 'Could not update lead.')
  }
})

// DELETE /leads/:id — soft delete (sets deleted_at; row is kept for audit).
// Admin-only: entries stay until an admin explicitly removes them.
router.delete('/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await prisma.lead.findFirst({ where: { id: String(req.params.id), deletedAt: null } })
  if (!existing) {
    sendError(res, 404, 'Lead not found.')
    return
  }
  // Deleting a lead takes everything built on it down with it — proposals,
  // projects, invoices, payments, documents, its notifications and its
  // Tracker rows — so nothing tied to a deleted lead lingers in any section.
  // Soft delete like everywhere else (rows kept for audit, hidden from every
  // view), all in one transaction so it can't stop halfway. Activities have
  // no deletedAt; they're only ever reached through their lead, so they go
  // with it.
  const now = new Date()
  const removed = await prisma.$transaction(async tx => {
    const proposals = await tx.proposal.findMany({ where: { leadId: existing.id, deletedAt: null }, select: { id: true } })
    const projects = await tx.project.findMany({ where: { leadId: existing.id, deletedAt: null }, select: { id: true } })
    const projectIds = projects.map(p => p.id)
    const invoices = await tx.invoice.findMany({ where: { projectId: { in: projectIds }, deletedAt: null }, select: { id: true } })
    const invoiceIds = invoices.map(i => i.id)

    await tx.payment.updateMany({ where: { invoiceId: { in: invoiceIds }, deletedAt: null }, data: { deletedAt: now } })
    await tx.invoice.updateMany({ where: { id: { in: invoiceIds } }, data: { deletedAt: now } })
    await tx.project.updateMany({ where: { id: { in: projectIds } }, data: { deletedAt: now } })
    await tx.proposal.updateMany({ where: { leadId: existing.id, deletedAt: null }, data: { deletedAt: now } })
    await tx.document.updateMany({ where: { leadId: existing.id, deletedAt: null }, data: { deletedAt: now } })
    await tx.notification.deleteMany({ where: { leadId: existing.id } })
    await tx.invoiceRegisterItem.deleteMany({ where: { sourceInvoiceId: { in: invoiceIds } } })
    await tx.pipelineTrackerItem.deleteMany({ where: { sourceLeadId: existing.id } })
    await tx.lead.update({ where: { id: existing.id }, data: { deletedAt: now } })

    return { proposalIds: proposals.map(p => p.id), projectIds, invoiceIds }
  }, TX_OPTS)

  broadcastLeadUpdate(existing.id)
  removed.proposalIds.forEach(broadcastProposalUpdate)
  removed.projectIds.forEach(broadcastProjectUpdate)
  removed.invoiceIds.forEach(broadcastInvoiceUpdate)
  res.json({
    message: 'Lead deleted.',
    removed: { proposals: removed.proposalIds.length, projects: removed.projectIds.length, invoices: removed.invoiceIds.length },
  })
})

export default router

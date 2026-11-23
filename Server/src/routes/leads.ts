import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../prisma'
import { Prisma } from '../generated/prisma/client'
import { authenticate, requireAdmin, AuthRequest } from '../middleware/authenticate'
import { notifyUser, broadcastLeadUpdate, broadcastProposalUpdate, broadcastProjectUpdate, broadcastInvoiceUpdate } from '../services/notify'
import { TX_OPTS } from '../utils/sequence'
import { isAdmin } from '../utils/access'
import { syncLeadToPipeline, syncTrackerBestEffort } from '../utils/pipelineSync'
import { syncInvoiceToTracker } from '../utils/invoiceTrackerSync'
import { logActivity, leadSnapshot, leadLabel } from '../utils/auditLog'
import { sendError } from '../utils/errors'
import { findSameName } from '../utils/names'

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
  contact: { select: { id: true, contactPersonName: true, designation: true, department: true, contactPersonNumber: true, alternateNumber: true, mailId: true, isPrimaryContact: true } },
  // Further people contacted, beyond the primary one above.
  extraContacts: { orderBy: { createdAt: 'asc' as const }, select: { contact: { select: { id: true, contactPersonName: true, designation: true, department: true, contactPersonNumber: true, alternateNumber: true, mailId: true } } } },
  assignedToUser: { select: { id: true, userName: true, email: true } },
  assignedByUser: { select: { id: true, userName: true, email: true } },
  bmUser: { select: { id: true, userName: true, email: true } },
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

// A location is a city, optionally with its state. With a state: the same city
// in that state is reused; a same-named city that has no state yet gets the
// state filled in; otherwise (the same name in another state) a new one is made.
// Without a state: any city of that name is reused — unless `exact`, used when
// editing, where leaving the state blank means "no state" and must be honoured.
async function foreLocation(city: string, state = '', exact = false) {
  if (state) {
    const same = await prisma.location.findFirst({ where: { city: ci(city), state: ci(state) } })
    if (same) return same
    const noState = await prisma.location.findFirst({ where: { city: ci(city), state: null } })
    if (noState) return prisma.location.update({ where: { id: noState.id }, data: { state } })
    return prisma.location.create({ data: { city, state } })
  }
  const found = await prisma.location.findFirst({ where: { city: ci(city), ...(exact ? { state: null } : {}) } })
  return found ?? prisma.location.create({ data: { city } })
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
async function foreContact(name: string, plantId: string, email: string | null, phone: string | null, designation: string | null = null, department: string | null = null) {
  const existing = await prisma.contact.findFirst({ where: { plantId, contactPersonName: ci(name) } })
  if (existing) {
    const data: { mailId?: string; contactPersonNumber?: string; designation?: string; department?: string } = {}
    if (designation && !existing.designation) data.designation = designation
    if (department && !existing.department) data.department = department
    if (email && !existing.mailId) data.mailId = email
    if (phone && !existing.contactPersonNumber) data.contactPersonNumber = phone
    return Object.keys(data).length ? prisma.contact.update({ where: { id: existing.id }, data }) : existing
  }
  return prisma.contact.create({ data: { plantId, contactPersonName: name, designation, department, mailId: email, contactPersonNumber: phone } })
}
// Vertical / sector / source / service type: reuse an active one whose name is
// this one written any way ("Oil and Gas" = "Oil & Gas" = "oil & gas"), so a
// typed variant can't create a duplicate — and never a merged-away (inactive)
// one, so an old spelling can't pull a lead back onto a retired value.
async function foreVertical(name: string) {
  const rows = await prisma.vertical.findMany({ where: { isActive: true } })
  return findSameName(rows, r => r.verticalName, name) ?? prisma.vertical.create({ data: { verticalName: name } })
}
async function foreSector(name: string) {
  const rows = await prisma.sector.findMany({ where: { isActive: true } })
  return findSameName(rows, r => r.sectorName, name) ?? prisma.sector.create({ data: { sectorName: name } })
}
async function foreSource(name: string) {
  const rows = await prisma.leadSource.findMany({ where: { isActive: true } })
  return findSameName(rows, r => r.sourceName, name) ?? prisma.leadSource.create({ data: { sourceName: name } })
}
async function foreServiceType(name: string) {
  const rows = await prisma.serviceType.findMany({ where: { isActive: true } })
  return findSameName(rows, r => r.serviceTypeName, name) ?? prisma.serviceType.create({ data: { serviceTypeName: name } })
}
const STATUS_CATEGORY: Record<string, string> = { 'cold call': 'Open', warm: 'Open', hot: 'Open', qualified: 'Open', 'follow-up': 'In Progress', lost: 'Closed Lost' }
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

// The branch manager must be one of our own active users — never a made-up
// name — so it's picked by id, unlike the find-or-create fields above.
async function activeUser(id: string) {
  return prisma.user.findFirst({ where: { id, isActive: true }, select: { id: true } })
}
const BM_INVALID = 'BM (business manager) must be an active team member.'
const BM_REQUIRED = 'Choose the BM (business manager).'
const ASSIGNEE_REQUIRED = 'Choose who this lead is assigned to.'

// POST /leads — accepts typed names; reuses or creates the linked records.
const createSchema = z.object({
  plantName: z.string().min(1, 'Plant is required.'),
  clientName: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  contactName: z.string().optional(),
  contactDesignation: z.string().optional(),
  contactDepartment: z.string().optional(),
  contactEmail: z.string().email('Contact email must be a valid email address.').optional().or(z.literal('')),
  contactNumber: z.string().optional(),
  // More people contacted at the same plant — each needs a name.
  extraContacts: z.array(z.object({
    name: z.string(),
    designation: z.string().optional(),
    department: z.string().optional(),
    email: z.string().email('Contact email must be a valid email address.').optional().or(z.literal('')),
    phone: z.string().optional(),
  })).max(10, 'At most 10 additional contacts.').optional(),
  verticalName: z.string().optional(),
  sectorName: z.string().optional(),
  sourceName: z.string().optional(),
  serviceTypeName: z.string().optional(),
  bmUserId: z.string().optional(),
  assignedToName: z.string().optional(),
  statusName: z.string().optional(),
  remark: z.string().optional(),
  lostReason: z.string().optional(),
})
const clean = (s?: string) => s?.trim() || ''

// A lead marked Lost must say why — required on create and on every change
// to Lost, and cleared when the lead is revived.
const isDead = (statusName?: string | null) => clean(statusName ?? undefined).toLowerCase() === 'lost'
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
  if (clean(d.state) && !clean(d.city)) {
    sendError(res, 400, 'Enter the city along with the state.')
    return
  }
  const extras = (d.extraContacts ?? []).filter(c => clean(c.name) || clean(c.email) || clean(c.phone))
  if (extras.some(c => !clean(c.name))) {
    sendError(res, 400, 'Enter a name for every additional contact.')
    return
  }
  if (!clean(d.bmUserId)) {
    sendError(res, 400, BM_REQUIRED)
    return
  }
  if (!clean(d.assignedToName)) {
    sendError(res, 400, ASSIGNEE_REQUIRED)
    return
  }
  const bm = await activeUser(clean(d.bmUserId))
  if (!bm) {
    sendError(res, 400, BM_INVALID)
    return
  }
  try {
    const location = clean(d.city) ? await foreLocation(clean(d.city), clean(d.state)) : null
    const client = clean(d.clientName) ? await foreClient(clean(d.clientName)) : null
    const plant = await forePlant(clean(d.plantName), location?.id ?? null, client?.id ?? null)
    const contact = clean(d.contactName) ? await foreContact(clean(d.contactName), plant.id, clean(d.contactEmail) || null, clean(d.contactNumber) || null, clean(d.contactDesignation) || null, clean(d.contactDepartment) || null) : null
    // Each extra person is found-or-created like the primary; the same person
    // listed twice (or also as the primary) is only linked once.
    const extraIds = new Set<string>()
    for (const c of extras) {
      const person = await foreContact(clean(c.name), plant.id, clean(c.email) || null, clean(c.phone) || null, clean(c.designation) || null, clean(c.department) || null)
      if (person.id !== contact?.id) extraIds.add(person.id)
    }
    const vertical = clean(d.verticalName) ? await foreVertical(clean(d.verticalName)) : null
    const sector = clean(d.sectorName) ? await foreSector(clean(d.sectorName)) : null
    const source = clean(d.sourceName) ? await foreSource(clean(d.sourceName)) : null
    const serviceType = clean(d.serviceTypeName) ? await foreServiceType(clean(d.serviceTypeName)) : null
    const assigned = clean(d.assignedToName) ? await foreUser(clean(d.assignedToName)) : null
    if (assigned?.role === 'admin') {
      sendError(res, 400, 'Leads cannot be assigned to an admin user.')
      return
    }
    const status = await foreStatus(clean(d.statusName) || 'Cold call')

    const lead = await prisma.lead.create({
      data: {
        plantId: plant.id,
        contactId: contact?.id ?? null,
        extraContacts: { create: [...extraIds].map(contactId => ({ contactId })) },
        verticalId: vertical?.id ?? null,
        sectorId: sector?.id ?? null,
        sourceId: source?.id ?? null,
        serviceTypeId: serviceType?.id ?? null,
        bmUserId: bm?.id ?? null,
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
    await logActivity({ userId: req.userId, entity: 'lead', entityId: lead.id, label: leadLabel(lead), leadId: lead.id, action: 'created', after: leadSnapshot(lead) })
    res.status(201).json({ lead })
  } catch {
    sendError(res, 400, 'Could not create lead.')
  }
})

// PATCH /leads/:id — change status (by name), reassign, set the branch
// manager, or edit the remark.
// The descriptive fields (plant, client, city, contact, classification) can be
// corrected too — by an admin or by the employee the lead is assigned to — so
// a mistyped value doesn't need an admin to fix. A field that is sent replaces
// the old value (blank clears it, except the plant); one that is left out stays.
const updateSchema = z.object({
  statusName: z.string().optional(),
  assignedToUserId: z.string().nullable().optional(),
  bmUserId: z.string().nullable().optional(),
  remark: z.string().nullable().optional(),
  lostReason: z.string().optional(),
  plantName: z.string().optional(),
  clientName: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  contactName: z.string().optional(),
  contactDesignation: z.string().optional(),
  contactDepartment: z.string().optional(),
  contactEmail: z.string().email('Contact email must be a valid email address.').optional().or(z.literal('')),
  contactNumber: z.string().optional(),
  extraContacts: z.array(z.object({
    name: z.string(),
    designation: z.string().optional(),
    department: z.string().optional(),
    email: z.string().email('Contact email must be a valid email address.').optional().or(z.literal('')),
    phone: z.string().optional(),
  })).max(10, 'At most 10 additional contacts.').optional(),
  verticalName: z.string().optional(),
  sectorName: z.string().optional(),
  sourceName: z.string().optional(),
  serviceTypeName: z.string().optional(),
})
type LeadUpdate = z.infer<typeof updateSchema>

// Applies the descriptive-field edits onto `data`. Plants, contacts and the
// lookups are shared records, so they're re-pointed (found or created by name)
// rather than renamed under other leads; correcting the *same* plant's client
// or city, or the same contact's email/phone/designation/department, updates that record.
// Returns an error message, or null.
async function applyDetailEdits(existing: { plantId: string; contactId: string | null }, d: LeadUpdate, data: Prisma.LeadUncheckedUpdateInput): Promise<string | null> {
  if (d.plantName !== undefined && !clean(d.plantName)) return 'Plant is required.'
  const extras = d.extraContacts?.filter(c => clean(c.name) || clean(c.email) || clean(c.phone))
  if (extras?.some(c => !clean(c.name))) return 'Enter a name for every additional contact.'

  let plant = await prisma.plant.findUniqueOrThrow({ where: { id: existing.plantId } })
  const clientId = d.clientName === undefined ? undefined : clean(d.clientName) ? (await foreClient(clean(d.clientName))).id : null
  // City and state are edited together; whichever isn't sent keeps its current value.
  let locationId: string | null | undefined
  if (d.city !== undefined || d.state !== undefined) {
    const currentLocation = plant.locationId ? await prisma.location.findUnique({ where: { id: plant.locationId } }) : null
    const city = d.city !== undefined ? clean(d.city) : currentLocation?.city ?? ''
    const state = d.state !== undefined ? clean(d.state) : currentLocation?.state ?? ''
    if (state && !city) return 'Enter the city along with the state.'
    locationId = city ? (await foreLocation(city, state, true)).id : null
  }
  const newName = d.plantName === undefined ? undefined : clean(d.plantName)
  if (newName !== undefined && newName.toLowerCase() !== plant.plantName.toLowerCase()) {
    plant = await forePlant(newName, locationId ?? null, clientId ?? null)
  } else {
    const patch = {
      ...(newName !== undefined && newName !== plant.plantName && { plantName: newName }), // fixing the spelling/case
      ...(clientId !== undefined && clientId !== plant.clientId && { clientId }),
      ...(locationId !== undefined && locationId !== plant.locationId && { locationId }),
    }
    if (Object.keys(patch).length) plant = await prisma.plant.update({ where: { id: plant.id }, data: patch })
  }
  if (plant.id !== existing.plantId) data.plantId = plant.id

  const contactFields = d.contactName !== undefined || d.contactDesignation !== undefined || d.contactDepartment !== undefined || d.contactEmail !== undefined || d.contactNumber !== undefined
  let primaryId = existing.contactId
  if (contactFields) {
    const current = existing.contactId ? await prisma.contact.findUnique({ where: { id: existing.contactId } }) : null
    const name = d.contactName !== undefined ? clean(d.contactName) : current?.contactPersonName ?? ''
    if (!name) {
      primaryId = null
    } else if (current && current.plantId === plant.id && current.contactPersonName.toLowerCase() === name.toLowerCase()) {
      const patch = {
        ...(name !== current.contactPersonName && { contactPersonName: name }),
        ...(d.contactDesignation !== undefined && { designation: clean(d.contactDesignation) || null }),
        ...(d.contactDepartment !== undefined && { department: clean(d.contactDepartment) || null }),
        ...(d.contactEmail !== undefined && { mailId: clean(d.contactEmail) || null }),
        ...(d.contactNumber !== undefined && { contactPersonNumber: clean(d.contactNumber) || null }),
      }
      if (Object.keys(patch).length) await prisma.contact.update({ where: { id: current.id }, data: patch })
    } else {
      const person = await foreContact(name, plant.id, clean(d.contactEmail) || null, clean(d.contactNumber) || null, clean(d.contactDesignation) || null, clean(d.contactDepartment) || null)
      primaryId = person.id
    }
    data.contactId = primaryId
  }

  if (extras) {
    const ids = new Set<string>()
    for (const c of extras) {
      const person = await foreContact(clean(c.name), plant.id, clean(c.email) || null, clean(c.phone) || null, clean(c.designation) || null, clean(c.department) || null)
      if (person.id !== primaryId) ids.add(person.id)
    }
    data.extraContacts = { deleteMany: {}, create: [...ids].map(contactId => ({ contactId })) }
  }

  if (d.verticalName !== undefined) data.verticalId = clean(d.verticalName) ? (await foreVertical(clean(d.verticalName))).id : null
  if (d.sectorName !== undefined) data.sectorId = clean(d.sectorName) ? (await foreSector(clean(d.sectorName))).id : null
  if (d.sourceName !== undefined) data.sourceId = clean(d.sourceName) ? (await foreSource(clean(d.sourceName))).id : null
  if (d.serviceTypeName !== undefined) data.serviceTypeId = clean(d.serviceTypeName) ? (await foreServiceType(clean(d.serviceTypeName))).id : null
  return null
}

router.patch('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = updateSchema.safeParse(req.body)
  if (!parse.success) {
    sendError(res, 400, parse.error.issues[0]?.message ?? 'Invalid update data.')
    return
  }
  // Same visibility rule as GET: an employee can only change (or hand off)
  // a lead that's currently assigned to them; admins can change any.
  const admin = await isAdmin(req.userId)
  const existing = await prisma.lead.findFirst({
    where: { id: String(req.params.id), deletedAt: null, ...(admin ? {} : visibilityFilter(req.userId)) },
    include: { status: { select: { statusName: true } } },
  })
  if (!existing) {
    sendError(res, 404, 'Lead not found.')
    return
  }

  const data: Prisma.LeadUncheckedUpdateInput = {}
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
    // Editing the reason on an already-lost lead — still can't be emptied.
    if (!validReason(parse.data.lostReason)) {
      sendError(res, 400, LOST_REASON_REQUIRED)
      return
    }
    data.lostReason = clean(parse.data.lostReason)
  }
  if ('assignedToUserId' in parse.data) {
    if (!parse.data.assignedToUserId) {
      sendError(res, 400, ASSIGNEE_REQUIRED)
      return
    }
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
  if ('bmUserId' in parse.data) {
    if (!parse.data.bmUserId) {
      sendError(res, 400, BM_REQUIRED)
      return
    }
    if (!(await activeUser(parse.data.bmUserId))) {
      sendError(res, 400, BM_INVALID)
      return
    }
    data.bmUserId = parse.data.bmUserId || null
  }
  if ('remark' in parse.data) data.remark = parse.data.remark ?? null

  try {
    const detailError = await applyDetailEdits(existing, parse.data, data)
    if (detailError) {
      sendError(res, 400, detailError)
      return
    }
    // As it was, for the Activity log's before → after.
    const before = await prisma.lead.findUnique({ where: { id: existing.id }, include: leadInclude })
    const lead = await prisma.lead.update({
      where: { id: existing.id },
      data, // updatedAt refreshes automatically (@updatedAt)
      include: leadInclude,
    })
    const from = before ? leadSnapshot(before)['Assigned to'] : null
    const to = leadSnapshot(lead)['Assigned to']
    const summary = from !== to ? (to ? (from ? `Reassigned: ${from} → ${to}` : `Assigned to ${to}`) : `Unassigned (was ${from})`) : undefined
    await logActivity({ userId: req.userId, entity: 'lead', entityId: lead.id, label: leadLabel(lead), leadId: lead.id, action: 'updated', before: before ? leadSnapshot(before) : null, after: leadSnapshot(lead), summary })
    await syncTrackerBestEffort(() => syncLeadToPipeline(prisma, lead.id))
    broadcastLeadUpdate(lead.id)
    const newAssignee = typeof data.assignedToUserId === 'string' ? data.assignedToUserId : null
    if (
      newAssignee &&
      newAssignee !== existing.assignedToUserId &&
      newAssignee !== req.userId
    ) {
      notifyUser(newAssignee, `You've been assigned a lead: ${lead.plant.plantName}`, lead.id)
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
  const existing = await prisma.lead.findFirst({ where: { id: String(req.params.id), deletedAt: null }, include: leadInclude })
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
    await tx.pipelineTrackerItem.deleteMany({ where: { sourceLeadId: existing.id } })
    await tx.lead.update({ where: { id: existing.id }, data: { deletedAt: now } })

    return { proposalIds: proposals.map(p => p.id), projectIds, invoiceIds }
  }, TX_OPTS)

  // Takes each invoice back out of the Tracker: its Invoice Register row and
  // its amount in the sector summary (FY totals, the dashboard's target card,
  // the invoicing charts) — the same as deleting the invoice on its own.
  for (const id of removed.invoiceIds) await syncTrackerBestEffort(() => syncInvoiceToTracker(prisma, id))

  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
  const along = [plural(removed.proposalIds.length, 'proposal'), plural(removed.projectIds.length, 'project'), plural(removed.invoiceIds.length, 'invoice')]
  await logActivity({
    userId: req.userId, entity: 'lead', entityId: existing.id, label: leadLabel(existing), leadId: existing.id, action: 'deleted',
    summary: removed.proposalIds.length + removed.projectIds.length + removed.invoiceIds.length ? `Removed with ${along.join(', ')}` : undefined,
  })

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

import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../prisma'
import { authenticate, requireAdmin, AuthRequest } from '../middleware/authenticate'
import { isAdmin } from '../utils/access'
import { sendError } from '../utils/errors'
import { TX_OPTS } from '../utils/sequence'
import { syncLeadToPipeline, syncTrackerBestEffort } from '../utils/pipelineSync'
import { broadcastLeadUpdate } from '../services/notify'

// List + create endpoints for the supporting tables (locations, plants,
// contacts, verticals, sectors, lead statuses, users). All require auth;
// every write (create/update) is admin-only — these are shared reference
// data, edited from the admin-only Catalog page, not by regular employees.
const router = Router()
router.use(authenticate)

const bad = (res: Response, msg: string) => sendError(res, 400, msg)

// ─── Locations ──────────────────────────────────────────────────────────────
router.get('/locations', async (_req, res) => {
  res.json({ locations: await prisma.location.findMany({ orderBy: { city: 'asc' } }) })
})
const locationSchema = z.object({ city: z.string().min(1), state: z.string().optional(), country: z.string().optional(), address: z.string().optional() })
router.post('/locations', requireAdmin, async (req, res) => {
  const p = locationSchema.safeParse(req.body)
  if (!p.success) return void bad(res, 'city is required.')
  res.status(201).json({ location: await prisma.location.create({ data: p.data }) })
})

// ─── Client categories ──────────────────────────────────────────────────────
router.get('/client-categories', async (_req, res) => {
  res.json({ clientCategories: await prisma.clientCategory.findMany({ where: { isActive: true }, orderBy: { categoryName: 'asc' } }) })
})
const clientCategorySchema = z.object({ categoryName: z.string().min(1), description: z.string().optional() })
router.post('/client-categories', requireAdmin, async (req, res) => {
  const p = clientCategorySchema.safeParse(req.body)
  if (!p.success) return void bad(res, 'categoryName is required.')
  res.status(201).json({ clientCategory: await prisma.clientCategory.create({ data: p.data }) })
})

// ─── Clients ────────────────────────────────────────────────────────────────
router.get('/clients', async (_req, res) => {
  res.json({ clients: await prisma.client.findMany({ where: { isActive: true }, include: { category: { select: { id: true, categoryName: true } } }, orderBy: { clientName: 'asc' } }) })
})
const clientSchema = z.object({ clientName: z.string().min(1), industryType: z.string().optional(), website: z.string().optional(), linkedIn: z.string().optional(), categoryId: z.string().optional(), country: z.string().optional(), region: z.string().optional() })
router.post('/clients', requireAdmin, async (req, res) => {
  const p = clientSchema.safeParse(req.body)
  if (!p.success) return void bad(res, 'clientName is required.')
  res.status(201).json({ client: await prisma.client.create({ data: p.data }) })
})
const clientUpdateSchema = clientSchema.partial()
router.patch('/clients/:id', requireAdmin, async (req, res) => {
  const p = clientUpdateSchema.safeParse(req.body)
  if (!p.success) return void bad(res, 'Invalid client data.')
  try {
    res.json({ client: await prisma.client.update({ where: { id: String(req.params.id) }, data: p.data }) })
  } catch { bad(res, 'Client not found.') }
})

// ─── Lead sources ───────────────────────────────────────────────────────────
router.get('/lead-sources', async (_req, res) => {
  res.json({ leadSources: await prisma.leadSource.findMany({ where: { isActive: true }, orderBy: { sourceName: 'asc' } }) })
})
const leadSourceSchema = z.object({ sourceName: z.string().min(1), description: z.string().optional() })
router.post('/lead-sources', requireAdmin, async (req, res) => {
  const p = leadSourceSchema.safeParse(req.body)
  if (!p.success) return void bad(res, 'sourceName is required.')
  res.status(201).json({ leadSource: await prisma.leadSource.create({ data: p.data }) })
})

// ─── Service types ──────────────────────────────────────────────────────────
router.get('/service-types', async (_req, res) => {
  res.json({ serviceTypes: await prisma.serviceType.findMany({ where: { isActive: true }, orderBy: { serviceTypeName: 'asc' } }) })
})
const serviceTypeSchema = z.object({ serviceTypeName: z.string().min(1), description: z.string().optional() })
router.post('/service-types', requireAdmin, async (req, res) => {
  const p = serviceTypeSchema.safeParse(req.body)
  if (!p.success) return void bad(res, 'serviceTypeName is required.')
  res.status(201).json({ serviceType: await prisma.serviceType.create({ data: p.data }) })
})

// ─── Plants ─────────────────────────────────────────────────────────────────
router.get('/plants', async (_req, res) => {
  res.json({ plants: await prisma.plant.findMany({ include: { location: { select: { id: true, city: true, state: true } }, client: { select: { id: true, clientName: true } } }, orderBy: { plantName: 'asc' } }) })
})
const plantSchema = z.object({ plantName: z.string().min(1), companyName: z.string().optional(), clientId: z.string().optional(), locationId: z.string().min(1), plantCode: z.string().optional(), isActive: z.boolean().optional() })
router.post('/plants', requireAdmin, async (req, res) => {
  const p = plantSchema.safeParse(req.body)
  if (!p.success) return void bad(res, 'plantName and locationId are required.')
  try {
    res.status(201).json({ plant: await prisma.plant.create({ data: p.data }) })
  } catch { bad(res, 'Could not create plant. Does the location exist?') }
})

// ─── Contacts (optionally filtered by ?plantId=) ─────────────────────────────
router.get('/contacts', async (req, res) => {
  const plantId = req.query.plantId ? String(req.query.plantId) : undefined
  res.json({ contacts: await prisma.contact.findMany({ where: plantId ? { plantId } : undefined, orderBy: { contactPersonName: 'asc' } }) })
})
const contactSchema = z.object({
  plantId: z.string().min(1),
  contactPersonName: z.string().min(1),
  designation: z.string().optional(),
  contactPersonNumber: z.string().optional(),
  alternateNumber: z.string().optional(),
  mailId: z.string().email().optional().or(z.literal('')),
  isPrimaryContact: z.boolean().optional(),
})
router.post('/contacts', requireAdmin, async (req, res) => {
  const p = contactSchema.safeParse(req.body)
  if (!p.success) return void bad(res, 'plantId and contactPersonName are required.')
  try {
    res.status(201).json({ contact: await prisma.contact.create({ data: { ...p.data, mailId: p.data.mailId || null } } as never) })
  } catch { bad(res, 'Could not create contact. Does the plant exist?') }
})

// ─── Verticals ──────────────────────────────────────────────────────────────
router.get('/verticals', async (_req, res) => {
  res.json({ verticals: await prisma.vertical.findMany({ where: { isActive: true }, orderBy: { verticalName: 'asc' } }) })
})
const verticalSchema = z.object({ verticalName: z.string().min(1), description: z.string().optional() })
router.post('/verticals', requireAdmin, async (req, res) => {
  const p = verticalSchema.safeParse(req.body)
  if (!p.success) return void bad(res, 'verticalName is required.')
  res.status(201).json({ vertical: await prisma.vertical.create({ data: p.data }) })
})

// ─── Sectors ────────────────────────────────────────────────────────────────
router.get('/sectors', async (_req, res) => {
  res.json({ sectors: await prisma.sector.findMany({ where: { isActive: true }, orderBy: { sectorName: 'asc' } }) })
})
const sectorSchema = z.object({ sectorName: z.string().min(1), description: z.string().optional() })
router.post('/sectors', requireAdmin, async (req, res) => {
  const p = sectorSchema.safeParse(req.body)
  if (!p.success) return void bad(res, 'sectorName is required.')
  res.status(201).json({ sector: await prisma.sector.create({ data: p.data }) })
})

// ─── Lead statuses ──────────────────────────────────────────────────────────
router.get('/lead-statuses', async (_req, res) => {
  res.json({ leadStatuses: await prisma.leadStatus.findMany({ where: { isActive: true }, orderBy: { displayOrder: 'asc' } }) })
})
const statusSchema = z.object({ statusName: z.string().min(1), statusCategory: z.string().optional(), displayOrder: z.number().int().optional() })
router.post('/lead-statuses', requireAdmin, async (req, res) => {
  const p = statusSchema.safeParse(req.body)
  if (!p.success) return void bad(res, 'statusName is required.')
  res.status(201).json({ leadStatus: await prisma.leadStatus.create({ data: p.data }) })
})

// ─── Users (internal employees — for assignment dropdowns) ───────────────────

// GET /users — everyone needs the active roster for assignment dropdowns.
// ?includeInactive=true additionally returns removed accounts, but only for
// admins (that's who's allowed to see/reactivate them) — a non-admin passing
// the param is silently given the normal active-only list instead of an error,
// since this is an additive view, not a distinct resource.
router.get('/users', async (req: AuthRequest, res) => {
  const wantsInactive = req.query.includeInactive === 'true' && (await isAdmin(req.userId))
  const users = await prisma.user.findMany({
    where: wantsInactive ? {} : { isActive: true },
    select: { id: true, userName: true, email: true, role: true, department: true, phoneNumber: true, isActive: true },
    orderBy: { email: 'asc' },
  })
  res.json({ users })
})
const userSchema = z.object({
  userName: z.string().optional(),
  email: z.string().email(),
  phoneNumber: z.string().optional(),
  role: z.enum(['admin', 'employee']).optional(),
  department: z.string().optional(),
})
// POST /users — admin-only: creates an employee (or another admin) account.
router.post('/users', requireAdmin, async (req, res) => {
  const p = userSchema.safeParse(req.body)
  if (!p.success) return void bad(res, 'A valid email is required.')
  try {
    const user = await prisma.user.create({ data: p.data })
    res.status(201).json({ user: { id: user.id, userName: user.userName, email: user.email, role: user.role, department: user.department, phoneNumber: user.phoneNumber, isActive: user.isActive } })
  } catch { bad(res, 'Could not create user. Email may already exist.') }
})

// POST /users/:id/reactivate — admin-only. Reverses the DELETE below (isActive:
// true again); only meaningful for an account that's currently deactivated.
router.post('/users/:id/reactivate', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = String(req.params.id)
  const existing = await prisma.user.findUnique({ where: { id }, select: { isActive: true } })
  if (!existing || existing.isActive) {
    sendError(res, 404, 'No removed employee found with that id.')
    return
  }
  const user = await prisma.user.update({
    where: { id },
    data: { isActive: true },
    select: { id: true, userName: true, email: true, role: true, department: true, phoneNumber: true, isActive: true },
  })
  res.json({ user })
})

// PATCH /users/:id/role — admin-only. Two levels: "admin" (everything) and
// "employee" (their own assigned work). Every permission check in the API
// reads the role from the database on each request, so the change applies to
// the user's very next request — no other code needs to know about it.
//
// Kept consistent with the rule that admins are never assignees (leads, tasks
// and project engineers are employees only):
//   • promoting unassigns the user's leads — a lead can be unassigned, and
//     admins see every lead anyway; they show as "Unassigned" to hand back out;
//   • promoting is refused while they hold open tasks or are engineer on an
//     active project — both must always have an (employee) owner, so those are
//     handed over first.
// Nobody can change their own role, and the last active admin can't be
// demoted — so the app can never be left without an admin.
router.patch('/users/:id/role', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = z.object({ role: z.enum(['admin', 'employee']) }).safeParse(req.body)
  if (!parse.success) {
    sendError(res, 400, 'Role must be "admin" or "employee".')
    return
  }
  const { role } = parse.data
  const id = String(req.params.id)
  if (id === req.userId) {
    sendError(res, 400, 'You cannot change your own role.')
    return
  }
  const target = await prisma.user.findUnique({ where: { id }, select: { isActive: true, role: true, email: true, userName: true } })
  if (!target || !target.isActive) {
    sendError(res, 404, 'Employee not found.')
    return
  }
  if (target.role === role) {
    sendError(res, 409, `${target.userName || target.email} is already ${role === 'admin' ? 'an admin' : 'an employee'}.`)
    return
  }

  try {
    const result = await prisma.$transaction(async tx => {
      if (role === 'employee') {
        const otherAdmins = await tx.user.count({ where: { role: 'admin', isActive: true, id: { not: id } } })
        if (otherAdmins === 0) throw new RoleChangeRefused(409, 'There must always be at least one admin.')
        return { user: await tx.user.update({ where: { id }, data: { role }, select: userSelect }), unassignedLeadIds: [] as string[] }
      }
      const [openTasks, activeProjects] = await Promise.all([
        tx.task.count({ where: { assignedToUserId: id, deletedAt: null, status: { not: 'Done' } } }),
        tx.project.count({ where: { responsibleUserId: id, deletedAt: null, status: { not: 'Completed' } } }),
      ])
      if (openTasks || activeProjects) {
        const held = [openTasks && `${openTasks} open task${openTasks === 1 ? '' : 's'}`, activeProjects && `engineer on ${activeProjects} active project${activeProjects === 1 ? '' : 's'}`].filter(Boolean).join(' and ')
        throw new RoleChangeRefused(409, `Hand over their work first — they have ${held}. Admins can't be assigned tasks or projects.`)
      }
      const leads = await tx.lead.findMany({ where: { assignedToUserId: id, deletedAt: null }, select: { id: true } })
      if (leads.length) {
        await tx.lead.updateMany({ where: { id: { in: leads.map(l => l.id) } }, data: { assignedToUserId: null, assignedByUserId: null } })
      }
      return { user: await tx.user.update({ where: { id }, data: { role }, select: userSelect }), unassignedLeadIds: leads.map(l => l.id) }
    }, TX_OPTS)

    // After the transaction: refresh the Tracker's owner column and tell open
    // screens the leads changed.
    for (const leadId of result.unassignedLeadIds) {
      await syncTrackerBestEffort(() => syncLeadToPipeline(prisma, leadId))
      broadcastLeadUpdate(leadId)
    }
    res.json({ user: result.user, unassignedLeads: result.unassignedLeadIds.length })
  } catch (err) {
    if (err instanceof RoleChangeRefused) {
      sendError(res, err.status, err.message)
      return
    }
    sendError(res, 400, 'Could not change the role.')
  }
})

const userSelect = { id: true, userName: true, email: true, role: true, department: true, phoneNumber: true, isActive: true } as const

// PATCH /users/:id/email — admin-only, including an admin's own address.
// Mainly for moving people onto their company Microsoft email: "Sign in with
// Microsoft" finds them by this address the first time. Changing it unlinks
// any Microsoft account already tied to them, so the next Microsoft sign-in
// has to come from the new address.
router.patch('/users/:id/email', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = z.object({ email: z.string().trim().email() }).safeParse(req.body)
  if (!parse.success) {
    sendError(res, 400, 'Enter a valid email address.')
    return
  }
  const email = parse.data.email.toLowerCase()
  const id = String(req.params.id)
  const target = await prisma.user.findUnique({ where: { id }, select: { isActive: true, email: true } })
  if (!target || !target.isActive) {
    sendError(res, 404, 'Employee not found.')
    return
  }
  if (target.email.toLowerCase() === email) {
    sendError(res, 409, 'That is already their email.')
    return
  }
  const taken = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, id: { not: id } }, select: { id: true } })
  if (taken) {
    sendError(res, 409, 'Another account already uses that email.')
    return
  }

  const user = await prisma.user.update({ where: { id }, data: { email, microsoftOid: null }, select: userSelect })

  // The Tracker shows people by name, falling back to email — refresh the
  // rows of leads they own or manage.
  const leads = await prisma.lead.findMany({
    where: { deletedAt: null, OR: [{ assignedToUserId: id }, { bmUserId: id }] },
    select: { id: true },
  })
  for (const lead of leads) {
    await syncTrackerBestEffort(() => syncLeadToPipeline(prisma, lead.id))
    broadcastLeadUpdate(lead.id)
  }
  res.json({ user })
})

class RoleChangeRefused extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

// DELETE /users/:id — admin-only. Soft delete (isActive: false), same pattern
// as leads: the row (and their lead history — createdBy/assignedTo/assignedBy
// references) stays intact, they just disappear from the team list and
// assignment dropdowns, and can no longer log in.
router.delete('/users/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = String(req.params.id)
  if (id === req.userId) {
    sendError(res, 400, 'You cannot delete your own account.')
    return
  }
  const existing = await prisma.user.findUnique({ where: { id }, select: { isActive: true, role: true } })
  if (!existing || !existing.isActive) {
    sendError(res, 404, 'Employee not found.')
    return
  }
  // Backstop for "never zero admins" (the caller is an admin and can't remove
  // themselves, so in practice another admin always remains).
  if (existing.role === 'admin') {
    const otherAdmins = await prisma.user.count({ where: { role: 'admin', isActive: true, id: { not: id } } })
    if (otherAdmins === 0) {
      sendError(res, 409, 'There must always be at least one admin.')
      return
    }
  }
  await prisma.user.update({ where: { id }, data: { isActive: false } })
  res.json({ message: 'Employee removed.' })
})

export default router

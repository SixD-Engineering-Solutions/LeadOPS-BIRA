import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../prisma'
import { authenticate, requireAdmin, AuthRequest } from '../middleware/authenticate'

// List + create endpoints for the supporting tables (locations, plants,
// contacts, verticals, sectors, lead statuses, users). All require auth.
const router = Router()
router.use(authenticate)

const bad = (res: Response, msg: string) => res.status(400).json({ error: msg })

// ─── Locations ──────────────────────────────────────────────────────────────
router.get('/locations', async (_req, res) => {
  res.json({ locations: await prisma.location.findMany({ orderBy: { city: 'asc' } }) })
})
const locationSchema = z.object({ city: z.string().min(1), state: z.string().optional(), country: z.string().optional(), address: z.string().optional() })
router.post('/locations', async (req, res) => {
  const p = locationSchema.safeParse(req.body)
  if (!p.success) return void bad(res, 'city is required.')
  res.status(201).json({ location: await prisma.location.create({ data: p.data }) })
})

// ─── Plants ─────────────────────────────────────────────────────────────────
router.get('/plants', async (_req, res) => {
  res.json({ plants: await prisma.plant.findMany({ include: { location: { select: { id: true, city: true, state: true } } }, orderBy: { plantName: 'asc' } }) })
})
const plantSchema = z.object({ plantName: z.string().min(1), companyName: z.string().optional(), locationId: z.string().min(1), plantCode: z.string().optional(), isActive: z.boolean().optional() })
router.post('/plants', async (req, res) => {
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
router.post('/contacts', async (req, res) => {
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
router.post('/verticals', async (req, res) => {
  const p = verticalSchema.safeParse(req.body)
  if (!p.success) return void bad(res, 'verticalName is required.')
  res.status(201).json({ vertical: await prisma.vertical.create({ data: p.data }) })
})

// ─── Sectors ────────────────────────────────────────────────────────────────
router.get('/sectors', async (_req, res) => {
  res.json({ sectors: await prisma.sector.findMany({ where: { isActive: true }, orderBy: { sectorName: 'asc' } }) })
})
const sectorSchema = z.object({ sectorName: z.string().min(1), description: z.string().optional() })
router.post('/sectors', async (req, res) => {
  const p = sectorSchema.safeParse(req.body)
  if (!p.success) return void bad(res, 'sectorName is required.')
  res.status(201).json({ sector: await prisma.sector.create({ data: p.data }) })
})

// ─── Lead statuses ──────────────────────────────────────────────────────────
router.get('/lead-statuses', async (_req, res) => {
  res.json({ leadStatuses: await prisma.leadStatus.findMany({ where: { isActive: true }, orderBy: { displayOrder: 'asc' } }) })
})
const statusSchema = z.object({ statusName: z.string().min(1), statusCategory: z.string().optional(), displayOrder: z.number().int().optional() })
router.post('/lead-statuses', async (req, res) => {
  const p = statusSchema.safeParse(req.body)
  if (!p.success) return void bad(res, 'statusName is required.')
  res.status(201).json({ leadStatus: await prisma.leadStatus.create({ data: p.data }) })
})

// ─── Users (internal employees — for assignment dropdowns) ───────────────────
router.get('/users', async (_req: AuthRequest, res) => {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, userName: true, email: true, role: true, department: true, phoneNumber: true, isActive: true },
    orderBy: { email: 'asc' },
  })
  res.json({ users })
})
const userSchema = z.object({
  userName: z.string().optional(),
  email: z.string().email(),
  phoneNumber: z.string().optional(),
  role: z.string().optional(),
  department: z.string().optional(),
})
router.post('/users', async (req, res) => {
  const p = userSchema.safeParse(req.body)
  if (!p.success) return void bad(res, 'A valid email is required.')
  try {
    const user = await prisma.user.create({ data: p.data })
    res.status(201).json({ user: { id: user.id, userName: user.userName, email: user.email, role: user.role } })
  } catch { bad(res, 'Could not create user. Email may already exist.') }
})

// DELETE /users/:id — admin-only. Soft delete (isActive: false), same pattern
// as leads: the row (and their lead history — createdBy/assignedTo/assignedBy
// references) stays intact, they just disappear from the team list and
// assignment dropdowns, and can no longer log in.
router.delete('/users/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = String(req.params.id)
  if (id === req.userId) {
    res.status(400).json({ error: 'You cannot delete your own account.' })
    return
  }
  const existing = await prisma.user.findUnique({ where: { id }, select: { isActive: true } })
  if (!existing || !existing.isActive) {
    res.status(404).json({ error: 'Employee not found.' })
    return
  }
  await prisma.user.update({ where: { id }, data: { isActive: false } })
  res.json({ message: 'Employee removed.' })
})

export default router

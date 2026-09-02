import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../prisma'
import { authenticate, requireAdmin, AuthRequest } from '../middleware/authenticate'
import { broadcastInvoiceUpdate } from '../services/notify'

const router = Router()
router.use(authenticate)

export const INVOICE_STATUSES = ['Draft', 'Sent', 'Partially Paid', 'Paid', 'Overdue'] as const

const invoiceInclude = {
  project: { select: { id: true, workOrderNo: true, projectName: true, lead: { select: { id: true, plant: { select: { id: true, plantName: true, client: { select: { id: true, clientName: true } } } } } } } },
  payments: { orderBy: { paymentDate: 'desc' as const }, include: { recordedByUser: { select: { id: true, userName: true, email: true } } } },
} as const

// Same visibility rule as elsewhere: employees only see invoices on their own leads' projects, admins see all.
async function isAdmin(userId: string | undefined): Promise<boolean> {
  if (!userId) return false
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  return user?.role === 'admin'
}
async function canAccessProject(projectId: string, userId: string | undefined, admin: boolean) {
  return prisma.project.findFirst({ where: { id: projectId, deletedAt: null, ...(admin ? {} : { lead: { assignedToUserId: userId } }) } })
}
async function findAccessibleInvoice(id: string, userId: string | undefined, admin: boolean) {
  return prisma.invoice.findFirst({
    where: { id, deletedAt: null, ...(admin ? {} : { project: { lead: { assignedToUserId: userId } } }) },
    include: invoiceInclude,
  })
}

async function nextInvoiceNumber(): Promise<string> {
  const count = await prisma.invoice.count()
  return `INV-${String(count + 1).padStart(4, '0')}`
}

// Recomputes status from what's actually been paid — Paid/Partially Paid are
// derived, never hand-set, so they can't drift out of sync with payments.
// Draft/Sent/Overdue stay manual (Overdue has no time-based auto-trigger —
// there's no background job in this app — so it's set by whoever notices).
async function recomputeStatus(invoiceId: string): Promise<void> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } })
  if (!invoice) return
  const paid = invoice.payments.reduce((sum, p) => sum + p.amountReceived, 0)
  const nextStatus = paid >= invoice.amount ? 'Paid' : paid > 0 ? 'Partially Paid' : invoice.status
  if (nextStatus !== invoice.status) {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: nextStatus } })
  }
}

// GET /invoices?projectId=xxx
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const admin = await isAdmin(req.userId)
  const projectId = req.query.projectId ? String(req.query.projectId) : undefined
  const invoices = await prisma.invoice.findMany({
    where: {
      deletedAt: null,
      ...(projectId ? { projectId } : {}),
      ...(admin ? {} : { project: { lead: { assignedToUserId: req.userId } } }),
    },
    include: invoiceInclude,
    orderBy: { createdAt: 'desc' },
  })
  res.json({ invoices })
})

router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const admin = await isAdmin(req.userId)
  const invoice = await findAccessibleInvoice(String(req.params.id), req.userId, admin)
  if (!invoice) {
    res.status(404).json({ error: 'Invoice not found.' })
    return
  }
  res.json({ invoice })
})

// POST /invoices
const createSchema = z.object({
  projectId: z.string().min(1),
  amount: z.coerce.number().positive('Amount must be greater than 0.'),
  invoiceDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
})

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = createSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message ?? 'Invalid invoice data.' })
    return
  }
  const d = parse.data
  const admin = await isAdmin(req.userId)
  const project = await canAccessProject(d.projectId, req.userId, admin)
  if (!project) {
    res.status(404).json({ error: 'Project not found.' })
    return
  }
  try {
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: await nextInvoiceNumber(),
        projectId: d.projectId,
        amount: d.amount,
        invoiceDate: d.invoiceDate ?? null,
        dueDate: d.dueDate ?? null,
        createdByUserId: req.userId!,
      },
      include: invoiceInclude,
    })
    broadcastInvoiceUpdate(invoice.id)
    res.status(201).json({ invoice })
  } catch {
    res.status(400).json({ error: 'Could not create invoice.' })
  }
})

// PATCH /invoices/:id — manual edits (amount/dates/status). Status here covers
// the manual states (Draft/Sent/Overdue) — Paid/Partially Paid are overwritten
// again the next time a payment is logged, so hand-setting them has no lasting effect.
const updateSchema = z.object({
  amount: z.coerce.number().positive().optional(),
  invoiceDate: z.coerce.date().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
})

router.patch('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = updateSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid update data.' })
    return
  }
  const admin = await isAdmin(req.userId)
  const existing = await findAccessibleInvoice(String(req.params.id), req.userId, admin)
  if (!existing) {
    res.status(404).json({ error: 'Invoice not found.' })
    return
  }

  const d = parse.data
  const data: Record<string, unknown> = {}
  if (d.amount) data.amount = d.amount
  if ('invoiceDate' in d) data.invoiceDate = d.invoiceDate
  if ('dueDate' in d) data.dueDate = d.dueDate
  if (d.status) data.status = d.status

  try {
    await prisma.invoice.update({ where: { id: existing.id }, data })
    const invoice = await prisma.invoice.findUnique({ where: { id: existing.id }, include: invoiceInclude })
    broadcastInvoiceUpdate(existing.id)
    res.json({ invoice })
  } catch {
    res.status(400).json({ error: 'Could not update invoice.' })
  }
})

// POST /invoices/:id/payments — log a payment, then recompute the invoice's status.
const paymentSchema = z.object({
  amountReceived: z.coerce.number().positive('Amount received must be greater than 0.'),
  paymentDate: z.coerce.date().optional(),
  notes: z.string().optional(),
})

router.post('/:id/payments', async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = paymentSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message ?? 'Invalid payment data.' })
    return
  }
  const admin = await isAdmin(req.userId)
  const existing = await findAccessibleInvoice(String(req.params.id), req.userId, admin)
  if (!existing) {
    res.status(404).json({ error: 'Invoice not found.' })
    return
  }
  const d = parse.data
  try {
    await prisma.payment.create({
      data: {
        invoiceId: existing.id,
        amountReceived: d.amountReceived,
        paymentDate: d.paymentDate ?? new Date(),
        notes: d.notes?.trim() || null,
        recordedByUserId: req.userId!,
      },
    })
    await recomputeStatus(existing.id)
    const invoice = await prisma.invoice.findUnique({ where: { id: existing.id }, include: invoiceInclude })
    broadcastInvoiceUpdate(existing.id)
    res.status(201).json({ invoice })
  } catch {
    res.status(400).json({ error: 'Could not record payment.' })
  }
})

// DELETE /invoices/:id — admin-only soft delete, same pattern as leads/tasks/proposals/projects.
router.delete('/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await prisma.invoice.findFirst({ where: { id: String(req.params.id), deletedAt: null } })
  if (!existing) {
    res.status(404).json({ error: 'Invoice not found.' })
    return
  }
  await prisma.invoice.update({ where: { id: existing.id }, data: { deletedAt: new Date() } })
  broadcastInvoiceUpdate(existing.id)
  res.json({ message: 'Invoice deleted.' })
})

export default router

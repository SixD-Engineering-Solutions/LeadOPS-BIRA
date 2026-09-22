import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../prisma'
import { Prisma } from '../generated/prisma/client'
import { authenticate, requireAdmin, AuthRequest } from '../middleware/authenticate'
import { broadcastInvoiceUpdate } from '../services/notify'
import { nextSequenceNumber, TX_OPTS } from '../utils/sequence'

type Db = typeof prisma | Prisma.TransactionClient

// Thrown from inside a $transaction callback to carry a specific, user-facing
// message back out (vs. the generic fallback the surrounding catch uses for
// anything else — a DB error, a constraint violation, etc).
class ValidationError extends Error {}

const router = Router()
router.use(authenticate)

export const INVOICE_STATUSES = ['Draft', 'Sent', 'Partially Paid', 'Paid', 'Overdue'] as const

const invoiceInclude = {
  project: { select: { id: true, workOrderNo: true, projectName: true, lead: { select: { id: true, plant: { select: { id: true, plantName: true, client: { select: { id: true, clientName: true } } } } } } } },
  payments: { where: { deletedAt: null }, orderBy: { paymentDate: 'desc' as const }, include: { recordedByUser: { select: { id: true, userName: true, email: true } } } },
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

// Sum of what's actually been paid on an invoice — voided (soft-deleted)
// payments don't count, same as everywhere else a voided payment is excluded.
// Takes a `db` client so it can be called with a `tx` from inside a
// transaction (needed wherever it must see a row lock taken in that same
// transaction) or with the plain `prisma` client otherwise.
async function totalPaid(db: Db, invoiceId: string): Promise<number> {
  const payments = await db.payment.findMany({ where: { invoiceId, deletedAt: null }, select: { amountReceived: true } })
  // amountReceived is a Decimal (exact storage) — convert to a plain number
  // here at the one place these get summed, rather than at every call site.
  // Decimal doesn't overload `+`, so leaving these as Decimal instances would
  // silently string-concatenate instead of adding.
  return payments.reduce((sum, p) => sum + Number(p.amountReceived), 0)
}

// Recomputes status from what's actually been paid — Paid/Partially Paid are
// derived, never hand-set, so they can't drift out of sync with payments.
// Draft/Sent/Overdue stay manual (Overdue has no time-based auto-trigger —
// there's no background job in this app — so it's set by whoever notices).
async function recomputeStatus(db: Db, invoiceId: string): Promise<void> {
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId } })
  if (!invoice) return
  const paid = await totalPaid(db, invoiceId)
  // paid can now drop back to 0 (voiding the last payment on an invoice), not
  // just rise — if that leaves a derived state (Paid/Partially Paid) with
  // nothing behind it, fall back to Sent rather than leaving it stuck. A
  // manual state (Draft/Sent/Overdue) with paid=0 is untouched either way.
  const wasDerived = invoice.status === 'Paid' || invoice.status === 'Partially Paid'
  const nextStatus =
    paid >= Number(invoice.amount) ? 'Paid' :
    paid > 0 ? 'Partially Paid' :
    wasDerived ? 'Sent' :
    invoice.status
  if (nextStatus !== invoice.status) {
    await db.invoice.update({ where: { id: invoiceId }, data: { status: nextStatus } })
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
    // Reserving the invoice number and creating the row together — see the
    // same reasoning in projects.ts/proposals.ts.
    const invoice = await prisma.$transaction(async tx => {
      const invoiceNumber = await nextSequenceNumber(tx, 'invoice', 'INV')
      return tx.invoice.create({
        data: {
          invoiceNumber,
          projectId: d.projectId,
          amount: d.amount,
          invoiceDate: d.invoiceDate ?? null,
          dueDate: d.dueDate ?? null,
          createdByUserId: req.userId!,
        },
        include: invoiceInclude,
      })
    }, TX_OPTS)
    broadcastInvoiceUpdate(invoice.id)
    res.status(201).json({ invoice })
  } catch {
    res.status(400).json({ error: 'Could not create invoice.' })
  }
})

// PATCH /invoices/:id — manual edits (amount/dates/status). Status here covers
// the manual states (Draft/Sent/Overdue) — Paid/Partially Paid are overwritten
// again the moment a payment is logged or the amount changes, so hand-setting
// them has no lasting effect once real payment data disagrees.
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
    const invoice = await prisma.$transaction(async tx => {
      await tx.invoice.update({ where: { id: existing.id }, data })
      // Amount changed → what's already been paid may no longer cover it (or
      // now covers it in full), so the derived Paid/Partially Paid state
      // can't be trusted until it's recomputed against the new amount. Same
      // transaction as the update, so a status left stale by a crash
      // mid-request isn't possible — either both land or neither does.
      if ('amount' in data) await recomputeStatus(tx, existing.id)
      return tx.invoice.findUnique({ where: { id: existing.id }, include: invoiceInclude })
    }, TX_OPTS)
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
    const invoice = await prisma.$transaction(async tx => {
      // Lock the invoice row for the rest of this transaction — a second,
      // near-simultaneous payment on the *same* invoice has to wait here
      // until this one commits or rolls back, instead of reading the same
      // "remaining balance" this one just read and both passing the
      // overpayment check below. Without this lock, two concurrent requests
      // under Postgres's default READ COMMITTED isolation could each see the
      // pre-payment balance and together overpay the invoice — the row lock
      // is what actually closes that race; the check on its own wouldn't.
      await tx.$executeRaw`SELECT id FROM invoices WHERE id = ${existing.id} FOR UPDATE`

      // Re-read what's paid now that the lock is held — `existing.payments`
      // was fetched before the lock, so it could already be stale.
      const alreadyPaid = await totalPaid(tx, existing.id)
      const remaining = Math.round((Number(existing.amount) - alreadyPaid) * 100) / 100
      // Reject rather than silently allow an overpayment — simplest safe
      // default for money data; a genuine overpayment (bank charges,
      // rounding, a client paying extra) is rare enough that requiring the
      // amount be corrected first is preferable to the invoice silently
      // reporting the wrong total.
      if (d.amountReceived > remaining) {
        throw new ValidationError(`Amount received (${d.amountReceived}) exceeds the remaining balance (${remaining}). Void or correct an existing payment first if this is wrong.`)
      }

      await tx.payment.create({
        data: {
          invoiceId: existing.id,
          amountReceived: d.amountReceived,
          paymentDate: d.paymentDate ?? new Date(),
          notes: d.notes?.trim() || null,
          recordedByUserId: req.userId!,
        },
      })
      await recomputeStatus(tx, existing.id)
      return tx.invoice.findUnique({ where: { id: existing.id }, include: invoiceInclude })
    }, TX_OPTS)
    broadcastInvoiceUpdate(existing.id)
    res.status(201).json({ invoice })
  } catch (e) {
    if (e instanceof ValidationError) {
      res.status(400).json({ error: e.message })
      return
    }
    res.status(400).json({ error: 'Could not record payment.' })
  }
})

// DELETE /invoices/:id/payments/:paymentId — admin-only. Voids (soft-deletes)
// a wrongly-entered payment, same pattern as everywhere else — the row (and
// who recorded it) stays for the audit trail, it just stops counting toward
// what's been paid. Correcting an amount is void-and-re-enter, not edit in
// place, so there's always a record that a correction happened.
router.delete('/:id/payments/:paymentId', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const invoiceId = String(req.params.id)
  const paymentId = String(req.params.paymentId)
  const payment = await prisma.payment.findFirst({ where: { id: paymentId, invoiceId, deletedAt: null } })
  if (!payment) {
    res.status(404).json({ error: 'Payment not found.' })
    return
  }
  const invoice = await prisma.$transaction(async tx => {
    await tx.payment.update({ where: { id: paymentId }, data: { deletedAt: new Date() } })
    await recomputeStatus(tx, invoiceId)
    return tx.invoice.findUnique({ where: { id: invoiceId }, include: invoiceInclude })
  }, TX_OPTS)
  broadcastInvoiceUpdate(invoiceId)
  res.json({ invoice })
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

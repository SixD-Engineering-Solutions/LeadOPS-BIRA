import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../prisma'
import { Prisma } from '../generated/prisma/client'
import { authenticate, requireAdmin, AuthRequest } from '../middleware/authenticate'
import { broadcastInvoiceUpdate } from '../services/notify'
import { nextSequenceNumber, TX_OPTS } from '../utils/sequence'
import { isAdmin, canAccessProject } from '../utils/access'
import { sendError } from '../utils/errors'
import { syncLeadToPipeline, syncTrackerBestEffort } from '../utils/pipelineSync'

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
// Doesn't sync to the Tracker itself — see the note on `syncInvoiceToTracker`
// below on why that's deliberately kept out of this (and every) transaction.
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


// Mirrors a Paid invoice into `InvoiceRegisterItem` (the Tracker's Invoice
// Register) so it shows up alongside the imported historical data —
// `sourceInvoiceId` marks the row as live-synced (vs. `null` for everything
// from the original Excel import); the client uses that to list these rows
// separately from the imported ones. Keyed by
// `sourceInvoiceId` (unique), so re-running this on the same invoice updates
// its one row rather than creating duplicates.
//
// Called from every route below with the invoice's already-current status —
// after the payment/status-change transaction has committed, never from
// inside one. This does a handful of extra reads/writes (the deep include
// below, plus the upsert), which is fine on its own but is exactly the kind
// of added latency that pushed a real concurrency test over its timeout when
// it was first wired in *inside* the payment-creation transaction (that
// transaction is already tuned tight — see TX_OPTS — specifically so N-way
// concurrent requests all fit inside it under this DB plan's connection
// cap). Keeping this call after commit means it can take its time without
// holding a row lock or eating into that budget; `syncTrackerBestEffort`
// (below each call site) also means a failure here never fails the request
// that triggered it — worst case, the Tracker mirror lags until the next
// event resyncs it, not the actual invoice/payment write.
async function syncInvoiceToTracker(db: Db, invoiceId: string, status: string): Promise<void> {
  if (status !== 'Paid') {
    // Not (or no longer) fully paid — e.g. voiding a payment dropped it back
    // to Partially Paid — remove any tracker row rather than leaving a stale
    // "Paid" entry behind.
    await db.invoiceRegisterItem.deleteMany({ where: { sourceInvoiceId: invoiceId } })
    return
  }
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      project: {
        include: {
          responsibleUser: { select: { userName: true, email: true } },
          lead: {
            include: {
              sector: { select: { sectorName: true } },
              serviceType: { select: { serviceTypeName: true } },
              plant: {
                include: {
                  client: { select: { clientName: true } },
                  location: { select: { city: true } },
                },
              },
            },
          },
        },
      },
      payments: { where: { deletedAt: null }, orderBy: { paymentDate: 'desc' } },
    },
  })
  if (!invoice) return

  const amount = Number(invoice.amount)
  const paidTotal = invoice.payments.reduce((sum, p) => sum + Number(p.amountReceived), 0)
  // Marked Paid with no (or only partial) real payment behind it — e.g. the
  // status dropdown, hand-set directly rather than via a logged payment.
  // Treat the invoice's own amount as what was collected in that case,
  // rather than showing a contradictory "Paid, ₹0 collected" row; if there
  // IS a real (even partial) payment on record, report that honestly instead
  // of overriding it — so a partial payment force-marked Paid still shows
  // its actual outstanding balance rather than pretending it's zero.
  const amountCollected = paidTotal > 0 ? paidTotal : amount
  const balanceOutstanding = Math.max(0, amount - amountCollected)
  const lastPaymentDate = invoice.payments[0]?.paymentDate ?? new Date()
  const toLakhs = (n: number) => Math.round((n / 100000) * 100) / 100
  const bmOwner = invoice.project.responsibleUser
    ? (invoice.project.responsibleUser.userName || invoice.project.responsibleUser.email)
    : null
  const daysToCollect = invoice.invoiceDate
    ? Math.round((lastPaymentDate.getTime() - invoice.invoiceDate.getTime()) / (1000 * 60 * 60 * 24))
    : null

  const data = {
    sourceInvoiceId: invoice.id,
    sortOrder: -1, // always sorts ahead of every imported row (sortOrder >= 0); the client re-sorts app rows among themselves
    sector: invoice.project.lead.sector?.sectorName ?? null,
    client: invoice.project.lead.plant.client?.clientName ?? null,
    location: invoice.project.lead.plant.location?.city ?? null,
    poNumber: invoice.project.workOrderNo,
    orderValueLakhs: toLakhs(amount),
    serviceType: invoice.project.lead.serviceType?.serviceTypeName ?? null,
    bmOwner,
    workCompletionDate: invoice.project.completionDate?.toISOString().slice(0, 10) ?? null,
    invoiceRaised: 'Yes',
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    invoiceAmountLakhs: toLakhs(amount),
    dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? null,
    paymentReceived: 'Yes',
    dsoStatus: '🟢 Collected', // same label the imported sheet uses, so the Reports DSO chart buckets it with them
    paymentDate: lastPaymentDate,
    amountCollectedLakhs: toLakhs(amountCollected),
    balanceOutstandingLakhs: toLakhs(balanceOutstanding),
    daysToCollect,
    remarks: paidTotal > 0
      ? 'Auto-synced from an invoice paid in the app.'
      : 'Auto-synced from an invoice marked Paid manually in the app (no payment logged).',
  }

  await db.invoiceRegisterItem.upsert({
    where: { sourceInvoiceId: invoice.id },
    create: data,
    update: data,
  })
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
    sendError(res, 404, 'Invoice not found.')
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
    sendError(res, 400, parse.error.issues[0]?.message ?? 'Invalid invoice data.')
    return
  }
  const d = parse.data
  const admin = await isAdmin(req.userId)
  const project = await canAccessProject(d.projectId, req.userId, admin)
  if (!project) {
    sendError(res, 404, 'Project not found.')
    return
  }
  try {
    // Reserving the invoice number and creating the row together — see the
    // same reasoning in projects.ts/proposals.ts.
    const invoice = await prisma.$transaction(async tx => {
      const invoiceNumber = await nextSequenceNumber(tx, 'invoice', 'INV')
      const created = await tx.invoice.create({
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
      return created
    }, TX_OPTS)
    // Moves the lead's Pipeline row to the Invoice stage. After the
    // transaction, not inside it.
    await syncTrackerBestEffort(() => syncLeadToPipeline(prisma, project.leadId))
    broadcastInvoiceUpdate(invoice.id)
    res.status(201).json({ invoice })
  } catch {
    sendError(res, 400, 'Could not create invoice.')
  }
})

// PATCH /invoices/:id — manual edits (amount/dates/status). A hand-set status
// (including Paid/Partially Paid) is overwritten again the moment a payment
// is logged or the amount changes, since `recomputeStatus` always wins once
// real payment data disagrees with it — but until then, a hand-set Paid is
// still treated as genuinely paid for the Tracker sync (see syncInvoiceToTracker).
const updateSchema = z.object({
  amount: z.coerce.number().positive().optional(),
  invoiceDate: z.coerce.date().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
})

router.patch('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = updateSchema.safeParse(req.body)
  if (!parse.success) {
    sendError(res, 400, 'Invalid update data.')
    return
  }
  const admin = await isAdmin(req.userId)
  const existing = await findAccessibleInvoice(String(req.params.id), req.userId, admin)
  if (!existing) {
    sendError(res, 404, 'Invoice not found.')
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
      // can't be trusted until it's recomputed against the new amount — this
      // takes priority over (and can overwrite) a `status` sent in the same
      // request. Same transaction as the update, so a status left stale by a
      // crash mid-request isn't possible.
      if ('amount' in data) await recomputeStatus(tx, existing.id)
      return tx.invoice.findUnique({ where: { id: existing.id }, include: invoiceInclude })
    }, TX_OPTS)
    if (invoice && ('amount' in data || 'status' in data)) {
      // Whatever's now current — either just recomputed from real payments,
      // or (a bare status change, e.g. the dropdown) hand-set directly with
      // no payment math to re-derive. After the transaction, not inside it.
      await syncTrackerBestEffort(() => syncInvoiceToTracker(prisma, existing.id, invoice.status))
      // The lead's Pipeline row shows this invoice's status ("Invoice:Paid").
      await syncTrackerBestEffort(() => syncLeadToPipeline(prisma, invoice.project.lead.id))
    }
    broadcastInvoiceUpdate(existing.id)
    res.json({ invoice })
  } catch {
    sendError(res, 400, 'Could not update invoice.')
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
    sendError(res, 400, parse.error.issues[0]?.message ?? 'Invalid payment data.')
    return
  }
  const admin = await isAdmin(req.userId)
  const existing = await findAccessibleInvoice(String(req.params.id), req.userId, admin)
  if (!existing) {
    sendError(res, 404, 'Invoice not found.')
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
    if (invoice) {
      await syncTrackerBestEffort(() => syncInvoiceToTracker(prisma, existing.id, invoice.status))
      await syncTrackerBestEffort(() => syncLeadToPipeline(prisma, invoice.project.lead.id))
    }
    broadcastInvoiceUpdate(existing.id)
    res.status(201).json({ invoice })
  } catch (e) {
    if (e instanceof ValidationError) {
      sendError(res, 400, e.message)
      return
    }
    sendError(res, 400, 'Could not record payment.')
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
    sendError(res, 404, 'Payment not found.')
    return
  }
  const invoice = await prisma.$transaction(async tx => {
    await tx.payment.update({ where: { id: paymentId }, data: { deletedAt: new Date() } })
    await recomputeStatus(tx, invoiceId)
    return tx.invoice.findUnique({ where: { id: invoiceId }, include: invoiceInclude })
  }, TX_OPTS)
  if (invoice) {
    await syncTrackerBestEffort(() => syncInvoiceToTracker(prisma, invoiceId, invoice.status))
    await syncTrackerBestEffort(() => syncLeadToPipeline(prisma, invoice.project.lead.id))
  }
  broadcastInvoiceUpdate(invoiceId)
  res.json({ invoice })
})

// DELETE /invoices/:id — admin-only soft delete, same pattern as leads/tasks/proposals/projects.
router.delete('/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await prisma.invoice.findFirst({ where: { id: String(req.params.id), deletedAt: null } })
  if (!existing) {
    sendError(res, 404, 'Invoice not found.')
    return
  }
  await prisma.invoice.update({ where: { id: existing.id }, data: { deletedAt: new Date() } })
  // If that was the lead's only invoice, its Pipeline row drops back to the
  // Working Project stage.
  const project = await prisma.project.findUnique({ where: { id: existing.projectId }, select: { leadId: true } })
  if (project) await syncTrackerBestEffort(() => syncLeadToPipeline(prisma, project.leadId))
  broadcastInvoiceUpdate(existing.id)
  res.json({ message: 'Invoice deleted.' })
})

export default router

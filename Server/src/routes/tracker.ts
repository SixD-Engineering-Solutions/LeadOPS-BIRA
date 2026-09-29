import { Router, Response } from 'express'
import { prisma } from '../prisma'
import { authenticate, requireAdmin, AuthRequest } from '../middleware/authenticate'

const router = Router()
router.use(authenticate)

// Read-only for the imported sheet data (see prisma/importTracker.ts). The
// exceptions are the pipeline and invoice register's live-synced rows — see
// syncLeadToPipeline in utils/pipelineSync.ts, syncInvoiceToTracker in
// routes/invoices.ts, and the DELETE routes below.

// GET /tracker/pipeline — the full pipeline sheet, in its original row order.
router.get('/pipeline', async (_req: AuthRequest, res: Response): Promise<void> => {
  const items = await prisma.pipelineTrackerItem.findMany({ orderBy: { sortOrder: 'asc' } })
  res.json({ items })
})

// GET /tracker/invoices — the monthly-by-sector summary and the detailed
// order-wise invoice register, both from the same sheet.
router.get('/invoices', async (_req: AuthRequest, res: Response): Promise<void> => {
  const [summary, register] = await Promise.all([
    prisma.invoiceSectorSummary.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.invoiceRegisterItem.findMany({ orderBy: { sortOrder: 'asc' } }),
  ])
  res.json({ summary, register })
})

// DELETE /tracker/invoices/trial-entries — admin-only. Removes every
// live-synced invoice register row (sourceInvoiceId set), leaving the
// imported sheet data untouched. Meant for clearing out whatever accumulated
// during trials/testing right before a real deployment.
router.delete('/invoices/trial-entries', requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  const { count } = await prisma.invoiceRegisterItem.deleteMany({ where: { sourceInvoiceId: { not: null } } })
  res.json({ message: `${count} trial ${count === 1 ? 'entry' : 'entries'} cleared.`, count })
})

// DELETE /tracker/pipeline/trial-entries — admin-only. Same idea, for the
// pipeline's live-synced lead rows (sourceLeadId set).
router.delete('/pipeline/trial-entries', requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  const { count } = await prisma.pipelineTrackerItem.deleteMany({ where: { sourceLeadId: { not: null } } })
  res.json({ message: `${count} trial ${count === 1 ? 'entry' : 'entries'} cleared.`, count })
})

export default router

import { Router, Response } from 'express'
import { prisma } from '../prisma'
import { authenticate, AuthRequest } from '../middleware/authenticate'

const router = Router()
router.use(authenticate)

// Read-only. The imported sheet data never changes (see
// prisma/importTracker.ts); the rows synced from the app are written only by
// syncLeadToPipeline (utils/pipelineSync.ts) and syncInvoiceToTracker
// (routes/invoices.ts), and removed only when their lead/invoice is.

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

export default router

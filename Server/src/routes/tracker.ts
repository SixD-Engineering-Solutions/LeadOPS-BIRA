import { Router, Response } from 'express'
import { prisma } from '../prisma'
import { authenticate, AuthRequest } from '../middleware/authenticate'

const router = Router()
router.use(authenticate)

// Read-only for now — this data is a snapshot import of the FY2026–27
// Pipeline/Invoice Excel sheet (see prisma/importTracker.ts), not something
// captured through the app's own forms, so there's nothing to write yet.

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

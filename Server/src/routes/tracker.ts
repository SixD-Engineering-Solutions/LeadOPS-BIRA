import { Router, Response } from 'express'
import { prisma } from '../prisma'
import { z } from 'zod'
import { authenticate, requireAdmin, AuthRequest } from '../middleware/authenticate'
import { sendError } from '../utils/errors'
import { runSheetSync, sheetSyncSource, sheetSyncHour } from '../services/sheetSync'
import { SheetError } from '../services/trackerSheet'

const router = Router()
router.use(authenticate)

// Reads, plus the SharePoint sheet sync below. Sheet rows are replaced by the
// daily sync (services/sheetSync.ts) and otherwise change only through
// an admin's edit or an approved change request (see
// routes/trackerRequests.ts); the rows synced from the app are written only by
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

// GET /tracker/sheet-sync — admins: whether the daily SharePoint sync is on,
// when it runs, and the most recent runs (newest first).
router.get('/sheet-sync', requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  const source = sheetSyncSource()
  const runs = await prisma.sheetSyncRun.findMany({ orderBy: { startedAt: 'desc' }, take: 30 })
  const lastSuccess = runs.find(r => r.status === 'success') ?? await prisma.sheetSyncRun.findFirst({ where: { status: 'success' }, orderBy: { startedAt: 'desc' } })
  res.json({
    enabled: !!source,
    source: source ? (source.kind === 'file' ? 'file' : 'sharepoint') : null,
    dailyAtIst: `${String(sheetSyncHour()).padStart(2, '0')}:00`,
    lastSuccess,
    runs,
  })
})

// POST /tracker/sheet-sync/run — admins: pull the workbook now. `force`
// applies it even when it has far fewer rows than the Tracker has now.
router.post('/sheet-sync/run', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = z.object({ force: z.boolean().optional() }).safeParse(req.body ?? {})
  if (!parsed.success) { sendError(res, 400, 'Invalid request.'); return }
  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { userName: true, email: true } })
  try {
    const result = await runSheetSync('manual', { userName: user ? user.userName || user.email : null, force: parsed.data.force })
    res.status(result.status === 'success' ? 200 : 502).json(result.status === 'success' ? result : { ...result, error: result.message, code: 'UPSTREAM_ERROR' })
  } catch (e) {
    if (e instanceof SheetError) { sendError(res, 409, e.message); return }
    throw e
  }
})

export default router

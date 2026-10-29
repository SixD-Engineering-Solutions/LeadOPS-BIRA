import { Router, Response } from 'express'
import { prisma } from '../prisma'
import { authenticate, requireAdmin, AuthRequest } from '../middleware/authenticate'

// GET /activity-log — admins only: the newest entries of the Activity log
// (utils/auditLog.ts), newest first. The page searches and filters them in
// the browser, like every other list; ?limit= raises how many come back.
const router = Router()
router.use(authenticate, requireAdmin)

const DEFAULT_LIMIT = 2000
const MAX_LIMIT = 10000

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const asked = Number(req.query.limit)
  const take = Number.isFinite(asked) && asked > 0 ? Math.min(Math.floor(asked), MAX_LIMIT) : DEFAULT_LIMIT
  const [entries, total] = await Promise.all([
    prisma.auditLog.findMany({ orderBy: { at: 'desc' }, take }),
    prisma.auditLog.count(),
  ])
  res.json({ entries, total })
})

export default router

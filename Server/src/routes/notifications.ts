import { Router, Request, Response } from 'express'
import { prisma } from '../prisma'
import { verifyAccessToken } from '../utils/jwt'
import { authenticate, AuthRequest } from '../middleware/authenticate'
import { subscribe, unsubscribe } from '../services/notify'

const router = Router()

// GET /notifications/stream — Server-Sent Events. EventSource can't set custom
// headers, so the token travels as a query param here instead of `authenticate`.
router.get('/stream', (req: Request, res: Response): void => {
  const token = String(req.query.token ?? '')
  let userId: string
  try {
    userId = verifyAccessToken(token).sub
  } catch {
    res.status(401).json({ error: 'Invalid or expired token.' })
    return
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  res.write(': connected\n\n')

  subscribe(userId, res)
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000)
  req.on('close', () => {
    clearInterval(heartbeat)
    unsubscribe(userId, res)
  })
})

router.use(authenticate)

// GET /notifications — most recent 50 for the current user.
router.get('/', async (req: AuthRequest, res: Response) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  res.json({ notifications })
})

// PATCH /notifications/:id/read
router.patch('/:id/read', async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await prisma.notification.findFirst({ where: { id: String(req.params.id), userId: req.userId } })
  if (!existing) {
    res.status(404).json({ error: 'Notification not found.' })
    return
  }
  const notification = await prisma.notification.update({ where: { id: existing.id }, data: { isRead: true } })
  res.json({ notification })
})

// POST /notifications/read-all
router.post('/read-all', async (req: AuthRequest, res: Response) => {
  await prisma.notification.updateMany({ where: { userId: req.userId, isRead: false }, data: { isRead: true } })
  res.json({ message: 'All notifications marked read.' })
})

// DELETE /notifications — clear all notifications for the current user.
router.delete('/', async (req: AuthRequest, res: Response) => {
  await prisma.notification.deleteMany({ where: { userId: req.userId } })
  res.json({ message: 'All notifications cleared.' })
})

export default router

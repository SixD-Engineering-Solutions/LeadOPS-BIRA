import { Request, Response, NextFunction } from 'express'
import { verifyAccessToken } from '../utils/jwt'
import { prisma } from '../prisma'

export interface AuthRequest extends Request {
  userId?: string
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header.' })
    return
  }
  try {
    const payload = verifyAccessToken(header.slice(7))
    req.userId = payload.sub
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token.' })
  }
}

// Must run after `authenticate`. Allows the request only if the user is an admin.
export async function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ error: 'Not authenticated.' })
    return
  }
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { role: true } })
  if (user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required.' })
    return
  }
  next()
}

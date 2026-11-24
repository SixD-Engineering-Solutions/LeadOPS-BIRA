import { Request, Response, NextFunction } from 'express'
import { verifyAccessToken } from '../utils/jwt'
import { prisma } from '../prisma'
import { sendError } from '../utils/errors'
import { ROLES, Role } from '../utils/roles'

export interface AuthRequest extends Request {
  userId?: string
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    sendError(res, 401, 'Missing or invalid authorization header.')
    return
  }
  try {
    const payload = verifyAccessToken(header.slice(7))
    // Re-checked on every request (not just at login) so a removed employee's
    // still-valid token stops working immediately, instead of staying good
    // until it expires.
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { isActive: true } })
    if (!user?.isActive) {
      sendError(res, 401, 'Invalid or expired token.')
      return
    }
    req.userId = payload.sub
    next()
  } catch {
    sendError(res, 401, 'Invalid or expired token.')
  }
}

// Must run after `authenticate`. Allows the request only if the user is an admin.
export async function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.userId) {
    sendError(res, 401, 'Not authenticated.')
    return
  }
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { role: true } })
  if (user?.role !== ROLES.admin) {
    sendError(res, 403, 'Admin access required.')
    return
  }
  next()
}

// Must run after `authenticate`. Turns away the listed roles — used to keep
// Accounts out of the sales side (leads, proposals, follow-ups).
export function denyRoles(...roles: Role[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.userId) {
      sendError(res, 401, 'Not authenticated.')
      return
    }
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { role: true } })
    if (!user || roles.includes(user.role as Role)) {
      sendError(res, 403, 'Your role does not have access to this.')
      return
    }
    next()
  }
}

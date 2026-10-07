import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../prisma'
import { Prisma } from '../generated/prisma/client'
import { authenticate, requireAdmin, AuthRequest } from '../middleware/authenticate'
import { notifyUser } from '../services/notify'
import { sendError } from '../utils/errors'
import {
  TRACKER_TABLES, tableTitle, isTrackerTable, findTrackerRow, rowLockReason, rowLabel, diffChanges, applyTrackerChanges, toJsonValue,
} from '../utils/trackerFields'
import type { TrackerTable, FieldChange } from '../utils/trackerFields'

// Change requests for the Tracker's imported rows: an employee proposes an
// edit and sends it to one admin; that admin approves (the edit is applied)
// or declines (the request is closed and the employee is notified). Admins
// edit directly instead. Field rules live in utils/trackerFields.ts.

const router = Router()
router.use(authenticate)

// A request's lifecycle: pending until an admin decides; approved or declined
// is final.
const REQUEST_STATUS = { pending: 'pending', approved: 'approved', declined: 'declined' } as const
type RequestStatus = (typeof REQUEST_STATUS)[keyof typeof REQUEST_STATUS]

// GET /tracker/fields — which fields of each tracker table can be edited,
// with labels and types. The client builds its edit form and change lists
// from this, so the field list lives in one place (utils/trackerFields.ts).
router.get('/fields', (_req: AuthRequest, res: Response) => {
  res.json({ tables: TRACKER_TABLES })
})

// Thrown inside a transaction to carry a status + user-facing message out.
class RequestError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

const personName = (u: { userName: string | null; email: string }) => u.userName || u.email
const personSelect = { id: true, userName: true, email: true } as const

async function currentUser(id: string | undefined) {
  return id ? prisma.user.findUnique({ where: { id }, select: { ...personSelect, role: true, isActive: true } }) : null
}

const changesSchema = z.record(z.string(), z.union([z.string(), z.number(), z.null()]))

// PATCH /tracker/rows/:table/:id — admin only: edit an imported row directly.
router.patch('/rows/:table/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const table = req.params.table
  const parsed = z.object({ changes: changesSchema }).safeParse(req.body)
  if (!isTrackerTable(table) || !parsed.success) {
    sendError(res, 400, 'Invalid edit.')
    return
  }
  try {
    const changed = await prisma.$transaction(async tx => {
      const row = await findTrackerRow(tx, table, String(req.params.id))
      if (!row) throw new RequestError(404, 'That tracker row no longer exists.')
      const lock = rowLockReason(table, row)
      if (lock) throw new RequestError(400, lock)
      const diff = diffChanges(table, row, parsed.data.changes)
      if (!diff.ok) throw new RequestError(400, diff.error)
      if (Object.keys(diff.changes).length > 0) await applyTrackerChanges(tx, table, row.id, diff.changes)
      return Object.keys(diff.changes).length
    })
    res.json({ message: changed ? 'Tracker updated.' : 'Nothing changed.' })
  } catch (e) {
    if (e instanceof RequestError) { sendError(res, e.status, e.message); return }
    throw e
  }
})

const createSchema = z.object({
  table: z.string(),
  rowId: z.string().min(1),
  adminId: z.string().min(1),
  changes: changesSchema,
  note: z.string().trim().max(1000).optional(),
})

// POST /tracker/requests — propose a change to one imported row, for one admin.
router.post('/requests', async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success || !isTrackerTable(parsed.data.table)) {
    sendError(res, 400, 'Invalid change request.')
    return
  }
  const { rowId, adminId, changes: submitted, note } = parsed.data
  const table: TrackerTable = parsed.data.table

  const [me, admin] = await Promise.all([currentUser(req.userId), currentUser(adminId)])
  if (!me) { sendError(res, 401, 'Not authenticated.'); return }
  if (!admin || !admin.isActive || admin.role !== 'admin') {
    sendError(res, 400, 'Pick an active admin to send this request to.')
    return
  }
  if (admin.id === me.id) {
    sendError(res, 400, 'You’re an admin — edit the row directly instead of sending yourself a request.')
    return
  }

  const row = await findTrackerRow(prisma, table, rowId)
  if (!row) { sendError(res, 404, 'That tracker row no longer exists.'); return }
  const lock = rowLockReason(table, row)
  if (lock) { sendError(res, 400, lock); return }
  const diff = diffChanges(table, row, submitted)
  if (!diff.ok) { sendError(res, 400, diff.error); return }
  if (Object.keys(diff.changes).length === 0) {
    sendError(res, 400, 'Nothing has been changed — edit at least one field.')
    return
  }
  const existing = await prisma.trackerChangeRequest.findFirst({ where: { requesterId: me.id, tableName: table, rowId, status: REQUEST_STATUS.pending } })
  if (existing) {
    sendError(res, 409, 'You already have a request waiting on this row. Wait for the admin to decide on it first.')
    return
  }

  const label = rowLabel(table, row)
  const request = await prisma.trackerChangeRequest.create({
    data: {
      requesterId: me.id, adminId: admin.id, tableName: table, rowId, rowLabel: label,
      changes: diff.changes as Prisma.InputJsonValue, note: note || null,
    },
  })
  await notifyUser(admin.id, `${personName(me)} asked you to approve a change to “${label}” in the ${tableTitle(table)}. See your dashboard.`)
  res.status(201).json({ request })
})

// Requests an admin can decide: those sent to them, plus any whose chosen
// admin has since been removed or made an employee — so none get stranded.
async function decidableBy(adminId: string): Promise<Prisma.TrackerChangeRequestWhereInput> {
  return { status: REQUEST_STATUS.pending, OR: [{ adminId }, { admin: { OR: [{ isActive: false }, { role: { not: 'admin' } }] } }] }
}

// GET /tracker/requests/incoming — admin: pending requests to decide, each
// with the row's current value of every field it would change.
router.get('/requests/incoming', requireAdmin, async (req: AuthRequest, res: Response) => {
  const requests = await prisma.trackerChangeRequest.findMany({
    where: await decidableBy(req.userId!),
    include: { requester: { select: personSelect }, admin: { select: personSelect } },
    orderBy: { createdAt: 'asc' },
  })
  const withCurrent = await Promise.all(requests.map(async r => {
    const row = isTrackerTable(r.tableName) ? await findTrackerRow(prisma, r.tableName, r.rowId) : null
    const fields = Object.keys(r.changes as Record<string, FieldChange>)
    return {
      ...r,
      rowExists: !!row,
      current: row ? Object.fromEntries(fields.map(f => [f, toJsonValue(row[f])])) : null,
    }
  }))
  res.json({ requests: withCurrent })
})

// GET /tracker/requests/mine — the current user's requests still waiting.
router.get('/requests/mine', async (req: AuthRequest, res: Response) => {
  const requests = await prisma.trackerChangeRequest.findMany({
    where: { requesterId: req.userId, status: REQUEST_STATUS.pending },
    include: { admin: { select: personSelect } },
    orderBy: { createdAt: 'desc' },
  })
  res.json({ requests })
})

// Loads a pending request the admin may decide, or throws.
async function loadDecidable(tx: Prisma.TransactionClient, id: string, adminId: string) {
  const request = await tx.trackerChangeRequest.findFirst({ where: { id, ...(await decidableBy(adminId)) } })
  if (!request) throw new RequestError(404, 'This request has already been decided, or isn’t yours to decide.')
  return request
}

// Marks a request decided — only if it's still pending, so two admins (or two
// clicks) can't both decide it.
async function closeRequest(tx: Prisma.TransactionClient, id: string, status: Exclude<RequestStatus, 'pending'>, decisionNote: string | null) {
  const { count } = await tx.trackerChangeRequest.updateMany({
    where: { id, status: REQUEST_STATUS.pending },
    data: { status, decisionNote, decidedAt: new Date() },
  })
  if (count === 0) throw new RequestError(409, 'This request has already been decided.')
}

// POST /tracker/requests/:id/approve — apply the change and close the request.
router.post('/requests/:id/approve', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const request = await prisma.$transaction(async tx => {
      const request = await loadDecidable(tx, String(req.params.id), req.userId!)
      if (!isTrackerTable(request.tableName)) throw new RequestError(400, 'Unknown tracker table.')
      const row = await findTrackerRow(tx, request.tableName, request.rowId)
      if (!row) throw new RequestError(409, 'That tracker row no longer exists (the sheet may have been re-imported). Decline this request instead.')
      const lock = rowLockReason(request.tableName, row)
      if (lock) throw new RequestError(409, `${lock} Decline this request instead.`)
      await applyTrackerChanges(tx, request.tableName, row.id, request.changes as Record<string, FieldChange>)
      await closeRequest(tx, request.id, REQUEST_STATUS.approved, null)
      return request
    })
    await notifyUser(request.requesterId, `Your change to “${request.rowLabel}” was approved, and the tracker has been updated.`)
    res.json({ message: 'Approved — the tracker has been updated.' })
  } catch (e) {
    if (e instanceof RequestError) { sendError(res, e.status, e.message); return }
    throw e
  }
})

// POST /tracker/requests/:id/decline — close the request without changing
// anything, and tell the employee (with the admin's reason, if given).
router.post('/requests/:id/decline', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = z.object({ reason: z.string().trim().max(500).optional() }).safeParse(req.body ?? {})
  if (!parsed.success) { sendError(res, 400, 'Invalid reason.'); return }
  const reason = parsed.data.reason || null
  try {
    const request = await prisma.$transaction(async tx => {
      const request = await loadDecidable(tx, String(req.params.id), req.userId!)
      await closeRequest(tx, request.id, REQUEST_STATUS.declined, reason)
      return request
    })
    const admin = await currentUser(req.userId)
    await notifyUser(
      request.requesterId,
      `Your change to “${request.rowLabel}” was declined by ${admin ? personName(admin) : 'an admin'}${reason ? `: “${reason}”` : '.'} Nothing in the tracker was changed.`,
    )
    res.json({ message: 'Declined — the employee has been notified.' })
  } catch (e) {
    if (e instanceof RequestError) { sendError(res, e.status, e.message); return }
    throw e
  }
})

export default router

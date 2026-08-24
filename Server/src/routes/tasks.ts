import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../prisma'
import { authenticate, requireAdmin, AuthRequest } from '../middleware/authenticate'
import { notifyUser, broadcastTaskUpdate } from '../services/notify'

const router = Router()
router.use(authenticate)

const taskInclude = {
  assignedToUser: { select: { id: true, userName: true, email: true } },
  assignedByUser: { select: { id: true, userName: true, email: true } },
} as const

// Employees only see tasks assigned to them; admins see everything (same
// visibility rule as leads).
async function isAdmin(userId: string | undefined): Promise<boolean> {
  if (!userId) return false
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  return user?.role === 'admin'
}

const fmtDate = (d: Date) => d.toISOString().slice(0, 10)

// GET /tasks
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const admin = await isAdmin(req.userId)
  const tasks = await prisma.task.findMany({
    where: admin ? { deletedAt: null } : { deletedAt: null, assignedToUserId: req.userId },
    include: taskInclude,
    orderBy: { deadline: 'asc' },
  })
  res.json({ tasks })
})

// GET /tasks/:id
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const admin = await isAdmin(req.userId)
  const task = await prisma.task.findFirst({
    where: {
      id: String(req.params.id),
      deletedAt: null,
      ...(admin ? {} : { assignedToUserId: req.userId }),
    },
    include: taskInclude,
  })
  if (!task) {
    res.status(404).json({ error: 'Task not found.' })
    return
  }
  res.json({ task })
})

// POST /tasks — admin-only: assign a task to an employee with a deadline.
const createSchema = z.object({
  title: z.string().min(1, 'Title is required.'),
  description: z.string().optional(),
  deadline: z.coerce.date(),
  assignedToUserId: z.string().min(1, 'Assignee is required.'),
})

router.post('/', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = createSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message ?? 'Invalid task data.' })
    return
  }
  const d = parse.data

  const assignee = await prisma.user.findUnique({ where: { id: d.assignedToUserId }, select: { id: true, isActive: true, role: true } })
  if (!assignee || !assignee.isActive) {
    res.status(400).json({ error: 'Assignee not found.' })
    return
  }
  if (assignee.role === 'admin') {
    res.status(400).json({ error: 'Tasks cannot be assigned to an admin user.' })
    return
  }

  try {
    const task = await prisma.task.create({
      data: {
        title: d.title.trim(),
        description: d.description?.trim() || null,
        deadline: d.deadline,
        assignedToUserId: assignee.id,
        assignedByUserId: req.userId!,
      },
      include: taskInclude,
    })
    broadcastTaskUpdate(task.id)
    notifyUser(assignee.id, `New task assigned: "${task.title}" — due ${fmtDate(task.deadline)}`)
      .catch(err => console.error('notifyUser failed:', err.message))
    res.status(201).json({ task })
  } catch {
    res.status(400).json({ error: 'Could not create task.' })
  }
})

// PATCH /tasks/:id — admin can edit anything and reassign; the assignee can
// only move their own task's status along.
const updateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  deadline: z.coerce.date().optional(),
  assignedToUserId: z.string().optional(),
  status: z.string().optional(),
})

router.patch('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = updateSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid update data.' })
    return
  }
  const existing = await prisma.task.findFirst({ where: { id: String(req.params.id), deletedAt: null } })
  if (!existing) {
    res.status(404).json({ error: 'Task not found.' })
    return
  }
  const admin = await isAdmin(req.userId)
  if (!admin && existing.assignedToUserId !== req.userId) {
    res.status(403).json({ error: 'Not authorized to update this task.' })
    return
  }

  const data: { title?: string; description?: string | null; deadline?: Date; assignedToUserId?: string; status?: string } = {}
  if (parse.data.status?.trim()) data.status = parse.data.status.trim()

  if (admin) {
    if (parse.data.title?.trim()) data.title = parse.data.title.trim()
    if ('description' in parse.data) data.description = parse.data.description?.trim() || null
    if (parse.data.deadline) data.deadline = parse.data.deadline
    if (parse.data.assignedToUserId && parse.data.assignedToUserId !== existing.assignedToUserId) {
      const assignee = await prisma.user.findUnique({ where: { id: parse.data.assignedToUserId }, select: { id: true, isActive: true, role: true } })
      if (!assignee || !assignee.isActive) {
        res.status(400).json({ error: 'Assignee not found.' })
        return
      }
      if (assignee.role === 'admin') {
        res.status(400).json({ error: 'Tasks cannot be assigned to an admin user.' })
        return
      }
      data.assignedToUserId = assignee.id
    }
  }

  try {
    const task = await prisma.task.update({ where: { id: existing.id }, data, include: taskInclude })
    broadcastTaskUpdate(task.id)
    if (data.assignedToUserId && data.assignedToUserId !== req.userId) {
      notifyUser(data.assignedToUserId, `You've been assigned a task: "${task.title}" — due ${fmtDate(task.deadline)}`)
        .catch(err => console.error('notifyUser failed:', err.message))
    }
    res.json({ task })
  } catch {
    res.status(400).json({ error: 'Could not update task.' })
  }
})

// DELETE /tasks/:id — admin-only soft delete, same pattern as leads.
router.delete('/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await prisma.task.findFirst({ where: { id: String(req.params.id), deletedAt: null } })
  if (!existing) {
    res.status(404).json({ error: 'Task not found.' })
    return
  }
  await prisma.task.update({ where: { id: existing.id }, data: { deletedAt: new Date() } })
  broadcastTaskUpdate(existing.id)
  res.json({ message: 'Task deleted.' })
})

export default router

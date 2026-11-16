import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminToken, employeeToken, api, dbQuery } from './helpers'

// The Activity log also covers tasks, Team changes and Tracker row edits
// (not just leads, proposals, projects and invoices).

type Change = { field: string; from: string | null; to: string | null }
type Entry = { entity: string; entityId: string; label: string; action: string; summary: string | null; changes: Change[] }

describe('Activity log — tasks, team and tracker', () => {
  let admin: string
  let employeeId: string
  const startedAt = new Date()
  const tag = `Vitest cover ${Date.now()}`
  const email = `vitest.cover.${Date.now()}@leadops.local`
  let taskId = ''
  let userId = ''

  const entriesFor = async (entityId: string) =>
    (await api<{ entries: Entry[] }>('/activity-log', { token: admin })).body.entries.filter(e => e.entityId === entityId).reverse() // oldest first
  const change = (e: Entry | undefined, field: string) => e?.changes.find(c => c.field === field)

  beforeAll(async () => {
    admin = await adminToken()
    const employee = await employeeToken()
    employeeId = (await api<{ user: { id: string } }>('/auth/me', { token: employee })).body.user.id
  })

  afterAll(async () => {
    await dbQuery(`DELETE FROM audit_logs WHERE label LIKE $1 OR label = $2 OR (entity = 'tracker' AND at >= $3)`, [`%${tag}%`, email, startedAt])
    if (taskId) await dbQuery('DELETE FROM tasks WHERE id = $1', [taskId])
    if (userId) await dbQuery('DELETE FROM users WHERE id = $1', [userId])
    await dbQuery(`DELETE FROM notifications WHERE created_at >= $1 AND message LIKE $2`, [startedAt, `%${tag}%`])
  })

  it('records a task being created, changed and deleted', async () => {
    const created = await api<{ task: { id: string } }>('/tasks', { method: 'POST', token: admin, body: { title: tag, deadline: '2026-12-31', assignedToUserId: employeeId } })
    expect(created.status).toBe(201)
    taskId = created.body.task.id
    expect((await api(`/tasks/${taskId}`, { method: 'PATCH', token: admin, body: { status: 'In Progress' } })).status).toBe(200)
    expect((await api(`/tasks/${taskId}`, { method: 'DELETE', token: admin })).status).toBe(200)

    const log = await entriesFor(taskId)
    expect(log.map(e => e.action)).toEqual(['created', 'updated', 'deleted'])
    expect(log.every(e => e.entity === 'task' && e.label === tag)).toBe(true)
    expect(change(log[0], 'Title')?.to).toBe(tag)
    expect(change(log[0], 'Deadline')?.to).toBe('2026-12-31')
    expect(change(log[1], 'Status')?.to).toBe('In Progress')
    expect(log[1].changes).toHaveLength(1)
  })

  it('records a team member being added, given a new email and removed', async () => {
    const created = await api<{ user: { id: string } }>('/users', { method: 'POST', token: admin, body: { email, userName: tag } })
    expect(created.status).toBe(201)
    userId = created.body.user.id
    const newEmail = `moved.${email}`
    expect((await api(`/users/${userId}/email`, { method: 'PATCH', token: admin, body: { email: newEmail } })).status).toBe(200)
    expect((await api(`/users/${userId}`, { method: 'DELETE', token: admin })).status).toBe(200)

    const log = await entriesFor(userId)
    expect(log.map(e => e.action)).toEqual(['created', 'updated', 'deleted'])
    expect(log.every(e => e.entity === 'team')).toBe(true)
    expect(change(log[0], 'Email')?.to).toBe(email)
    expect(change(log[1], 'Email')).toEqual({ field: 'Email', from: email, to: newEmail })
    expect(log[1].changes).toHaveLength(1)
  })

  it('records an admin editing a Tracker row, field by field', async () => {
    const rows = (await api<{ items: { id: string; sourceLeadId: string | null; notes: string | null }[] }>('/tracker/pipeline', { token: admin })).body.items
    const row = rows.find(r => !r.sourceLeadId)
    expect(row, 'needs at least one imported pipeline row').toBeTruthy()
    try {
      const edited = await api(`/tracker/rows/pipeline/${row!.id}`, { method: 'PATCH', token: admin, body: { changes: { notes: `${tag} note` } } })
      expect(edited.status).toBe(200)
      const log = await entriesFor(row!.id)
      const entry = log[log.length - 1]
      expect(entry.entity).toBe('tracker')
      expect(entry.action).toBe('updated')
      expect(entry.label).toContain('Pipeline tracker')
      expect(change(entry, 'Notes')?.to).toBe(`${tag} note`)
    } finally {
      await api(`/tracker/rows/pipeline/${row!.id}`, { method: 'PATCH', token: admin, body: { changes: { notes: row!.notes } } })
    }
  })
})

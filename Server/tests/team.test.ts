import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminToken, employeeToken, api, dbQuery, createTestLead, deleteLead } from './helpers'

// The Team page's actions (routes/reference.ts): add, change email, make
// admin / employee (which unassigns their leads), remove and reactivate —
// and that only admins can do any of it. Works on one throwaway account,
// deleted outright at the end.

type User = { id: string; email: string; role: string; isActive: boolean }

describe('Team actions', () => {
  let admin: string
  let employee: string
  let adminId: string
  let user: User
  let leadId: string
  const tag = `vt${Date.now()}`

  beforeAll(async () => {
    admin = await adminToken()
    employee = await employeeToken()
    adminId = (await api<{ user: { id: string } }>('/auth/me', { token: admin })).body.user.id
  })

  afterAll(async () => {
    if (leadId) await deleteLead(admin, leadId)
    if (user) {
      await dbQuery(`UPDATE leads SET assigned_to_user_id = NULL WHERE assigned_to_user_id = $1`, [user.id])
      await dbQuery(`DELETE FROM notifications WHERE user_id = $1`, [user.id])
      await dbQuery(`DELETE FROM users WHERE id = $1`, [user.id])
    }
  })

  it('adds an employee', async () => {
    const res = await api<{ user: User }>('/users', { method: 'POST', token: admin, body: { email: `${tag}@leadops.local`, userName: `${tag} Tester`, role: 'employee', department: 'QA' } })
    expect(res.status).toBe(201)
    expect(res.body.user).toMatchObject({ email: `${tag}@leadops.local`, role: 'employee', isActive: true })
    user = res.body.user
  })

  it('lets only admins manage people', async () => {
    expect((await api('/users', { method: 'POST', token: employee, body: { email: `${tag}-x@leadops.local` } })).status).toBe(403)
    expect((await api(`/users/${user.id}/role`, { method: 'PATCH', token: employee, body: { role: 'admin' } })).status).toBe(403)
    expect((await api(`/users/${user.id}/email`, { method: 'PATCH', token: employee, body: { email: `${tag}-y@leadops.local` } })).status).toBe(403)
    expect((await api(`/users/${user.id}`, { method: 'DELETE', token: employee })).status).toBe(403)
  })

  it('changes their email, refusing one already in use', async () => {
    const taken = (await api<{ user: { email: string } }>('/auth/me', { token: admin })).body.user.email
    expect((await api(`/users/${user.id}/email`, { method: 'PATCH', token: admin, body: { email: taken } })).status).toBe(409)
    expect((await api(`/users/${user.id}/email`, { method: 'PATCH', token: admin, body: { email: 'not-an-email' } })).status).toBe(400)
    const res = await api<{ user: User }>(`/users/${user.id}/email`, { method: 'PATCH', token: admin, body: { email: `${tag}.new@leadops.local` } })
    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe(`${tag}.new@leadops.local`)
  })

  it('making them admin unassigns their leads; making them employee again works', async () => {
    leadId = await createTestLead(admin, `${tag} plant`)
    expect((await api(`/leads/${leadId}`, { method: 'PATCH', token: admin, body: { assignedToUserId: user.id } })).status).toBe(200)

    const promoted = await api<{ user: User; unassignedLeads: number }>(`/users/${user.id}/role`, { method: 'PATCH', token: admin, body: { role: 'admin' } })
    expect(promoted.status).toBe(200)
    expect(promoted.body.user.role).toBe('admin')
    expect(promoted.body.unassignedLeads).toBe(1)
    const lead = await api<{ lead: { assignedToUserId: string | null } }>(`/leads/${leadId}`, { token: admin })
    expect(lead.body.lead.assignedToUserId).toBeNull()

    expect((await api(`/users/${user.id}/role`, { method: 'PATCH', token: admin, body: { role: 'admin' } })).status).toBe(409) // already
    const demoted = await api<{ user: User }>(`/users/${user.id}/role`, { method: 'PATCH', token: admin, body: { role: 'employee' } })
    expect(demoted.status).toBe(200)
    expect(demoted.body.user.role).toBe('employee')
  })

  it('an admin can’t change their own role or remove themselves', async () => {
    expect((await api(`/users/${adminId}/role`, { method: 'PATCH', token: admin, body: { role: 'employee' } })).status).toBe(400)
    expect((await api(`/users/${adminId}`, { method: 'DELETE', token: admin })).status).toBe(400)
  })

  it('removes and reactivates', async () => {
    expect((await api(`/users/${user.id}`, { method: 'DELETE', token: admin })).status).toBe(200)
    const all = await api<{ users: User[] }>('/users?includeInactive=true', { token: admin })
    expect(all.body.users.find(u => u.id === user.id)?.isActive).toBe(false)

    const back = await api<{ user: User }>(`/users/${user.id}/reactivate`, { method: 'POST', token: admin })
    expect(back.status).toBe(200)
    expect(back.body.user.isActive).toBe(true)
    expect((await api(`/users/${user.id}/reactivate`, { method: 'POST', token: admin })).status).toBe(404) // not removed any more
  })
})

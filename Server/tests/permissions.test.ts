import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminToken, employeeToken, api, deleteUser } from './helpers'

// Phase 1 — admin-escalation fix, reactivation. Each check exercises both
// the denied and the allowed side of a permission rule, not just one — a
// rule that only ever gets tested from the allowed side can't tell you it's
// actually enforcing anything.
describe('Permissions (Phase 1)', () => {
  let admin: string
  let employee: string
  const createdUserIds: string[] = []

  beforeAll(async () => {
    admin = await adminToken()
    employee = await employeeToken()
  })

  afterAll(async () => {
    for (const id of createdUserIds) await deleteUser(admin, id)
  })

  it('an employee cannot create a user', async () => {
    const { status } = await api('/users', {
      method: 'POST',
      token: employee,
      body: { email: `vitest-escalation-${Date.now()}@leadops.local`, role: 'admin' },
    })
    expect(status).toBe(403)
  })

  it('an admin can create a user, with the full response shape', async () => {
    const email = `vitest-user-${Date.now()}@leadops.local`
    const { status, body } = await api<{ user: { id: string; email: string; role: string; department: string | null; isActive: boolean } }>(
      '/users',
      { method: 'POST', token: admin, body: { email, role: 'employee', department: 'QA' } }
    )
    expect(status).toBe(201)
    expect(body.user).toMatchObject({ email, role: 'employee', department: 'QA', isActive: true })
    createdUserIds.push(body.user.id)
  })

  it('rejects a role outside the enum, from an admin too', async () => {
    const { status } = await api('/users', {
      method: 'POST',
      token: admin,
      body: { email: `vitest-badrole-${Date.now()}@leadops.local`, role: 'superadmin' },
    })
    expect(status).toBe(400)
  })

  it('an employee cannot write to other reference-data routes either', async () => {
    // Representative of the same fix applied to /client-categories, /clients,
    // /lead-sources, /service-types, /plants, /contacts, /verticals,
    // /sectors, /lead-statuses — all gained requireAdmin in the same pass.
    const { status } = await api('/locations', {
      method: 'POST',
      token: employee,
      body: { city: 'Should not be created by an employee' },
    })
    expect(status).toBe(403)
  })

  describe('reactivation', () => {
    let userId: string

    beforeAll(async () => {
      const email = `vitest-reactivate-${Date.now()}@leadops.local`
      const { body } = await api<{ user: { id: string } }>('/users', { method: 'POST', token: admin, body: { email } })
      userId = body.user.id
      createdUserIds.push(userId)
      await deleteUser(admin, userId) // soft-delete it so the tests below have something removed to work with
    })

    it('is invisible in the default user list', async () => {
      const { body } = await api<{ users: { id: string }[] }>('/users', { token: admin })
      expect(body.users.find(u => u.id === userId)).toBeUndefined()
    })

    it('stays invisible to an employee even with includeInactive=true', async () => {
      const { body } = await api<{ users: { id: string }[] }>('/users?includeInactive=true', { token: employee })
      expect(body.users.find(u => u.id === userId)).toBeUndefined()
    })

    it('is visible to an admin with includeInactive=true, isActive: false', async () => {
      const { body } = await api<{ users: { id: string; isActive: boolean }[] }>('/users?includeInactive=true', { token: admin })
      const found = body.users.find(u => u.id === userId)
      expect(found?.isActive).toBe(false)
    })

    it('an employee cannot reactivate it', async () => {
      const { status } = await api(`/users/${userId}/reactivate`, { method: 'POST', token: employee })
      expect(status).toBe(403)
    })

    it('an admin can reactivate it', async () => {
      const { status, body } = await api<{ user: { isActive: boolean } }>(`/users/${userId}/reactivate`, { method: 'POST', token: admin })
      expect(status).toBe(200)
      expect(body.user.isActive).toBe(true)
    })

    it('reactivating an already-active account 404s', async () => {
      const { status } = await api(`/users/${userId}/reactivate`, { method: 'POST', token: admin })
      expect(status).toBe(404)
    })
  })
})

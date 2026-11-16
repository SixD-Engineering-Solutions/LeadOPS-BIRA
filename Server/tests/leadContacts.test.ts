import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminToken, api, dbQuery, deleteLead } from './helpers'

// A lead can name more than one person contacted: the main contact plus
// extraContacts. Each extra needs a name; the same person is linked once.

type Contact = { id: string; contactPersonName: string; mailId: string | null; contactPersonNumber: string | null }
type Lead = { id: string; contact: Contact | null; extraContacts: { contact: Contact }[] }

describe('Leads with several contacts', () => {
  let admin: string
  const tag = `Vitest contacts ${Date.now()}`
  const leadIds: string[] = []

  const create = (body: Record<string, unknown>) =>
    api<{ lead: Lead; error?: string }>('/leads', { method: 'POST', token: admin, body: { plantName: tag, ...body } })

  beforeAll(async () => { admin = await adminToken() })

  afterAll(async () => {
    for (const id of leadIds) await deleteLead(admin, id)
    // Contacts have no delete endpoint: free them from the (soft-deleted) leads first.
    await dbQuery(`DELETE FROM lead_contacts WHERE lead_id = ANY($1)`, [leadIds])
    await dbQuery(`UPDATE leads SET contact_id = NULL WHERE id = ANY($1)`, [leadIds])
    await dbQuery(`DELETE FROM contacts WHERE plant_id IN (SELECT id FROM plants WHERE plant_name = $1)`, [tag])
    await dbQuery(`DELETE FROM audit_logs WHERE label LIKE $1 OR lead_id = ANY($2)`, [`%${tag}%`, leadIds])
  })

  it('stores the main contact and each extra person, with their details', async () => {
    const res = await create({
      contactName: 'Asha Rao', contactEmail: 'asha@example.com',
      extraContacts: [
        { name: 'Vikram Shah', email: 'vikram@example.com', phone: '98765 43210' },
        { name: 'Neha Iyer' },
      ],
    })
    expect(res.status).toBe(201)
    leadIds.push(res.body.lead.id)
    expect(res.body.lead.contact?.contactPersonName).toBe('Asha Rao')
    const extras = res.body.lead.extraContacts.map(e => e.contact)
    expect(extras.map(c => c.contactPersonName).sort()).toEqual(['Neha Iyer', 'Vikram Shah'])
    expect(extras.find(c => c.contactPersonName === 'Vikram Shah')).toMatchObject({ mailId: 'vikram@example.com', contactPersonNumber: '98765 43210' })

    // and they come back from the list too
    const listed = (await api<{ leads: Lead[] }>('/leads', { token: admin })).body.leads.find(l => l.id === res.body.lead.id)
    expect(listed?.extraContacts).toHaveLength(2)
  })

  it('links a person only once, even if listed twice or also as the main contact', async () => {
    const res = await create({
      contactName: 'Asha Rao',
      extraContacts: [{ name: 'asha rao' }, { name: 'Vikram Shah' }, { name: 'VIKRAM SHAH' }],
    })
    expect(res.status).toBe(201)
    leadIds.push(res.body.lead.id)
    expect(res.body.lead.extraContacts.map(e => e.contact.contactPersonName)).toEqual(['Vikram Shah'])
  })

  it('works without any extra contacts, as before', async () => {
    const res = await create({ contactName: 'Solo Person' })
    expect(res.status).toBe(201)
    leadIds.push(res.body.lead.id)
    expect(res.body.lead.extraContacts).toEqual([])
  })

  it('refuses an extra contact without a name, or with a bad email', async () => {
    const noName = await create({ extraContacts: [{ name: '', email: 'x@example.com' }] })
    expect(noName.status).toBe(400)
    expect(noName.body.error).toContain('name')
    const badEmail = await create({ extraContacts: [{ name: 'Someone', email: 'not-an-email' }] })
    expect(badEmail.status).toBe(400)
  })
})

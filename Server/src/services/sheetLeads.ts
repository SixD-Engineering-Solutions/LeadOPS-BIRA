// Turns the Tracker's sheet rows into real Leads, Proposals and Projects, so the
// people named in the sheet see them on their dashboard, Leads, Proposals and
// Projects pages (and admins see all of them) — everything in the app follows
// the lead's assignee, so there is nothing else to wire up.
//
// Runs after every sheet sync. Rules:
//   • One lead per sheet row, found again next time by `Lead.sheetKey`
//     (client | location | description), so a later sync updates the same lead
//     rather than creating another.
//   • "Assigned to" = the user whose first name is the sheet's Owner (first
//     name that matches an active employee; admins can't be assigned leads).
//     "BM" = the same, from the sheet's BM/Contact column, any active user.
//     No match → left blank; admins see it under Unassigned.
//   • The sheet is only applied again when that row changed since last time
//     (`Lead.sheetHash`) — an edit made in the app to a lead whose sheet row
//     hasn't changed is kept.
//   • A row marked PO Received / Won gets a Won proposal and its Project, so it
//     counts as an order and as an active project.
//   • Leads are never deleted or recreated by the sync: a lead deleted in the
//     app stays deleted, a row removed from the sheet leaves its lead alone.
//   • Switch off with SHEET_SYNC_CREATE_LEADS=off.
//   • The Tracker's own pipeline rows are not touched, and these leads are not
//     mirrored back into it (they'd appear twice) — see syncLeadToPipeline.
import crypto from 'crypto'
import { prisma } from '../prisma'
import { Prisma } from '../generated/prisma/client'
import { nextSequenceNumber, TX_OPTS } from '../utils/sequence'
import { ROLES, isAssignableRole } from '../utils/roles'

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
const ci = (value: string) => ({ equals: value, mode: 'insensitive' as const })
const titleCase = (s: string) => clean(s).toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase())
const norm = (s: string | null | undefined) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export type SheetOutcome = { lead: string; proposal: string | null }

// Sheet status wording → the app's lead status and proposal status.
export function mapSheetStatus(raw: string | null | undefined, hasValue: boolean): SheetOutcome {
  const s = clean(raw).replace(/[^\w ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (/\b(lost|dropped|cancel+ed)\b/.test(s)) return { lead: 'Lost', proposal: 'Lost' }
  if (/(po|order) received|\bwon\b|order won|completed|delivered/.test(s)) return { lead: 'Qualified', proposal: 'Won' }
  if (/quoted by|to be quoted|\bdraft\b/.test(s)) return { lead: 'Hot', proposal: 'Draft' }
  if (/\bhold\b/.test(s)) return { lead: 'Follow-up', proposal: 'Hold' }
  if (/negotiat/.test(s)) return { lead: 'Hot', proposal: 'Negotiation' }
  if (/budgetary/.test(s)) return { lead: 'Qualified', proposal: 'Proposal submitted' }
  if (/\b(bid|tender)\b/.test(s)) return { lead: 'Qualified', proposal: 'Tender submitted' }
  if (/quot|submit/.test(s)) return { lead: 'Qualified', proposal: 'Submitted' }
  return { lead: 'Cold call', proposal: hasValue ? 'Draft' : null }
}

// The sheet row's identity: same client, place and description = same lead.
// Rows that are identical on all three get a numbered suffix, in sheet order.
export function sheetRowKeys(rows: { client: string | null; location: string | null; description: string | null }[]): string[] {
  const seen = new Map<string, number>()
  return rows.map(r => {
    const base = [norm(r.client), norm(r.location), norm(r.description)].join('|')
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n === 1 ? base : `${base}#${n}`
  })
}

type UserLite = { id: string; userName: string | null; email: string; role: string }

// The first name in "Yash/Vaibhav", "Suraj+Yash", "yash/suraj" … that is a user's
// first name (or whole name / email name). `allow` filters who may be chosen.
export function matchUser(raw: string | null | undefined, users: UserLite[], allow: (u: UserLite) => boolean = () => true): UserLite | null {
  const tokens = clean(raw).split(/[\/+,&]|\band\b/i).map(t => norm(t)).filter(Boolean)
  for (const t of tokens) {
    const hit = users.filter(allow).find(u => {
      const name = norm(u.userName)
      return name === t || name.split(' ')[0] === t || norm(u.email.split('@')[0]).split(' ')[0] === t
    })
    if (hit) return hit
  }
  return null
}

// Won rows become projects: "In Progress" unless the sheet says it hasn't started.
export function projectStatusFor(sheetText: string): 'In Progress' | 'Not Started' {
  return /not\s*start/i.test(sheetText) ? 'Not Started' : 'In Progress'
}

type Row = Awaited<ReturnType<typeof loadRows>>[number]
const loadRows = () => prisma.pipelineTrackerItem.findMany({
  where: { sourceLeadId: null, client: { not: null } },
  orderBy: { sortOrder: 'asc' },
})

// Headings, section titles and totals aren't deals.
const isDeal = (r: Row) => {
  const client = clean(r.client)
  if (!client || /^(total|grand total|sub ?total)\b/i.test(client)) return false
  return !!(clean(r.status) || clean(r.description) || r.valueLakhs != null)
}

async function findOrCreate<T>(find: () => Promise<T | null>, create: () => Promise<T>): Promise<T> {
  return (await find()) ?? create()
}

let running = false

export type SheetLeadsResult = { created: number; updated: number; unchanged: number; unassigned: number }

export async function syncLeadsFromSheet(): Promise<SheetLeadsResult | null> {
  if ((process.env.SHEET_SYNC_CREATE_LEADS ?? '').trim().toLowerCase() === 'off') return null
  if (running) return null
  running = true
  try {
    const all = (await loadRows()).filter(isDeal)
    const keys = sheetRowKeys(all)
    const [users, statuses, admin] = await Promise.all([
      prisma.user.findMany({ where: { isActive: true }, select: { id: true, userName: true, email: true, role: true } }),
      prisma.leadStatus.findMany(),
      prisma.user.findFirst({ where: { role: ROLES.admin, isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } }),
    ])
    if (!admin) { console.error('[sheet leads] no active admin to create leads as — skipped'); return null }
    const statusId = (name: string) => statuses.find(s => s.statusName.toLowerCase() === name.toLowerCase())?.id ?? null
    const result: SheetLeadsResult = { created: 0, updated: 0, unchanged: 0, unassigned: 0 }

    for (const [i, r] of all.entries()) {
      try {
        const key = keys[i]
        const valueRupees = r.valueLakhs != null ? Math.round(r.valueLakhs * 100000) : null
        const out = mapSheetStatus(r.status, valueRupees != null)
        const owner = matchUser(r.owner, users, u => isAssignableRole(u.role))
        const bm = matchUser(r.bmContact, users)
        const hash = crypto.createHash('sha1').update(JSON.stringify([r.client, r.location, r.description, r.valueLakhs, r.status, r.probabilityPct, r.owner, r.bmContact, r.expectedClose, r.followUpDate, r.notes])).digest('hex')

        const existing = await prisma.lead.findUnique({ where: { sheetKey: key }, select: { id: true, sheetHash: true, deletedAt: true } })
        if (existing?.deletedAt) { result.unchanged++; continue }
        if (existing && existing.sheetHash === hash) { result.unchanged++; continue }

        const clientName = clean(r.client), city = titleCase(clean(r.location))
        const description = clean(r.description)
        const notes = [description, clean(r.expectedClose) && `Expected: ${clean(r.expectedClose)}`, clean(r.bmContact) && `BM/contact: ${clean(r.bmContact)}`, clean(r.followUpDate) && `Follow-up: ${clean(r.followUpDate)}`, clean(r.notes)].filter(Boolean).join(' · ')
        const remark = `From the tracker sheet. ${notes}`.trim()
        const lostReason = out.lead === 'Lost' ? 'Marked lost in the tracker sheet (reason not recorded)' : null
        const projectState = projectStatusFor([r.expectedClose, r.followUpDate, r.lastAction, r.notes, r.status].filter(Boolean).join(' '))

        const lead = {
          statusId: statusId(out.lead),
          assignedToUserId: owner?.id ?? null,
          assignedByUserId: owner ? admin.id : null,
          bmUserId: bm?.id ?? null,
          remark, lostReason, sheetHash: hash,
        }
        const proposalData = out.proposal ? {
          status: out.proposal, value: valueRupees, probabilityPct: r.probabilityPct,
          projectName: description || null,
          lostReason: out.proposal === 'Lost' ? lostReason : null,
          decidedAt: out.proposal === 'Won' || out.proposal === 'Lost' ? new Date() : null,
        } : null

        if (!existing) {
          const client = await findOrCreate(() => prisma.client.findFirst({ where: { clientName: ci(clientName) } }), () => prisma.client.create({ data: { clientName } }))
          const location = city ? await findOrCreate(() => prisma.location.findFirst({ where: { city: ci(city) } }), () => prisma.location.create({ data: { city } })) : null
          const plantName = city && !clientName.toLowerCase().includes(city.toLowerCase()) ? `${clientName} ${city}` : clientName
          const plant = await findOrCreate(() => prisma.plant.findFirst({ where: { plantName: ci(plantName) } }), () => prisma.plant.create({ data: { plantName, clientId: client.id, locationId: location?.id ?? null } }))
          await prisma.$transaction(async tx => {
            const created = await tx.lead.create({ data: { ...lead, sheetKey: key, plantId: plant.id, createdByUserId: admin.id } })
            if (proposalData) await createProposalAndProject(tx, created.id, proposalData, admin.id, owner?.id ?? null, plant.locationId, plant.plantName, projectState)
          }, TX_OPTS)
          result.created++
        } else {
          await prisma.$transaction(async tx => {
            const current = await tx.lead.update({ where: { id: existing.id }, data: lead, select: { id: true, plant: { select: { plantName: true, locationId: true } } } })
            if (proposalData) {
              const proposal = await tx.proposal.findFirst({ where: { leadId: current.id, deletedAt: null }, orderBy: { createdAt: 'desc' } })
              if (proposal) {
                await tx.proposal.update({ where: { id: proposal.id }, data: proposalData })
                if (proposalData.status === 'Won') await ensureProject(tx, current.id, proposal.id, proposalData.projectName, admin.id, owner?.id ?? null, current.plant.locationId, current.plant.plantName, projectState)
              } else {
                await createProposalAndProject(tx, current.id, proposalData, admin.id, owner?.id ?? null, current.plant.locationId, current.plant.plantName, projectState)
              }
            }
          }, TX_OPTS)
          result.updated++
        }
        if (!owner) result.unassigned++
      } catch (e) {
        console.error(`[sheet leads] row ${r.sortOrder} (${clean(r.client)}) skipped:`, e instanceof Error ? e.message : e)
      }
    }
    return result
  } finally {
    running = false
  }
}

type ProposalData = { status: string; value: number | null; probabilityPct: number | null; projectName: string | null; lostReason: string | null; decidedAt: Date | null }

async function createProposalAndProject(
  tx: Prisma.TransactionClient, leadId: string, data: ProposalData, adminId: string,
  ownerId: string | null, locationId: string | null, plantName: string, projectState: 'In Progress' | 'Not Started',
) {
  const proposal = await tx.proposal.create({
    data: { ...data, proposalNumber: await nextSequenceNumber(tx, 'proposal', 'PROP'), leadId, createdByUserId: adminId },
  })
  if (data.status === 'Won') await ensureProject(tx, leadId, proposal.id, data.projectName, adminId, ownerId, locationId, plantName, projectState)
}

// One project per lead (same rule as marking a proposal Won in the app).
async function ensureProject(
  tx: Prisma.TransactionClient, leadId: string, proposalId: string, projectName: string | null, adminId: string,
  ownerId: string | null, locationId: string | null, plantName: string, projectState: 'In Progress' | 'Not Started',
) {
  const has = await tx.project.findFirst({ where: { leadId, deletedAt: null } })
  if (has) {
    if (!has.proposalId) await tx.project.update({ where: { id: has.id }, data: { proposalId } })
    return
  }
  await tx.project.create({
    data: {
      workOrderNo: await nextSequenceNumber(tx, 'project', 'WO'), proposalId, leadId, projectName: projectName || plantName,
      locationId, responsibleUserId: ownerId, status: projectState, createdByUserId: adminId,
    },
  })
}

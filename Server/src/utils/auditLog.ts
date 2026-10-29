import { Prisma } from '../generated/prisma/client'
import { prisma } from '../prisma'

// The admin Activity log (AuditLog): who created, changed or deleted which
// lead, proposal, project or invoice, and when — with every changed field's
// value before and after. Each record type is turned into a readable
// "snapshot" (Status, Assigned to, Value…); comparing two snapshots gives the
// list of changes. Writing an entry never fails the request that made the
// change — a log that can't be written is reported, not raised.

export type Entity = 'lead' | 'proposal' | 'project' | 'invoice'
export type Action = 'created' | 'updated' | 'deleted' | 'payment' | 'payment voided'
type Value = string | null
export type Snapshot = Record<string, Value>
type Change = { field: string; from: Value; to: Value }

type Person = { userName: string | null; email: string } | null | undefined
const person = (u: Person) => (u ? u.userName || u.email : null)
const text = (v: unknown) => (v == null || v === '' ? null : String(v).trim() || null)
const day = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null)
const inr = (n: unknown) => (n == null ? null : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`)

// ── Snapshots: what an admin would want to see change, as plain text ─────────

type LeadLike = {
  plant?: { plantName: string; client?: { clientName: string } | null; location?: { city: string } | null } | null
  status?: { statusName: string } | null
  assignedToUser?: Person
  bmUser?: Person
  vertical?: { verticalName: string } | null
  sector?: { sectorName: string } | null
  source?: { sourceName: string } | null
  serviceType?: { serviceTypeName: string } | null
  contact?: { contactPersonName: string | null } | null
  remark?: string | null
  lostReason?: string | null
}
export const leadSnapshot = (l: LeadLike): Snapshot => ({
  Plant: text(l.plant?.plantName),
  Client: text(l.plant?.client?.clientName),
  City: text(l.plant?.location?.city),
  Status: text(l.status?.statusName),
  'Assigned to': person(l.assignedToUser),
  'BM/Contact': person(l.bmUser),
  Vertical: text(l.vertical?.verticalName),
  Sector: text(l.sector?.sectorName),
  Source: text(l.source?.sourceName),
  'Service type': text(l.serviceType?.serviceTypeName),
  Contact: text(l.contact?.contactPersonName),
  Remark: text(l.remark),
  'Reason lost': text(l.lostReason),
})

type ProposalLike = {
  value?: unknown; status?: string | null; probabilityPct?: number | null; submissionDate?: Date | null
  expectedOrderDate?: Date | null; projectName?: string | null; lostReason?: string | null
}
export const proposalSnapshot = (p: ProposalLike): Snapshot => ({
  Value: inr(p.value),
  Status: text(p.status),
  Probability: p.probabilityPct == null ? null : `${p.probabilityPct}%`,
  'Submission date': day(p.submissionDate),
  'Expected order': day(p.expectedOrderDate),
  'Project name': text(p.projectName),
  'Reason lost': text(p.lostReason),
})

type ProjectLike = {
  projectName?: string | null; status?: string | null; billingStage?: string | null; responsibleUser?: Person
  startDate?: Date | null; completionDate?: Date | null; location?: { city: string } | null
}
export const projectSnapshot = (p: ProjectLike): Snapshot => ({
  'Project name': text(p.projectName),
  Status: text(p.status),
  'Billing stage': text(p.billingStage),
  Engineer: person(p.responsibleUser),
  Start: day(p.startDate),
  Completion: day(p.completionDate),
  Location: text(p.location?.city),
})

type InvoiceLike = { amount?: unknown; status?: string | null; invoiceDate?: Date | null; dueDate?: Date | null }
export const invoiceSnapshot = (i: InvoiceLike): Snapshot => ({
  Amount: inr(i.amount),
  Status: text(i.status),
  'Invoice date': day(i.invoiceDate),
  'Due date': day(i.dueDate),
})

// ── Labels: how a record is named in the log ────────────────────────────────

export const leadLabel = (l: LeadLike) => [l.plant?.plantName, l.plant?.client?.clientName].filter(Boolean).join(' · ') || 'Lead'
export const proposalLabel = (p: { proposalNumber: string; lead?: { plant?: { plantName: string } | null } | null }) =>
  [p.proposalNumber, p.lead?.plant?.plantName].filter(Boolean).join(' · ')
export const projectLabel = (p: { workOrderNo: string; projectName?: string | null }) => [p.workOrderNo, p.projectName].filter(Boolean).join(' · ')
export const invoiceLabel = (i: { invoiceNumber: string; project?: { workOrderNo: string } | null }) =>
  [i.invoiceNumber, i.project?.workOrderNo].filter(Boolean).join(' · ')

// The fields that differ between two snapshots; for a new record, every
// field that has a value; for a deleted one, nothing (the label says it all).
export function diff(before: Snapshot | null, after: Snapshot | null): Change[] {
  const keys = Object.keys(after ?? before ?? {})
  return keys
    .map(field => ({ field, from: before ? before[field] ?? null : null, to: after ? after[field] ?? null : null }))
    .filter(c => (before && after ? c.from !== c.to : after ? c.to != null : false))
}

const nameCache = new Map<string, string>()
async function nameOf(userId: string | undefined): Promise<string> {
  if (!userId) return 'System'
  const cached = nameCache.get(userId)
  if (cached) return cached
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { userName: true, email: true } })
  const name = u ? u.userName || u.email : 'Unknown user'
  nameCache.set(userId, name)
  return name
}

// Records one entry. An update that changed nothing visible isn't recorded.
export async function logActivity(entry: {
  userId: string | undefined
  entity: Entity
  entityId: string
  label: string
  leadId?: string | null
  action: Action
  before?: Snapshot | null
  after?: Snapshot | null
  summary?: string
}): Promise<void> {
  try {
    const changes = diff(entry.before ?? null, entry.after ?? null)
    if (entry.action === 'updated' && changes.length === 0) return
    await prisma.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        userName: await nameOf(entry.userId),
        entity: entry.entity,
        entityId: entry.entityId,
        label: entry.label,
        leadId: entry.leadId ?? null,
        action: entry.action,
        summary: entry.summary ?? null,
        changes: changes as unknown as Prisma.InputJsonValue,
      },
    })
  } catch (err) {
    console.error('[activity log] could not record:', err instanceof Error ? err.message : err)
  }
}

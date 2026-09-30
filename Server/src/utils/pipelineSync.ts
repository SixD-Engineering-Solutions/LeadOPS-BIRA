import { prisma } from '../prisma'
import { Prisma } from '../generated/prisma/client'

type Db = typeof prisma | Prisma.TransactionClient

// Runs a tracker-sync call and never lets it fail the request that triggered
// it — worst case the Tracker mirror lags until the next event resyncs it.
// Always call it *after* a transaction commits, never inside one: the sync's
// extra reads/writes pushed a tightly-tuned concurrent transaction (see
// TX_OPTS) past its timeout when it briefly ran inside one, which
// tests/concurrency.test.ts caught.
export function syncTrackerBestEffort(fn: () => Promise<void>): Promise<void> {
  return fn().catch(err => console.error('Tracker sync failed:', err instanceof Error ? err.message : err))
}

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)
const person = (u: { userName: string | null; email: string } | null) => (u ? u.userName || u.email : null)

// Mirrors a lead into `PipelineTrackerItem` (the Tracker's Pipeline) from the
// moment it's created until it's deleted — one row per lead, keyed by
// `sourceLeadId`, refreshed as the lead picks up a proposal, a project, an
// invoice and activities. Only fields the app actually has data for are
// filled; everything else stays blank. `sourceLeadId` also marks the row as
// live-synced (vs. `null` for the imported Excel rows), which the client uses
// to list these rows separately from the imported ones.
export async function syncLeadToPipeline(db: Db, leadId: string): Promise<void> {
  const lead = await db.lead.findUnique({
    where: { id: leadId },
    include: {
      vertical: { select: { verticalName: true } },
      serviceType: { select: { serviceTypeName: true } },
      contact: { select: { contactPersonName: true } },
      assignedToUser: { select: { userName: true, email: true } },
      status: { select: { statusName: true } },
      plant: { select: { plantName: true, client: { select: { clientName: true } }, location: { select: { city: true } } } },
      proposals: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { status: true, value: true, probabilityPct: true, expectedOrderDate: true, lostReason: true },
      },
      projects: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          status: true,
          billingStage: true,
          completionDate: true,
          location: { select: { city: true } },
          invoices: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, createdAt: true } },
        },
      },
      activities: {
        orderBy: { activityDate: 'desc' },
        take: 20,
        select: { activityType: true, activityDate: true, nextActionDate: true },
      },
    },
  })

  if (!lead || lead.deletedAt) {
    await db.pipelineTrackerItem.deleteMany({ where: { sourceLeadId: leadId } })
    return
  }

  const proposal = lead.proposals[0] ?? null
  const project = lead.projects[0] ?? null
  const lastActivity = lead.activities[0] ?? null
  const nextFollowUp = lead.activities.find(a => a.nextActionDate)?.nextActionDate ?? null

  // Status is "<stage>:<that record's own status>" for the furthest stage
  // reached — the most recent invoice on any of its projects, else its latest
  // project, else its latest proposal, else the lead itself.
  const invoice = lead.projects
    .flatMap(p => p.invoices)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
  const status = invoice
    ? `Invoice: ${invoice.status}`
    : project
      ? `Project: ${project.status}`
      : proposal
        ? `Proposal: ${proposal.status}`
        : lead.status ? `Lead: ${lead.status.statusName}` : 'Lead'
  const valueLakhs = proposal?.value != null ? Math.round((Number(proposal.value) / 100000) * 100) / 100 : null

  const data = {
    sourceLeadId: lead.id,
    sortOrder: -1, // ahead of every imported row (sortOrder >= 0)
    vertical: lead.vertical?.verticalName ?? null,
    client: lead.plant.client?.clientName ?? lead.plant.plantName,
    location: project?.location?.city ?? lead.plant.location?.city ?? null,
    service: lead.serviceType?.serviceTypeName ?? null,
    description: lead.remark?.trim() || null,
    valueLakhs,
    currency: valueLakhs != null ? 'INR' : null,
    status,
    probabilityPct: project ? 100 : proposal?.probabilityPct ?? null,
    expectedClose: day(project?.completionDate) ?? day(proposal?.expectedOrderDate),
    owner: person(lead.assignedToUser),
    bmContact: lead.contact?.contactPersonName ?? null,
    followUpDate: day(nextFollowUp),
    lastAction: lastActivity
      ? `${lastActivity.activityType} · ${day(lastActivity.activityDate)}`
      : project ? `Billing: ${project.billingStage}` : null,
    // Why it was lost, when it was — otherwise just where the row came from.
    notes: (proposal?.status === 'Lost' && proposal.lostReason)
      ? `Lost: ${proposal.lostReason}`
      : lead.lostReason ? `Lost: ${lead.lostReason}` : 'Auto-synced from a lead in the app.',
  }

  await db.pipelineTrackerItem.upsert({
    where: { sourceLeadId: lead.id },
    create: data,
    update: data,
  })
}

// Re-syncs every live lead's Pipeline row. Run once at server start so a
// change to the mapping above reaches rows written by the previous version
// (a row otherwise only refreshes when something happens to its lead), and so
// leads created before this sync existed get their row. One at a time, to
// stay well inside the DB's small connection limit.
export async function resyncAllLeadsToPipeline(): Promise<number> {
  const leads = await prisma.lead.findMany({ where: { deletedAt: null }, select: { id: true } })
  for (const { id } of leads) await syncTrackerBestEffort(() => syncLeadToPipeline(prisma, id))
  return leads.length
}

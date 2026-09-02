import { prisma } from '../prisma'
import { notifyUser } from './notify'

const CHECK_INTERVAL_MS = 15 * 60 * 1000

/**
 * Notify the assigned user for each lead whose most recent follow-up
 * (nextActionDate) has arrived or passed. Only the latest activity per lead
 * counts — same rule as GET /activities/follow-ups — so a lead that's
 * already been followed up on doesn't keep re-alerting on stale activities.
 * dueNotifiedAt marks an activity as already alerted so restarts/interval
 * ticks don't send the same reminder twice.
 */
export async function checkFollowUpReminders(): Promise<void> {
  const activities = await prisma.activity.findMany({
    where: { nextActionDate: { not: null }, lead: { deletedAt: null } },
    include: { lead: { select: { id: true, assignedToUserId: true, plant: { select: { plantName: true } } } } },
    orderBy: [{ leadId: 'asc' }, { activityDate: 'desc' }],
  })

  const latestByLead = new Map<string, (typeof activities)[number]>()
  for (const a of activities) if (!latestByLead.has(a.leadId)) latestByLead.set(a.leadId, a)

  const now = new Date()
  for (const activity of latestByLead.values()) {
    if (activity.dueNotifiedAt) continue
    if (activity.nextActionDate! > now) continue
    if (!activity.lead.assignedToUserId) continue

    await notifyUser(
      activity.lead.assignedToUserId,
      `Follow-up due: ${activity.lead.plant.plantName} — action needed`,
      activity.leadId,
    ).catch(err => console.error('notifyUser failed:', err.message))

    await prisma.activity.update({ where: { id: activity.id }, data: { dueNotifiedAt: now } })
  }
}

export function startFollowUpReminderJob(): void {
  checkFollowUpReminders().catch(err => console.error('checkFollowUpReminders failed:', err.message))
  setInterval(() => {
    checkFollowUpReminders().catch(err => console.error('checkFollowUpReminders failed:', err.message))
  }, CHECK_INTERVAL_MS)
}

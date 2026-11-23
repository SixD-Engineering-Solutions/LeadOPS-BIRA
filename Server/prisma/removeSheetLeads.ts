// Removes every lead the Tracker sheet sync created (the ones with a sheet link),
// with their proposals and projects — the undo for services/sheetLeads.ts.
//
//   npx ts-node prisma/removeSheetLeads.ts           → shows what would be removed
//   npx ts-node prisma/removeSheetLeads.ts --apply   → removes it
//
// A lead that has since gained an invoice, a document or a task is left alone
// (listed as skipped) so nothing real is lost. To stop the sync creating them
// again, set SHEET_SYNC_CREATE_LEADS=off.
import 'dotenv/config'
import { prisma } from '../src/prisma'

async function main() {
  const apply = process.argv.includes('--apply')
  const leads = await prisma.lead.findMany({
    where: { sheetKey: { not: null } },
    select: { id: true, plant: { select: { plantName: true } }, _count: { select: { documents: true, activities: true } }, projects: { select: { id: true, _count: { select: { invoices: true } } } } },
  })
  const keep = leads.filter(l => l.projects.some(p => p._count.invoices > 0) || l._count.documents > 0)
  const remove = leads.filter(l => !keep.includes(l))
  for (const l of keep) console.log(`skipped (has invoices or documents): ${l.plant.plantName}`)
  console.log(`${remove.length} sheet-created leads ${apply ? 'removed' : 'would be removed'}${keep.length ? `, ${keep.length} skipped` : ''}.`)
  if (!apply) return
  const ids = remove.map(l => l.id)
  await prisma.pipelineTrackerItem.deleteMany({ where: { sourceLeadId: { in: ids } } })
  await prisma.notification.deleteMany({ where: { leadId: { in: ids } } })
  await prisma.activity.deleteMany({ where: { leadId: { in: ids } } })
  await prisma.project.deleteMany({ where: { leadId: { in: ids } } })
  await prisma.proposal.deleteMany({ where: { leadId: { in: ids } } })
  await prisma.lead.deleteMany({ where: { id: { in: ids } } })
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())

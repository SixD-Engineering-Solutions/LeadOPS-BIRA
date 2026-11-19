// Turns the Tracker's imported Pipeline rows into real Leads and Proposals, so
// the dashboard, Leads and Proposals pages show them. Reversible:
//
//   npx ts-node prisma/importSheetAsLeads.ts            → dry run, prints the mapping
//   npx ts-node prisma/importSheetAsLeads.ts --apply    → creates them
//   npx ts-node prisma/importSheetAsLeads.ts --undo     → removes exactly what --apply made
//
// Every record it creates is listed in prisma/data/sheet-lead-import.json (the
// undo reads that), and every lead's remark starts with "[Sheet row N]".
// The Tracker rows themselves are not touched.
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { prisma } from '../src/prisma'
import { nextSequenceNumber, TX_OPTS } from '../src/utils/sequence'
import { syncLeadToPipeline } from '../src/utils/pipelineSync'

const MANIFEST = path.join(__dirname, 'data', 'sheet-lead-import.json')
type Manifest = { leads: string[]; proposals: string[]; plants: string[]; clients: string[]; locations: string[] }
const ci = (value: string) => ({ equals: value, mode: 'insensitive' as const })

const titleCase = (s: string) => s.trim().toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase())
const clean = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim()

// Sheet status → [lead status, proposal status | null, default probability].
function mapStatus(raw: string | null): { lead: string; proposal: string | null } {
  const s = clean(raw).replace(/[^\w ]/g, '').trim().toLowerCase()
  if (s === 'lost') return { lead: 'Lost', proposal: 'Lost' }
  if (s.startsWith('po received')) return { lead: 'Qualified', proposal: 'Won' }
  if (s.startsWith('bid submit')) return { lead: 'Qualified', proposal: 'Tender submitted' }
  if (s.startsWith('budgetary')) return { lead: 'Qualified', proposal: 'Proposal submitted' }
  if (s.includes('quoted by')) return { lead: 'Hot', proposal: 'Draft' } // "to be quoted this week"
  if (s.startsWith('quoted')) return { lead: 'Qualified', proposal: 'Submitted' }
  return { lead: 'Cold call', proposal: null }
}

async function undo() {
  if (!fs.existsSync(MANIFEST)) { console.log('Nothing to undo (no manifest).'); return }
  const m: Manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  await prisma.pipelineTrackerItem.deleteMany({ where: { sourceLeadId: { in: m.leads } } })
  await prisma.activity.deleteMany({ where: { leadId: { in: m.leads } } })
  await prisma.notification.deleteMany({ where: { leadId: { in: m.leads } } })
  await prisma.proposal.deleteMany({ where: { id: { in: m.proposals } } })
  await prisma.lead.deleteMany({ where: { id: { in: m.leads } } })
  // Shared records it made, only if nothing else has since come to use them.
  const plants = await prisma.plant.findMany({ where: { id: { in: m.plants }, leads: { none: {} }, contacts: { none: {} } }, select: { id: true } })
  await prisma.plant.deleteMany({ where: { id: { in: plants.map(p => p.id) } } })
  const clients = await prisma.client.findMany({ where: { id: { in: m.clients }, plants: { none: {} } }, select: { id: true } })
  await prisma.client.deleteMany({ where: { id: { in: clients.map(c => c.id) } } })
  const locs = await prisma.location.findMany({ where: { id: { in: m.locations }, plants: { none: {} }, projects: { none: {} } }, select: { id: true } })
  await prisma.location.deleteMany({ where: { id: { in: locs.map(l => l.id) } } })
  fs.unlinkSync(MANIFEST)
  console.log(`Undone: ${m.leads.length} leads, ${m.proposals.length} proposals, ${plants.length} plants, ${clients.length} clients, ${locs.length} locations removed.`)
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--undo')) return undo()
  const apply = args.includes('--apply')

  const users = await prisma.user.findMany({ where: { isActive: true } })
  const byFirstName = (raw: string | null) => {
    const first = clean(raw).split(/[\/+,&]| and /i)[0]?.trim().toLowerCase()
    if (!first) return null
    return users.find(u => (u.userName ?? '').toLowerCase().split(' ')[0] === first) ?? null
  }
  const importer = await prisma.user.findUnique({ where: { email: 'di.projects@sixdengineering.com' } })
    ?? users.find(u => u.role === 'admin')!
  const statuses = new Map((await prisma.leadStatus.findMany()).map(s => [s.statusName, s.id]))

  const existing = new Set((await prisma.lead.findMany({ where: { remark: { startsWith: '[Sheet row ' } }, select: { remark: true } }))
    .map(l => /^\[Sheet row (\d+)\]/.exec(l.remark ?? '')?.[1]))
  const rows = await prisma.pipelineTrackerItem.findMany({
    where: { sourceLeadId: null, client: { not: null }, NOT: { vertical: { startsWith: 'FROM BUSINESS', mode: 'insensitive' } } },
    orderBy: { sortOrder: 'asc' },
  })

  const manifest: Manifest = fs.existsSync(MANIFEST)
    ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
    : { leads: [], proposals: [], plants: [], clients: [], locations: [] }
  const made = <T extends { id: string }>(list: string[], row: T, wasNew: boolean) => { if (wasNew && !list.includes(row.id)) list.push(row.id); return row }

  let n = 0
  for (const r of rows) {
    if (existing.has(String(r.sortOrder))) continue
    const clientName = clean(r.client), city = titleCase(clean(r.location))
    const { lead: leadStatus, proposal: propStatus } = mapStatus(r.status)
    const owner = byFirstName(r.owner)
    const value = r.valueLakhs != null ? Math.round(r.valueLakhs * 100000) : null
    const plantName = city && !clientName.toLowerCase().includes(city.toLowerCase()) ? `${clientName} ${city}` : clientName
    const notes = [clean(r.description), r.expectedClose && `Expected: ${clean(r.expectedClose)}`, clean(r.bmContact) && `BM/contact: ${clean(r.bmContact)}`, clean(r.followUpDate) && `Follow-up: ${clean(r.followUpDate)}`].filter(Boolean).join(' · ')
    console.log(`row ${String(r.sortOrder).padStart(2)}  ${plantName.padEnd(34)} ${leadStatus.padEnd(9)} ${(propStatus ?? '-').padEnd(18)} ${String(value ?? '-').padStart(8)}  ${owner?.userName ?? `(no match: "${clean(r.owner)}")`}`)
    n++
    if (!apply) continue

    const client = await prisma.client.findFirst({ where: { clientName: ci(clientName) } })
    const clientRow = client ?? made(manifest.clients, await prisma.client.create({ data: { clientName } }), true)
    let locRow = null
    if (city) {
      const found = await prisma.location.findFirst({ where: { city: ci(city) } })
      locRow = found ?? made(manifest.locations, await prisma.location.create({ data: { city } }), true)
    }
    const plant = await prisma.plant.findFirst({ where: { plantName: ci(plantName) } })
    const plantRow = plant ?? made(manifest.plants, await prisma.plant.create({ data: { plantName, clientId: clientRow.id, locationId: locRow?.id ?? null } }), true)

    const lead = await prisma.lead.create({
      data: {
        plantId: plantRow.id,
        statusId: statuses.get(leadStatus) ?? null,
        assignedToUserId: owner?.id ?? null,
        createdByUserId: importer.id,
        remark: `[Sheet row ${r.sortOrder}] ${notes}`.trim(),
        lostReason: leadStatus === 'Lost' ? 'Marked LOST in the tracker sheet (reason not recorded)' : null,
      },
    })
    manifest.leads.push(lead.id)

    if (propStatus) {
      const proposal = await prisma.$transaction(async tx => {
        const proposalNumber = await nextSequenceNumber(tx, 'proposal', 'PROP')
        return tx.proposal.create({
          data: {
            proposalNumber, leadId: lead.id, projectName: clean(r.description) || null, value,
            status: propStatus, probabilityPct: r.probabilityPct, createdByUserId: importer.id,
            lostReason: propStatus === 'Lost' ? 'Marked LOST in the tracker sheet (reason not recorded)' : null,
            decidedAt: propStatus === 'Won' || propStatus === 'Lost' ? new Date() : null,
          },
        })
      }, TX_OPTS)
      manifest.proposals.push(proposal.id)
    }
    await syncLeadToPipeline(prisma, lead.id)
    fs.mkdirSync(path.dirname(MANIFEST), { recursive: true })
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2))
  }
  console.log(apply ? `\nCreated ${n} leads (manifest: ${MANIFEST}). Undo: npx ts-node prisma/importSheetAsLeads.ts --undo` : `\nDry run: ${n} rows would be imported. Re-run with --apply.`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())

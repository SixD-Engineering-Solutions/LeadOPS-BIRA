// Seeds the reference/lookup tables (verticals, sectors, lead statuses).
// Idempotent: only inserts when a table is empty, so it's safe to re-run.
//
// Run with:  npm run db:seed
import 'dotenv/config'
// Reuse the app's SSL-configured client so this works against managed Postgres
// (e.g. Aiven) without depending on NODE_TLS_REJECT_UNAUTHORIZED.
import { prisma } from '../src/prisma'

const VERTICALS = ['AR/VR', 'Digital Transformation', 'Reverse Engineering', 'AI Automation']
const SECTORS = ['Steel', 'Oil and Gas', 'Power', 'Cement', 'Automotive']
const STATUSES: { name: string; category: string; order: number }[] = [
  { name: 'Submitted', category: 'Open', order: 1 },
  { name: 'In Process', category: 'In Progress', order: 2 },
  { name: 'Dead', category: 'Closed Lost', order: 3 },
]

async function main() {
  if ((await prisma.vertical.count()) === 0) {
    await prisma.vertical.createMany({ data: VERTICALS.map(verticalName => ({ verticalName })) })
    console.log(`seeded ${VERTICALS.length} verticals`)
  } else console.log('verticals already present — skipped')

  if ((await prisma.sector.count()) === 0) {
    await prisma.sector.createMany({ data: SECTORS.map(sectorName => ({ sectorName })) })
    console.log(`seeded ${SECTORS.length} sectors`)
  } else console.log('sectors already present — skipped')

  if ((await prisma.leadStatus.count()) === 0) {
    await prisma.leadStatus.createMany({ data: STATUSES.map(s => ({ statusName: s.name, statusCategory: s.category, displayOrder: s.order })) })
    console.log(`seeded ${STATUSES.length} lead statuses`)
  } else console.log('lead statuses already present — skipped')
}

main()
  .then(() => console.log('seed complete'))
  .catch(e => { console.error('seed failed:', e.message); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())

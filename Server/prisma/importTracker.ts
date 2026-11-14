// Imports a tracker workbook (.xlsx) into the Tracker's sheet rows by hand —
// the same parser and the same safe replace as the daily SharePoint sync
// (src/services/sheetSync.ts): only the sheet's own rows are replaced; rows
// from the app's leads and invoices stay, and the app invoices' amounts are
// added back onto the sector summary.
//
//   npm run db:import-tracker                      → prisma/data/LeadOps sheet.xlsx
//   npm run db:import-tracker -- "C:\path\file.xlsx"
//   npm run db:import-tracker -- file.xlsx --force  → even if it has far fewer rows
//
// The workbook needs a "Pipeline Tracker" tab and an "Invoice & Billing
// Tracker" tab; tabs and columns are found by their names and headings.
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { prisma } from '../src/prisma'
import { parseTrackerWorkbook } from '../src/services/trackerSheet'
import { applySheetData } from '../src/services/sheetSync'

async function main() {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const file = args.find(a => !a.startsWith('--')) ?? path.join(__dirname, 'data', 'LeadOps sheet.xlsx')
  if (!fs.existsSync(file)) throw new Error(`Workbook not found at ${file}`)

  const data = parseTrackerWorkbook(fs.readFileSync(file))
  const c = await applySheetData(data, { force })
  await prisma.sheetSyncRun.create({
    data: { trigger: 'script', status: 'success', finishedAt: new Date(), message: `Imported ${path.basename(file)} by hand`, changes: c as never },
  })
  console.log(`Imported ${c.pipeline.rows} pipeline rows, ${c.register.rows} invoice register rows, ${c.summary.rows} sector summary rows` +
    ` (unchanged: ${c.pipeline.kept}/${c.register.kept}; app invoices re-added to the summary: ${c.appInvoicesReapplied}).`)
}

main()
  .catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())

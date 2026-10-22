import { prisma } from '../prisma'
import { Prisma } from '../generated/prisma/client'
import { recomputeSectorTotals, SUMMARY_TOTAL_SECTOR } from './trackerFields'
import { syncTrackerBestEffort } from './pipelineSync'

type Db = typeof prisma

// Financial-year months as the sector summary's columns, April first.
const MONTHS = ['apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'jan', 'feb', 'mar'] as const
type Month = (typeof MONTHS)[number]
const FY_FIRST_MONTH = 3 // April, as a JS month index

const fyStartOf = (d: Date) => (d.getUTCMonth() >= FY_FIRST_MONTH ? d.getUTCFullYear() : d.getUTCFullYear() - 1)
const fyMonthOf = (d: Date): Month => MONTHS[(d.getUTCMonth() - FY_FIRST_MONTH + 12) % 12]
const monthLabel = (m: Month) => `${m[0].toUpperCase()}${m.slice(1)}`
const round2 = (n: number) => Math.round(n * 100) / 100
const toLakhs = (n: number) => round2(n / 100000)
const DAY_MS = 1000 * 60 * 60 * 24

// Which financial year the sector summary is for: it has months but no year,
// so it's the year most of the imported register's invoices are dated in —
// the same rule the client uses (trackerFyStart in lib/trackerReports.ts).
async function summaryFyStart(db: Prisma.TransactionClient): Promise<number> {
  const rows = await db.invoiceRegisterItem.findMany({ where: { sourceInvoiceId: null, invoiceDate: { not: null } }, select: { invoiceDate: true } })
  const counts = new Map<number, number>()
  for (const r of rows) {
    const y = fyStartOf(r.invoiceDate!)
    counts.set(y, (counts.get(y) ?? 0) + 1)
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]
  return best ? best[0] : fyStartOf(new Date())
}

// What one app invoice adds to the sector summary: its amount, in the month
// of its invoice date, on its sector's row.
type Contribution = { sector: string; month: Month; lakhs: number }

function contributionOf(row: { sector: string | null; invoiceDate: Date | null; invoiceAmountLakhs: number | null } | null, fyStart: number): Contribution | null {
  if (!row?.invoiceDate || !row.invoiceAmountLakhs) return null
  if (fyStartOf(row.invoiceDate) !== fyStart) return null // another year — the summary only covers one
  return { sector: row.sector?.trim() || 'Unspecified', month: fyMonthOf(row.invoiceDate), lakhs: row.invoiceAmountLakhs }
}

const sameContribution = (a: Contribution | null, b: Contribution | null) =>
  a?.sector.toLowerCase() === b?.sector.toLowerCase() && a?.month === b?.month && a?.lakhs === b?.lakhs

// Adds (or with a negative amount, takes back) one contribution on its
// sector's row, then recomputes that row's quarter / FY totals and the TOTAL
// row. A sector with no row yet gets one, just above TOTAL.
async function applyContribution(tx: Prisma.TransactionClient, c: Contribution, sign: 1 | -1, bmOwner: string | null): Promise<void> {
  const rows = await tx.invoiceSectorSummary.findMany({ orderBy: { sortOrder: 'asc' } })
  let row = rows.find(r => r.sector?.trim().toLowerCase() === c.sector.toLowerCase())
  if (!row) {
    if (sign < 0) return // its row was renamed or removed since — nothing left to take back
    const total = rows.find(r => r.sector?.trim().toUpperCase() === SUMMARY_TOTAL_SECTOR)
    const sortOrder = total ? total.sortOrder : (rows[rows.length - 1]?.sortOrder ?? 0) + 1
    if (total) await tx.invoiceSectorSummary.update({ where: { id: total.id }, data: { sortOrder: total.sortOrder + 1 } })
    row = await tx.invoiceSectorSummary.create({ data: { sortOrder, sector: c.sector, bmOwner } })
  }
  await tx.invoiceSectorSummary.update({ where: { id: row.id }, data: { [c.month]: round2((row[c.month] ?? 0) + sign * c.lakhs) } })
  await recomputeSectorTotals(tx, row.id)
}

// Mirrors an app invoice into the Tracker from the moment it's generated
// until it's deleted:
//  - one Invoice Register row, keyed by `sourceInvoiceId`, filled in like the
//    imported sheet's rows and refreshed as payments come in;
//  - its amount in the Sector summary, under its sector and the month of its
//    invoice date (so it counts toward that quarter and the FY total).
//
// The register row also records what the invoice last added to the summary
// (sector, invoice date, amount), so a re-sync first takes that back and then
// adds the current figure — re-running it never counts an invoice twice, and
// a changed amount, date or sector moves the figure rather than piling up.
//
// Call it after the invoice's own transaction commits, via
// syncTrackerBestEffort — see the note there on why it stays out of them.
export async function syncInvoiceToTracker(db: Db, invoiceId: string): Promise<void> {
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      project: {
        include: {
          responsibleUser: { select: { userName: true, email: true } },
          lead: {
            include: {
              assignedToUser: { select: { userName: true, email: true } },
              sector: { select: { sectorName: true } },
              serviceType: { select: { serviceTypeName: true } },
              plant: {
                include: {
                  client: { select: { clientName: true } },
                  location: { select: { city: true } },
                },
              },
            },
          },
        },
      },
      payments: { where: { deletedAt: null }, orderBy: { paymentDate: 'desc' } },
    },
  })

  const person = (u: { userName: string | null; email: string } | null) => (u ? u.userName || u.email : null)
  const bmOwner = invoice ? person(invoice.project.responsibleUser) : null
  let data: Prisma.InvoiceRegisterItemUncheckedCreateInput | null = null

  if (invoice && !invoice.deletedAt) {
    const amount = Number(invoice.amount)
    const paidTotal = invoice.payments.reduce((sum, p) => sum + Number(p.amountReceived), 0)
    const paid = invoice.status === 'Paid'
    // Marked Paid with no (or only partial) real payment behind it — e.g. the
    // status dropdown, hand-set directly rather than via a logged payment.
    // Treat the invoice's own amount as what was collected in that case,
    // rather than showing a contradictory "Paid, ₹0 collected" row; if there
    // IS a real (even partial) payment on record, report that honestly.
    const collected = paid && paidTotal === 0 ? amount : paidTotal
    const lastPaymentDate = invoice.payments[0]?.paymentDate ?? (paid ? new Date() : null)
    // No invoice date set: the day it was generated, so it still lands in a month.
    const invoiceDate = invoice.invoiceDate ?? invoice.createdAt
    const overdue = !paid && (invoice.status === 'Overdue' || (invoice.dueDate != null && invoice.dueDate.getTime() < Date.now()))

    data = {
      sourceInvoiceId: invoice.id,
      sortOrder: -1, // always sorts ahead of every imported row (sortOrder >= 0); the client re-sorts app rows among themselves
      sector: invoice.project.lead.sector?.sectorName.trim() || null,
      client: invoice.project.lead.plant.client?.clientName ?? null,
      location: invoice.project.lead.plant.location?.city ?? null,
      poNumber: invoice.project.workOrderNo,
      orderValueLakhs: toLakhs(amount),
      serviceType: invoice.project.lead.serviceType?.serviceTypeName ?? null,
      bmOwner,
      workCompletionDate: invoice.project.completionDate?.toISOString().slice(0, 10) ?? null,
      invoiceRaised: 'Yes',
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate,
      invoiceAmountLakhs: toLakhs(amount),
      invoiceMonth: monthLabel(fyMonthOf(invoiceDate)),
      dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? null,
      paymentReceived: paid ? 'Yes' : 'No',
      currentManager: person(invoice.project.lead.assignedToUser),
      paymentDate: lastPaymentDate,
      amountCollectedLakhs: collected > 0 ? toLakhs(collected) : null,
      balanceOutstandingLakhs: toLakhs(Math.max(0, amount - collected)),
      daysToCollect: paid && lastPaymentDate ? Math.round((lastPaymentDate.getTime() - invoiceDate.getTime()) / DAY_MS) : null,
      // Same labels the imported sheet uses, so the Reports DSO chart buckets them together.
      dsoStatus: paid ? '🟢 Collected' : overdue ? '🔴 Overdue' : '🟡 Pending',
      remarks: paid && paidTotal === 0
        ? 'Auto-synced from an invoice marked Paid manually in the app (no payment logged).'
        : `Auto-synced from an invoice generated in the app (${invoice.status}).`,
    }
  }

  await db.$transaction(async tx => {
    // One sync at a time touches the summary: its totals are worked out from
    // every row, so two running together could each write a stale TOTAL.
    await tx.$executeRaw`SELECT id FROM invoice_sector_summary FOR UPDATE`
    const fyStart = await summaryFyStart(tx)
    const existing = await tx.invoiceRegisterItem.findUnique({ where: { sourceInvoiceId: invoiceId } })
    const before = contributionOf(existing, fyStart)
    const after = data ? contributionOf({ sector: data.sector ?? null, invoiceDate: data.invoiceDate as Date, invoiceAmountLakhs: data.invoiceAmountLakhs ?? null }, fyStart) : null

    if (!sameContribution(before, after)) {
      if (before) await applyContribution(tx, before, -1, null)
      if (after) await applyContribution(tx, after, 1, bmOwner)
    }

    if (data) await tx.invoiceRegisterItem.upsert({ where: { sourceInvoiceId: invoiceId }, create: data, update: data })
    else if (existing) await tx.invoiceRegisterItem.delete({ where: { id: existing.id } })
  })
}

// Re-syncs every invoice's Tracker rows, deleted ones included (so a deleted
// invoice's figure leaves the summary). Run once at server start so a change
// to the mapping above reaches rows written by the previous version, and so
// invoices generated before this sync existed get counted. One at a time, to
// stay well inside the DB's small connection limit.
// One-time repair, run at server start and marked done in `counters` so it
// never runs twice. Until 2026-10-21, deleting a lead removed its invoices'
// Invoice Register rows directly, without taking their amounts back out of
// the sector summary — so a deleted lead's invoices kept counting in the FY
// totals, the dashboard's target card and the invoicing charts. Those
// leftovers are exactly the deleted invoices stamped with their lead's own
// deletion time (a lead's delete stamps both in one go; an invoice deleted on
// its own gets its own time and was taken back properly) that have no
// register row left. Takes each one's figure back out the same way a normal
// sync would. Returns how many it took back.
const REPAIR_MARK = 'repair:lead-delete-summary'
export async function repairLeadDeletionLeftovers(): Promise<number> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT id FROM invoice_sector_summary FOR UPDATE`
    const done = await tx.counter.findUnique({ where: { name: REPAIR_MARK } })
    if (done) return 0
    const fyStart = await summaryFyStart(tx)
    const deleted = await tx.invoice.findMany({
      where: { deletedAt: { not: null }, project: { lead: { deletedAt: { not: null } } } },
      include: { project: { select: { lead: { select: { deletedAt: true, sector: { select: { sectorName: true } } } } } } },
    })
    const kept = new Set((await tx.invoiceRegisterItem.findMany({ where: { sourceInvoiceId: { in: deleted.map(i => i.id) } }, select: { sourceInvoiceId: true } })).map(r => r.sourceInvoiceId))
    let taken = 0
    for (const inv of deleted) {
      if (inv.deletedAt!.getTime() !== inv.project.lead.deletedAt!.getTime() || kept.has(inv.id)) continue
      const c = contributionOf({ sector: inv.project.lead.sector?.sectorName.trim() || null, invoiceDate: inv.invoiceDate ?? inv.createdAt, invoiceAmountLakhs: toLakhs(Number(inv.amount)) }, fyStart)
      if (!c) continue
      await applyContribution(tx, c, -1, null)
      taken++
    }
    await tx.counter.create({ data: { name: REPAIR_MARK, value: taken } })
    return taken
  }, { maxWait: 10000, timeout: 30000 })
}

export async function resyncAllInvoicesToTracker(): Promise<number> {
  const invoices = await prisma.invoice.findMany({ select: { id: true }, orderBy: { createdAt: 'asc' } })
  for (const { id } of invoices) await syncTrackerBestEffort(() => syncInvoiceToTracker(prisma, id))
  return invoices.length
}

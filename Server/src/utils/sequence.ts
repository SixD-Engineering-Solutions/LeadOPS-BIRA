import { Prisma } from '../generated/prisma/client'
import { prisma } from '../prisma'

// Any client that can run a raw query — either the module-level `prisma`
// singleton, or a `tx` handed to a `prisma.$transaction(async (tx) => ...)`
// callback.
type Db = typeof prisma | Prisma.TransactionClient

// Prisma's interactive-transaction defaults (maxWait ~2s to grab a pooled
// connection, timeout ~5s for the transaction body) are tuned for a pool with
// room to spare. Ours doesn't: this DB's plan caps at 20 total connections,
// and the pool itself only opens 10, so a burst of concurrent writes (several
// people saving around the same moment, or a retried request) can leave a few
// callers queued for a connection or for another transaction's row lock
// (see e.g. the invoice-payment row lock) longer than the default allows —
// they'd fail outright rather than just wait their turn. Pass this to every
// `prisma.$transaction(fn, TX_OPTS)` that touches a counter row or another
// contended lock, so queuing longer is the outcome under a burst, not an
// error — it doesn't use any more connections, just waits longer for the
// same ones.
export const TX_OPTS = { maxWait: 10000, timeout: 10000 }

// Where each numbered sequence lives: the table and its number column.
const SEQUENCES = {
  proposal: { table: 'proposals', column: 'proposal_number' },
  project: { table: 'projects', column: 'work_order_no' },
  invoice: { table: 'invoices', column: 'invoice_number' },
} as const
type SequenceName = keyof typeof SEQUENCES

// Returns the next number in a sequence, formatted as e.g. "INV-0007": one
// more than the highest number still in use. Deleting the newest record
// (or a whole lead with its proposal, project and invoices) frees its number
// for the next one, so numbering carries on without a jump; a number in the
// middle stays a gap rather than being reused out of order.
//
// Deleted records are only hidden (deletedAt) and numbers are unique, so a
// hidden record holding the number being handed out gives it up first — it's
// renamed "INV-0007-deleted-xxxxxxxx". Hidden records can't be restored, so
// nothing visible ever changes number.
//
// Two people creating at the same moment can't get the same number: the
// counter row is locked first, so the second waits until the first has
// committed and then sees its number in use. Call this inside the
// `prisma.$transaction` that creates the row, so the lock covers the create.
export async function nextSequenceNumber(db: Db, name: SequenceName, prefix: string, padLength = 4): Promise<string> {
  const { table, column } = SEQUENCES[name]
  const t = Prisma.raw(`"${table}"`)
  const c = Prisma.raw(`"${column}"`)
  await db.$executeRaw(Prisma.sql`INSERT INTO counters (name, value) VALUES (${name}, 0) ON CONFLICT (name) DO NOTHING`)
  await db.$queryRaw(Prisma.sql`SELECT value FROM counters WHERE name = ${name} FOR UPDATE`)

  const pattern = `^${prefix}-[0-9]+$`
  const [{ highest }] = await db.$queryRaw<{ highest: number | null }[]>(Prisma.sql`
    SELECT MAX(CAST(SUBSTRING(${c} FROM '[0-9]+$') AS INTEGER)) AS highest
    FROM ${t} WHERE deleted_at IS NULL AND ${c} ~ ${pattern}
  `)
  const next = (highest ?? 0) + 1
  const number = `${prefix}-${String(next).padStart(padLength, '0')}`

  await db.$executeRaw(Prisma.sql`
    UPDATE ${t} SET ${c} = ${c} || '-deleted-' || LEFT(id, 8)
    WHERE ${c} = ${number} AND deleted_at IS NOT NULL
  `)
  await db.$executeRaw(Prisma.sql`UPDATE counters SET value = ${next} WHERE name = ${name}`)
  return number
}

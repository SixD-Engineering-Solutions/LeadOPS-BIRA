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

// Atomically returns the next number in a named sequence, formatted as e.g.
// "INV-0007" (first call for a given name starts at 1).
//
// This replaces the old `count() + 1` pattern used for proposal/work-order/
// invoice numbers, which is a read-then-write race: two concurrent requests
// can both read the same count before either has created its row, and both
// compute the same "next" number — one create then fails a unique-constraint
// check (or worse, succeeds and produces a duplicate, if the field weren't
// unique). `INSERT ... ON CONFLICT ... RETURNING` is a single statement that
// Postgres serializes at the row level, so two concurrent callers can never
// be handed the same value, no application-level locking needed.
//
// Pass the transaction client when called from inside `prisma.$transaction`
// so reserving the number and creating the row that uses it succeed or fail
// together as one unit.
export async function nextSequenceNumber(db: Db, name: string, prefix: string, padLength = 4): Promise<string> {
  const rows = await db.$queryRaw<{ value: number }[]>(Prisma.sql`
    INSERT INTO counters (name, value) VALUES (${name}, 1)
    ON CONFLICT (name) DO UPDATE SET value = counters.value + 1
    RETURNING value
  `)
  return `${prefix}-${String(rows[0].value).padStart(padLength, '0')}`
}

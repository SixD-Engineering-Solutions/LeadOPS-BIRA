import fs from 'fs'
import path from 'path'
import { PrismaClient, Prisma } from './generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

// Money columns (Invoice.amount, Payment.amountReceived, Proposal.value,
// Tender.value) are Prisma `Decimal` — exact storage in Postgres, but the
// JS value is a Decimal.js instance, not a plain number. Decimal's default
// `toJSON()` returns a *string* (so `JSON.stringify` doesn't silently lose
// precision), which would turn every one of these fields into a string in
// every API response — a client-visible breaking change nothing asked for.
// One override here keeps every `res.json(...)` in the app returning a plain
// number for these fields, exactly as before the Decimal migration, without
// having to reshape every response by hand.
;(Prisma.Decimal.prototype as unknown as { toJSON(): number }).toJSON = function (this: InstanceType<typeof Prisma.Decimal>) {
  return this.toNumber()
}

// Aiven Postgres presents a certificate issued by this project's own private
// CA, which isn't in the public trust store. Modern `pg` treats
// `sslmode=require` in the URL as full verification, which rejects it — so
// strip sslmode and configure SSL explicitly here.
const connectionString = (process.env.DATABASE_URL ?? '')
  .replace(/([?&])sslmode=[^&]*/i, '$1')
  .replace(/[?&]$/, '')

// The actual fix for that: trust this one specific CA (extracted directly
// from Aiven's own TLS handshake — see README) instead of disabling
// verification outright. `rejectUnauthorized: true` here means a real
// mismatch (wrong host, expired/revoked cert, a genuine MITM) still fails
// the connection; only this project's own Aiven CA is treated as trusted.
// If the database ever moves to a different Aiven project (or provider),
// this file needs regenerating — the pool will fail closed, not silently
// trust nothing, if it's missing or stale.
const caPath = path.join(__dirname, '..', 'certs', 'aiven-ca.pem')
const ca = fs.readFileSync(caPath, 'utf8')

// Build the pool ourselves so we can attach an 'error' listener. When the DB
// drops an idle connection (Aiven flapping / idle timeout), the pool emits
// 'error'; WITHOUT a listener node treats it as unhandled and crashes the whole
// process. Handling it here keeps the server alive — the pool reconnects on the
// next query.
const pool = new Pool({
  connectionString,
  ssl: { ca, rejectUnauthorized: true },
  // Fail fast instead of hanging when the DB is unreachable/flapping.
  connectionTimeoutMillis: 10000, // give up acquiring a connection after 10s
  idleTimeoutMillis: 30000, // drop idle connections after 30s
  max: 10,
})
pool.on('error', (err) => {
  console.error('[db pool] idle client error (recovering):', err.message)
})

const adapter = new PrismaPg(pool)
export const prisma = new PrismaClient({ adapter })

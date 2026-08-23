import { PrismaClient } from './generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

// Aiven Postgres presents a private CA that isn't in the public trust store.
// Modern `pg` treats `sslmode=require` in the URL as full verification, which
// rejects it — so strip sslmode and configure SSL explicitly here. This makes
// the runtime connect reliably without depending on the global
// NODE_TLS_REJECT_UNAUTHORIZED flag (which is lost across ts-node-dev respawns).
const connectionString = (process.env.DATABASE_URL ?? '')
  .replace(/([?&])sslmode=[^&]*/i, '$1')
  .replace(/[?&]$/, '')

// Build the pool ourselves so we can attach an 'error' listener. When the DB
// drops an idle connection (Aiven flapping / idle timeout), the pool emits
// 'error'; WITHOUT a listener node treats it as unhandled and crashes the whole
// process. Handling it here keeps the server alive — the pool reconnects on the
// next query.
const pool = new Pool({
  connectionString,
  // In production supply the Aiven CA instead of disabling verification.
  ssl: { rejectUnauthorized: false },
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

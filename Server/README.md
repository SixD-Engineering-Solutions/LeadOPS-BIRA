# LeadOps Backend

Node.js + Express + TypeScript REST API for the LeadOps application. Handles OTP-verified signup, JWT auth, a normalized lead-management schema (locations → plants → contacts → leads, with verticals, sectors, statuses and assignable users), and PostgreSQL persistence via Prisma.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Language | TypeScript 6 |
| Framework | Express 5 |
| Database | PostgreSQL |
| ORM | Prisma 7 with the `@prisma/adapter-pg` driver adapter (node-postgres pool) |
| Auth | JWT (jsonwebtoken) |
| Password hashing | bcryptjs |
| Email | Nodemailer (SMTP) |
| Validation | Zod 4 |
| Dev server | ts-node-dev |

---

## Folder Structure

```
Backend/
├── prisma/
│   ├── schema.prisma          # All models — see Data Model below for the current set
│   ├── migrations/            # Versioned migration history (see Database Setup)
│   └── seed.ts                # Seeds lookup data (verticals, sectors, lead statuses)
├── prisma.config.ts           # Prisma 7 config — reads DATABASE_URL from .env
├── certs/
│   └── aiven-ca.pem           # This project's Aiven CA cert (see Managed Postgres / SSL below)
├── src/
│   ├── generated/prisma/      # Auto-generated Prisma client (do not edit)
│   ├── routes/                # One file per resource (auth, leads, tasks, activities,
│   │                          #   proposals, projects, invoices, documents, events, tenders,
│   │                          #   reference, notifications, tracker) — see API Reference below
│   ├── middleware/
│   │   └── authenticate.ts    # `authenticate` (JWT guard) + `requireAdmin`
│   ├── services/
│   │   └── email.ts           # Nodemailer OTP email sender
│   ├── utils/
│   │   ├── jwt.ts             # sign/verify helpers for access + verify tokens
│   │   ├── access.ts          # shared `isAdmin`/`canAccessLead`/`canAccessProject` — the one
│   │   │                      #   place every route's visibility check is defined
│   │   ├── errors.ts          # `sendError()` — the one place the `{ error, code }` shape is defined
│   │   └── sequence.ts        # atomic per-entity numbering (PROP-/WO-/INV- prefixes) + `TX_OPTS`
│   ├── prisma.ts              # Prisma client singleton (pg pool + SSL + error handling)
│   └── index.ts               # Express app entry point (CORS, routes, 404/500 fallbacks, safety nets)
├── tests/                     # Integration tests against a live running server — see Testing below
├── .env                       # Environment variables (fill this in)
├── package.json
└── tsconfig.json
```

---

## Environment Setup

Fill in `.env`:

```env
# PostgreSQL connection string
DATABASE_URL="postgresql://user:password@host:5432/dbname?sslmode=require"

# JWT — use a long random string in production
JWT_SECRET="change-me-to-a-long-random-string"
JWT_EXPIRES_IN="7d"

# SMTP (example uses Gmail — use an App Password, not your real password)
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_SECURE="false"
SMTP_USER="your-email@gmail.com"
SMTP_PASS="your-app-password"
FROM_EMAIL="LeadOps <your-email@gmail.com>"

# Server
PORT="3000"
FRONTEND_URL="http://localhost:5173"

# DEV-ONLY: opt-in for the /auth/dev-login bypass. Leave unset (or "false")
# outside local development — it's also hard-blocked whenever NODE_ENV=production
# regardless of this flag.
ENABLE_DEV_LOGIN="true"
```

> **Gmail setup:** Google Account → Security → 2-Step Verification → App passwords → generate one for "Mail" and paste it as `SMTP_PASS`.

### Managed Postgres / SSL (e.g. Aiven)

Aiven issues each project its own private CA and presents a certificate signed by it — modern `pg` treats `sslmode=require` in the URL as full verification, which rejects that private CA, so `src/prisma.ts` **strips `sslmode` from the URL** and configures SSL explicitly instead.

The actual fix is `certs/aiven-ca.pem` — this project's Aiven CA certificate, extracted directly from the server's own TLS handshake (not downloaded from Aiven's dashboard) and committed to the repo, since a CA *certificate* is a public trust anchor, not a secret (unlike a private key). `prisma.ts` loads it and connects with `ssl: { ca, rejectUnauthorized: true }` — real verification, not `rejectUnauthorized: false`. If this project's Aiven CA is ever rotated, or the database moves to a different project/provider, regenerate it:

```js
// One-off: connect once with verification off, walk the presented chain to
// its self-signed root, and save that as PEM.
const tls = require('tls')
const fs = require('fs')
const socket = tls.connect({ host: '<db host>', port: <db port>, rejectUnauthorized: false, servername: '<db host>' }, () => {
  let c = socket.getPeerCertificate(true)
  while (c.issuerCertificate && c.issuerCertificate !== c) c = c.issuerCertificate
  const pem = '-----BEGIN CERTIFICATE-----\n' + c.raw.toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END CERTIFICATE-----\n'
  fs.writeFileSync('certs/aiven-ca.pem', pem)
  socket.destroy()
})
```

The Prisma **CLI** commands (`db:push`, `db:migrate`, `db:studio`) run their own engine outside `src/prisma.ts`, so they need the CA another way: those npm scripts set `NODE_EXTRA_CA_CERTS=./certs/aiven-ca.pem`, which adds it to Node's trust store for that one process — real verification, not the blanket `NODE_TLS_REJECT_UNAUTHORIZED=0` (which disables certificate checking entirely, for every connection that process makes) used before.

---

## Database Setup

### Option A — Docker (local dev)

```powershell
docker run --name leadops-pg `
  -e POSTGRES_PASSWORD=password `
  -e POSTGRES_DB=leadops `
  -p 5432:5432 `
  -d postgres:16
```
Then set `DATABASE_URL="postgresql://postgres:password@localhost:5432/leadops"`.

### Option B — Managed Postgres

Create a database with your provider and paste its connection string into `DATABASE_URL`.

### Create the tables

The schema is tracked as versioned migrations under `prisma/migrations/` (not `db push`):

```powershell
npm run db:migrate:deploy   # apply any pending migrations — the normal path, including first setup
npm run db:migrate:status   # check what's pending without applying anything
```

`npm run db:migrate` (`prisma migrate dev`) is for authoring a *new* migration during local schema
changes — it diffs your edited `schema.prisma` against the database, generates a new migration
file, and applies it. `npm run db:push` still exists for quick, throwaway local iteration (it
doesn't touch `prisma/migrations/` at all), but isn't how schema changes reach a real database —
use a migration for anything that's going to be deployed.

### Seed lookup data

Seeds verticals, sectors, and the three lead statuses (**Submitted / In Process / Dead**). Idempotent — safe to re-run.

```powershell
npm run db:seed
```

Open the visual DB browser:

```powershell
npm run db:studio
```

---

## Running the Server

```powershell
npm run dev
```

Starts on `http://localhost:3000` with hot-reload via `ts-node-dev`.

**CORS:** allows `FRONTEND_URL`, plus any `localhost`/`127.0.0.1` port in development (so it still works when Vite picks 5174/5175).

**Resilience:** the pg pool has an `error` handler and fail-fast connection timeout, and the process has `unhandledRejection`/`uncaughtException` handlers — a flapping database logs and recovers instead of crashing the server.

---

## Testing

```powershell
npm run dev    # in one terminal — the tests are integration tests against a real running server
npm test       # in another
```

`tests/` covers the permission matrix, invoice status/overpayment correctness, and the concurrency guarantees (unique numbering, no duplicate Won→Project conversion, no overpaying an invoice under concurrent requests) added while hardening this backend — not general coverage of every route. Each test creates its own throwaway lead/proposal/project/invoice and cleans it up afterward (soft-delete, same as the app itself), so it's safe to run repeatedly against the real database without accumulating data. `tests/globalSetup.ts` checks `/health` first and fails with a clear message if the dev server isn't running, rather than every test timing out on a connection refused.

---

## Data Model

All tables use snake_case column/table names (mapped from Prisma's camelCase fields). Every table has `created_at` and `updated_at`.

```
Location ──< Plant ──< Contact
                └────< Lead ──→ Vertical
                          ──→ Sector
                          ──→ Contact
                          ──→ User  (assigned_to_user_id)
                          ──→ User  (created_by_user_id)
                          ──→ LeadStatus
```

### `users`
Internal employees **and** login accounts (unified). Leads are assigned to / created by users.

| Field | Type | Notes |
|---|---|---|
| `id` | cuid | PK |
| `userName` | String? | display name |
| `email` | String (unique) | login + identity |
| `phoneNumber` | String? | |
| `role` | String | `admin` or `employee` (default `employee`) |
| `department` | String? | |
| `passwordHash` | String? | bcrypt (nullable — admins can add an employee before they set login) |
| `isActive` | Boolean | default `true` |

### `otp_tokens`
One-time codes for email verification (hashed, 10-minute expiry, single-use).

### `locations`
`city` (required), `state?`, `country?`, `address?`. Has many plants.

### `plants`
`plantName` (required), `companyName?`, `locationId?` (optional link to a location), `plantCode?`, `isActive`. Has many contacts and leads.

### `contacts`
Belongs to a plant. `contactPersonName` (required), `designation?`, `contactPersonNumber?`, `alternateNumber?`, `mailId?`, `isPrimaryContact`.

### `verticals` / `sectors`
Lookup lists. `verticalName`/`sectorName` (required), `description?`, `isActive`. (e.g. AR/VR, Digital Transformation, Reverse Engineering, AI Automation / Steel, Oil and Gas, Power, Cement, Automotive.)

### `lead_statuses`
Configurable statuses. `statusName`, `statusCategory?` (e.g. Open / In Progress / Closed Won / Closed Lost), `displayOrder`, `isActive`. Seeded with **Submitted**, **In Process**, **Dead**.

### `leads` (main table)
`plantId` (required) + optional links: `verticalId`, `sectorId`, `contactId`, `assignedToUserId`, `statusId`. Plus `remark?`, `createdByUserId` (required), and `deletedAt?` for **soft delete** (deleted rows are excluded from reads but kept for audit).

---

## Authentication Flow

3-step signup ensures the user owns the email before an account is created.

```
1. POST /auth/send-otp   { email }                          -> emails a 6-digit OTP
2. POST /auth/verify-otp { email, otp }                     -> { emailVerifiedToken }  (15-min JWT)
3. POST /auth/signup     { emailVerifiedToken, password }   -> { accessToken, user }
```

The `emailVerifiedToken` is a short-lived JWT signed with a separate secret (`JWT_SECRET + '_otp_verify'`) proving email ownership. The access token is only issued once the password is set.

---

## API Reference

JSON in/out. Protected routes need `Authorization: Bearer <accessToken>`.

**Errors** are always `{ error: string, code: string }` — a human-readable message plus a stable,
machine-readable code (`VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`,
`INTERNAL_ERROR`, etc. — one per HTTP status, see `src/utils/errors.ts`), including a JSON 404 for
unmatched routes and a JSON 500 for anything an individual route didn't handle itself. Zod
validation failures return `400`.

### Health
`GET /health` → `{ "status": "ok" }`

### Auth (`/auth`)

| Method & path | Body | Result |
|---|---|---|
| `POST /auth/send-otp` | `{ email }` | `{ message }` · 409 if already registered |
| `POST /auth/verify-otp` | `{ email, otp }` | `{ emailVerifiedToken }` |
| `POST /auth/signup` | `{ emailVerifiedToken, password }` | `201 { accessToken, user }` |
| `POST /auth/login` | `{ email, password }` | `{ accessToken, user }` · 401 on bad creds |
| `POST /auth/dev-login` | — | `{ accessToken, user }` — **dev only** (404 in production); upserts an admin `dev@leadops.local` and returns a token |
| `GET /auth/me` | — (auth) | `{ user }` |

### Leads (`/leads`) — all require auth

| Method & path | Body | Result |
|---|---|---|
| `GET /leads` | — | `{ leads }` — non-deleted, newest first, with plant/contact/vertical/sector/status/assignee joined in |
| `GET /leads/:id` | — | `{ lead }` |
| `POST /leads` | typed names (see below) | `201 { lead }` |
| `PATCH /leads/:id` | `{ statusName?, assignedToUserId?, remark? }` | `{ lead }` |
| `DELETE /leads/:id` | — | `{ message }` — **admin only** (403 otherwise); soft delete |

**Create by name (find-or-create):** `POST /leads` accepts human-typed names and reuses or creates the linked rows (case-insensitive), so the client doesn't need to pre-select IDs:

```json
{
  "plantName": "Bhilai Steel Plant",   // required
  "city": "Bhilai",                     // optional → find/creates a location, links the plant
  "contactName": "R. Sharma",           // optional → find/creates a contact on that plant
  "verticalName": "AI Automation",      // optional
  "sectorName": "Steel",                // optional
  "assignedToName": "Priya",            // optional → matches a user by name/email, else creates one
  "statusName": "Submitted",            // optional → defaults to "Submitted"
  "remark": "inbound enquiry"           // optional
}
```

### Reference / lookups — all require auth

List + create for each supporting table (used to populate dropdowns and manage data):

| Resource | List | Create body |
|---|---|---|
| `GET/POST /locations` | all | `{ city, state?, country?, address? }` |
| `GET/POST /plants` | all (with location) | `{ plantName, companyName?, locationId, plantCode?, isActive? }` |
| `GET/POST /contacts` | `?plantId=` filter | `{ plantId, contactPersonName, designation?, contactPersonNumber?, alternateNumber?, mailId?, isPrimaryContact? }` |
| `GET/POST /verticals` | active | `{ verticalName, description? }` |
| `GET/POST /sectors` | active | `{ sectorName, description? }` |
| `GET/POST /lead-statuses` | active, ordered | `{ statusName, statusCategory?, displayOrder? }` |
| `GET/POST /users` | active employees | `{ email, userName?, phoneNumber?, role?, department? }` |

---

## Roles & Permissions

`user.role` is `admin` or `employee`. `src/utils/access.ts` is the one place the shared checks
(`isAdmin`, `canAccessLead`, `canAccessProject`) are defined — every route imports from there
rather than redefining its own copy.

- **Visibility:** admins see every lead/proposal/project/invoice/document/activity; employees only
  see the ones on leads currently assigned to them. Reference/lookup data (locations, plants,
  verticals, etc.) is visible to everyone.
- **Admin-only actions:** every delete (soft delete — rows persist for audit until removed),
  creating/editing reference data from the Catalog page, managing users (create, role, deactivate/
  reactivate), and voiding a payment. Enforced server-side by `requireAdmin` (or an explicit
  `isAdmin` check where the route also needs to allow the non-admin visibility case), not just
  hidden in the UI.
- Leads/projects/tasks can never be assigned to an admin account — enforced on every create/update
  that sets an assignee, not just at creation.

New signups are `employee` by default; the dev-login account is `admin`.

---

## JWT Details

| Token | Secret | Expiry | Purpose |
|---|---|---|---|
| Access token | `JWT_SECRET` | `JWT_EXPIRES_IN` (default 7d) | Authenticates API requests via `Authorization: Bearer` |
| Email verified token | `JWT_SECRET + '_otp_verify'` | 15 minutes | Proves email ownership during signup only |

---

## npm Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start dev server with hot-reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start` | Run compiled production build |
| `npm run db:migrate:deploy` | Apply any pending migrations — the normal setup/deploy path |
| `npm run db:migrate:status` | Check pending migrations without applying anything |
| `npm run db:migrate` | Author a new migration from a local `schema.prisma` change (`prisma migrate dev`) |
| `npm run db:push` | Sync schema to the database with no migration file — local iteration only |
| `npm run db:generate` | Regenerate the Prisma client |
| `npm run db:seed` | Seed verticals, sectors, and lead statuses |
| `npm run db:studio` | Open the Prisma visual database browser |
| `npm test` | Run the integration test suite (needs `npm run dev` running in another terminal) |

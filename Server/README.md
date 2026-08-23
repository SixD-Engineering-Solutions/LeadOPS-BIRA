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
│   ├── schema.prisma          # All models (users, otp_tokens, locations, plants,
│   │                          #   contacts, verticals, sectors, lead_statuses, leads)
│   └── seed.ts                # Seeds lookup data (verticals, sectors, lead statuses)
├── prisma.config.ts           # Prisma 7 config — reads DATABASE_URL from .env
├── src/
│   ├── generated/prisma/      # Auto-generated Prisma client (do not edit)
│   ├── routes/
│   │   ├── auth.ts            # /auth/*  — signup, login, OTP, dev-login, me
│   │   ├── leads.ts          # /leads/* — lead CRUD (find-or-create, soft delete)
│   │   └── reference.ts      # lookups: locations, plants, contacts, verticals,
│   │                         #   sectors, lead-statuses, users
│   ├── middleware/
│   │   └── authenticate.ts    # `authenticate` (JWT guard) + `requireAdmin`
│   ├── services/
│   │   └── email.ts           # Nodemailer OTP email sender
│   ├── utils/
│   │   └── jwt.ts             # sign/verify helpers for access + verify tokens
│   ├── prisma.ts              # Prisma client singleton (pg pool + SSL + error handling)
│   └── index.ts               # Express app entry point (CORS, routes, safety nets)
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
```

> **Gmail setup:** Google Account → Security → 2-Step Verification → App passwords → generate one for "Mail" and paste it as `SMTP_PASS`.

### Managed Postgres / SSL (e.g. Aiven)

`src/prisma.ts` builds the connection itself: it **strips `sslmode` from the URL** (modern `pg` treats `sslmode=require` as full CA verification, which rejects a managed provider's private CA) and connects with `ssl: { rejectUnauthorized: false }`. This means the runtime connects to providers like Aiven without needing the `NODE_TLS_REJECT_UNAUTHORIZED` flag. For production, supply the provider's CA certificate instead of disabling verification.

The Prisma **CLI** commands (`db:migrate`, `db:generate`, `db:studio`) use a separate engine that still needs the flag, so those npm scripts set `NODE_TLS_REJECT_UNAUTHORIZED=0`.

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

```powershell
npm run db:push        # sync schema -> database (no migration files)
# or, for versioned migrations:
npm run db:migrate
```

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

JSON in/out. Zod validation → invalid requests return `400 { error }`. Protected routes need `Authorization: Bearer <accessToken>`.

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

`user.role` is `admin` or `employee`.

- **Everyone (authenticated):** create/list/update leads, view and add reference data.
- **Admins only:** delete leads (`DELETE /leads/:id`) — enforced by the `requireAdmin` middleware and hidden in the UI for non-admins. Deletes are soft, so entries persist until an admin removes them.

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
| `npm run db:push` | Sync schema to the database (no migration files) |
| `npm run db:migrate` | Apply schema changes as versioned migrations |
| `npm run db:generate` | Regenerate the Prisma client |
| `npm run db:seed` | Seed verticals, sectors, and lead statuses |
| `npm run db:studio` | Open the Prisma visual database browser |

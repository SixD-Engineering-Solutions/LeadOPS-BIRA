# LeadOps — Deployment Checklist (Portainer / Docker)

Audited against the code on 30 Sep 2026 (commit `0ba50b1` + later uncommitted work).
Work top to bottom — every step is either a ☐ to tick or a check with an expected result.

**Verdict: not ready to deploy yet.** There were **8 blockers** (Section 1).
**Update 30 Sep: all 8 blockers (B1–B8) are fixed and verified** (see "Status" in Section 1),
the Docker files in Section 3 are in the repo, and admins can now promote/demote users from the
Team page (two roles: admin / employee). Everything after Section 1 is setup.

---

## 0. How the app will run

```
Browser ──HTTPS──▶ [reverse proxy / Portainer host :443]
                         │
                         ▼
              ┌─────────────────────┐        ┌──────────────────────┐
              │  leadops-web (nginx) │  /api  │  leadops-api (Node)  │
              │  serves React build  ├───────▶│  Express, port 3000  │
              └─────────────────────┘        └──────────┬───────────┘
                                                        │ TLS (Aiven CA)
                                            volume:      ▼
                                          uploads/   Aiven PostgreSQL
                                                    (external, 20-connection cap)
```

- **Two containers**: `leadops-web` (static React app behind nginx) and `leadops-api` (Express).
- nginx forwards `/api/*` to the API, so the browser only ever talks to **one origin**
  (no CORS problems, and the SSE notification stream works through the same host).
- **Run exactly one API container.** Live notifications (SSE) and the 15-minute follow-up
  reminder job live in the process's memory — two replicas would split notifications and
  send every reminder twice.
- The database is **external** (Aiven). It is not part of the stack.

---

## 1. Blockers — fix in code before building  🔴

| # | Problem (what breaks) | Where | Fix |
|---|---|---|---|
| B1 | **Admin backdoor.** `dev@leadops.local` / `devmode123` is a real admin row in the database, and the password is in the source code. Normal `/auth/login` accepts it — even in production, where `/auth/dev-login` itself is off. | `Server/src/routes/auth.ts` (dev-login), `Client/src/lib/devAuth.ts` | ☐ Promote a real person to admin ☐ Deactivate `dev@leadops.local` ☐ Remove the dev-login route and the client dev bypass |
| B2 | **Client production build fails** (`npm run build` stops on 4 type errors), so no deployable client can be produced. | `Client/src/pages/leads.tsx:3` (the app's `Event` type shadows the browser's `Event`), `Client/src/components/tracker/ReportsTab.tsx:165` (tooltip formatter type) | ☐ Rename the import (`Event as ExpoEvent`) ☐ Make the formatter accept any value (`v => \`₹${Number(v)}L\``) ☐ Confirm `npm run build` succeeds |
| B3 | **Employees can edit any lead.** `PATCH /leads/:id` checks the lead exists, not that it's assigned to the caller — any employee who knows an ID can change its status or reassign it to themselves. Every other route checks ownership. | `Server/src/routes/leads.ts` PATCH handler | ☐ Add the same `admin ? {} : { assignedToUserId: req.userId }` condition the other routes use ☐ Decide: may employees reassign leads at all, or admins only? |
| B4 | **Client talks to `localhost` in production.** `BASE_URL` falls back to `http://localhost:3000` unless `VITE_API_URL` is set **at build time** — the deployed app would call each user's own PC and nothing would load. | `Client/src/lib/api.ts:258` | ☐ Build with `VITE_API_URL=/api` (Section 3) |
| B5 | **Uploaded documents are lost on every redeploy.** Files are written inside the container (`/app/uploads/documents`). | `Server/src/routes/documents.ts:32` | ☐ Mount a persistent volume at `/app/uploads` (Section 4) |
| B6 | **Missing `JWT_SECRET` isn't caught.** The server starts anyway; logins then fail, and the email-verification secret silently becomes the guessable string `"undefined_otp_verify"` (anyone could forge a sign-up token). | `Server/src/utils/jwt.ts:3-4` | ☐ Refuse to start unless `JWT_SECRET` (≥ 32 chars), `DATABASE_URL` and `FRONTEND_URL` are set |
| B7 | **No brute-force protection.** Unlimited password attempts, unlimited guesses at the 6-digit sign-up code, and unlimited "send code" requests (inbox flooding / email-quota abuse). | `Server/src/routes/auth.ts` | ☐ Add `express-rate-limit` on `/auth/*` (e.g. 10 attempts / 15 min per IP; 5 codes / hour per email) ☐ Invalidate a code after 5 wrong guesses ☐ Set `app.set('trust proxy', 1)` so limits see the real client IP behind the proxy |
| B8 | **Whole sales sheet is publicly downloadable.** `Client/public/LeadOps sheet.xlsx` is copied into the web build — anyone can fetch `https://<site>/LeadOps%20sheet.xlsx` (clients, values, owners). It's also committed to GitHub. | `Client/public/` | ☐ Move it to `Server/prisma/data/` and update the path in `prisma/importTracker.ts:19` ☐ Confirm the GitHub repo `Sixdengineering/LeadOps` is **private** |

### Status (30 Sep)

| # | Status | How it was fixed · how it was verified |
|---|---|---|
| B1 | ✅ Fixed | `pratham100yadav@gmail.com` is the first admin; `dev@leadops.local` deactivated; `/auth/dev-login` and the client dev bypass (`devAuth.ts`) removed; tests sign a token for a real admin instead · old dev token → 401, `devmode123` login refused, dev-login → 404 |
| B2 | ✅ Fixed | `Event as ExpoEvent` import; tooltip formatter accepts any value · `npm run build` succeeds, 0 type errors |
| B3 | ✅ Fixed | `PATCH /leads/:id` uses the same visibility rule as `GET` (employees: only leads assigned to them — they can still update and hand off their own) · 7 live checks with an employee token all as expected |
| B4 | ✅ Fixed | Production builds default to `/api` (empty `VITE_API_URL` counts as unset) · bundle contains `/api`, zero `localhost:3000` |
| B5 | ✅ Fixed | `/app/uploads` volume in `docker-compose.yml`; optional `UPLOAD_DIR` override · dev path unchanged |
| B6 | ✅ Fixed | `src/utils/env.ts` refuses to start without `DATABASE_URL` / `JWT_SECRET` (≥ 32 chars) / `FRONTEND_URL` (prod), or with `ENABLE_DEV_LOGIN` in prod · all 4 bad configs refused; compose file also refuses to deploy without them |
| B7 | ✅ Fixed | `src/utils/rateLimits.ts` on all `/auth` routes; `trust proxy` = 1 in production · 10 failed logins → 11th gets 429, other clients unaffected |
| B8 | ✅ Fixed | Sheet moved to `Server/prisma/data/`, import script path updated · not present in the web build (repo privacy still to confirm) |

Also done alongside: S5 (`X-Accel-Buffering: no` + nginx `proxy_buffering off`), S9 (`/dist` git-ignored),
and a disallowed browser origin now gets a clean **403** instead of a 500 with a stack trace.

---

## 2. Should fix before go-live  🟡

| # | Issue | Fix |
|---|---|---|
| S1 | **Open sign-up.** Anyone who verifies an email gets an employee account (they see no leads until assigned, but can see the Tracker's sheet data and the employee list). | ☐ Only allow sign-up for emails an admin already added on the Team page (or a company domain) |
| S2 | **No password reset.** A forgotten password needs a database edit. | ☐ Add "forgot password" using the existing email-code flow |
| S3 | **Database connection cap.** The API pool opens up to **10** connections; Aiven allows **20** in total. A local dev server (also 10) pointed at the *same* database exhausts it — this already happened once (all requests failed with "too many connections"). | ☐ Use a **separate database** for development, or ☐ never run a dev server against production ☐ Keep exactly one API container |
| S4 | **Dependency vulnerabilities** (server). `multer` (upload DoS), `nodemailer`, `qs`, `fast-uri` have non-breaking fixes. The rest (`hono`, `mysql2`, `valibot`, …) are inside the **Prisma CLI**, a migration tool — not reachable from the running API. Client: 0. | ☐ `cd Server && npm audit fix` (no `--force`) ☐ Re-run the test suite |
| S5 | **Live notifications stall behind nginx** — the SSE response doesn't send `X-Accel-Buffering: no`. | ☐ Add the header in `routes/notifications.ts`, and/or ☐ `proxy_buffering off` for `/api/notifications/stream` (included in Section 3's nginx config) |
| S6 | **Security headers.** No `helmet`/CSP/HSTS. | ☐ Add `helmet()` to the API, and HSTS + `X-Content-Type-Options` + `X-Frame-Options` in nginx (included in Section 3) |
| S7 | **Test suite partly broken.** `permissions.test.ts` / `invoices.test.ts` need the deleted `arjun.mehta@leadops.local` account. The concurrency suite (5 tests) passes. | ☐ Point them at a dedicated test employee |
| S8 | **Seed script has no production guard.** `npm run db:seed` inserts demo leads/employees. | ☐ Never run it against production (or add a `NODE_ENV === 'production'` refusal) |
| S9 | **Git hygiene.** `Server/dist/` isn't git-ignored; `.playwright-mcp/*.log` browser-test logs are committed. | ☐ Add both to `.gitignore` |

---

## 3. Files to add to the repo

**Now in the repo** (added 30 Sep): `Server/Dockerfile`, `Server/.dockerignore`, `Client/Dockerfile`,
`Client/nginx.conf`, `Client/.dockerignore`, `docker-compose.yml`. The repo versions are the source
of truth — they refine the sketches below (health checks, caching headers, required-variable checks).
Not yet built as images: Docker isn't running on the development PC — build once locally or in
Portainer before relying on them.

☐ **`Server/Dockerfile`**
```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY certs ./certs
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "dist/index.js"]
```
> `tsc` compiles the generated Prisma client into `dist/generated` (verified locally), which is
> why `prisma generate` must run before `npm run build`. Quick check after the first build:
> `docker run --rm <img> ls dist` should list `generated`.

☐ **`Server/.dockerignore`** — `node_modules`, `dist`, `.env`, `uploads`, `tests`

☐ **`Client/Dockerfile`**
```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
```

☐ **`Client/nginx.conf`**
```nginx
server {
  listen 80;
  root /usr/share/nginx/html;
  client_max_body_size 12m;                      # documents are capped at 10 MB

  add_header X-Content-Type-Options nosniff always;
  add_header X-Frame-Options DENY always;
  add_header Referrer-Policy same-origin always;

  location /api/notifications/stream {           # live notifications (SSE)
    proxy_pass http://leadops-api:3000/notifications/stream;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
  }
  location /api/ {
    proxy_pass http://leadops-api:3000/;         # trailing slash strips /api
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
  location / { try_files $uri /index.html; }
}
```

☐ **`docker-compose.yml`** (paste into Portainer → Stacks → Add stack)
```yaml
services:
  leadops-api:
    build: ./Server
    restart: unless-stopped
    environment:
      NODE_ENV: production
      PORT: "3000"
      DATABASE_URL: ${DATABASE_URL}
      JWT_SECRET: ${JWT_SECRET}
      JWT_EXPIRES_IN: 7d
      FRONTEND_URL: ${FRONTEND_URL}          # e.g. https://crm.example.com — exact, no trailing slash
      SMTP_HOST: ${SMTP_HOST}
      SMTP_PORT: ${SMTP_PORT}
      SMTP_SECURE: ${SMTP_SECURE}
      SMTP_USER: ${SMTP_USER}
      SMTP_PASS: ${SMTP_PASS}
      FROM_EMAIL: ${FROM_EMAIL}
      # ENABLE_DEV_LOGIN must NOT be set
    volumes:
      - leadops-uploads:/app/uploads
    deploy:
      replicas: 1                             # see Section 0 — never more than one

  leadops-web:
    build:
      context: ./Client
      args: { VITE_API_URL: /api }
    restart: unless-stopped
    depends_on: [leadops-api]
    ports:
      - "8080:80"                             # put your HTTPS reverse proxy in front of this

volumes:
  leadops-uploads:
```

---

## 4. Configuration & secrets

☐ **`JWT_SECRET`** — generate a new one for production (don't reuse the dev value):
`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
Changing it later logs everyone out (existing tokens stop verifying) — that's expected.

☐ **`DATABASE_URL`** — Aiven connection string. The API trusts only the Aiven CA in
`Server/certs/aiven-ca.pem` (that file is a public certificate, safe to ship in the image).

☐ **Aiven IP allowlist** — add the Portainer host's public IP, or connections will time out.

☐ **`FRONTEND_URL`** — the exact public URL, with `https://`, no trailing slash. With the
`/api` proxy the browser calls the same origin, but CORS still checks this in production.

☐ **SMTP** — required for sign-up codes (and any future password reset). Gmail needs an
*App Password*. Send yourself a test code after deploying (Section 7).

☐ **`ENABLE_DEV_LOGIN`** — **absent** in production.

☐ Enter the secrets as Portainer **stack environment variables**, never in the compose file or the repo.
The `Server/.env` file must not be copied into the image (it's excluded by `.dockerignore`).

☐ **HTTPS** — terminate TLS at your reverse proxy (Nginx Proxy Manager / Traefik / Caddy) in front of port 8080.
Logins and tokens must never travel over plain HTTP.

---

## 5. Database

☐ **Back up first** — take an Aiven backup/snapshot before the first production migration.

☐ **Apply migrations** (once per release, before starting the new API):
```bash
docker compose run --rm leadops-api npx prisma migrate deploy
```
(Prisma needs `NODE_EXTRA_CA_CERTS=/app/certs/aiven-ca.pem` if it can't verify Aiven's certificate —
add it to the command's environment.)

☐ **Check**: `npx prisma migrate status` → *"Database schema is up to date"*. Latest migration
should be `20260930210000_lost_reason`.

☐ **Current data state**: 129 imported pipeline rows, 83 invoice-register rows, 8 sector
summary rows, plus whatever real leads exist. **Do not** run `db:seed`. Only re-run
`db:import-tracker` if you intend to re-import the sheet.

☐ **Numbering** — counters are at the last real record (next: PROP-0002 / WO-0002 / INV-0001
at the time of writing). Old test records keep renamed numbers (`…-DELETED-…`) so nothing clashes.

---

## 6. Deploy in Portainer

1. ☐ Blockers B1–B8 done, committed, pushed.
2. ☐ Portainer → **Stacks → Add stack** → *Repository* (or paste Section 3's compose file).
3. ☐ Add all environment variables from Section 4.
4. ☐ Run migrations (Section 5).
5. ☐ **Deploy the stack**.
6. ☐ `leadops-api` shows **healthy** (the Dockerfile's healthcheck calls `/health`).
7. ☐ API logs show `Server running on http://localhost:3000` and `Pipeline tracker: re-synced N lead(s)`,
   and **no** `Too many database connections` / `[db pool]` errors.
8. ☐ Point the reverse proxy / domain at port 8080 with HTTPS.

---

## 7. Post-deploy smoke test (in the browser, on the real URL)

Do these in order; each builds on the previous.

**Access & security**
- ☐ `https://<site>` loads, tab title reads **LeadOps**.
- ☐ `https://<site>/LeadOps%20sheet.xlsx` → **404** (B8).
- ☐ Log in with `dev@leadops.local` / `devmode123` → **rejected** (B1).
- ☐ `https://<site>/api/auth/dev-login` (POST) → **404**.
- ☐ 11 wrong passwords in a row → **rate-limited** (B7).
- ☐ Sign-up: code email arrives; wrong code rejected; right code works.
- ☐ Real admin logs in and sees Reports + Team.
- ☐ Employee logs in: sees only their own leads; **cannot** change a lead that isn't theirs (B3).

**Sales flow** (use a test lead, delete it afterwards)
- ☐ Create a lead → appears in **Tracker → Pipeline** as `Lead: Submitted`.
- ☐ Assign it → the employee gets a **notification instantly** (tests SSE through nginx, S5).
- ☐ Log a Call with next action date = today → shows under **Follow-ups** on the dashboard.
- ☐ Create a proposal → a second proposal for the same lead is **refused**.
- ☐ Mark it **Won** → popup demands engineer + dates → project **WO-000X** created with them.
- ☐ Mark a proposal **Lost** / a lead **Dead** → reason is **required** and shows in the lead popup.
- ☐ Create an invoice → shows in **Pending Payments**; log full payment → status **Paid** →
  appears in **Tracker → Invoices** "Paid invoices from the app".
- ☐ Upload a PDF to the lead → download works.
- ☐ **Redeploy the stack** → the PDF still downloads (B5 — volume works).
- ☐ Delete the test lead → proposal, project, invoice, Tracker row all disappear.

**UI**
- ☐ Dashboard tiles show ₹ values in lakh/crore; each card opens the right page.
- ☐ Tracker → Report: Grouped/Exact toggle works; clicking a bar lists its leads.
- ☐ Dark mode: dropdowns readable. (If a white block appears around an open dropdown,
  check browser zoom is 100% — known Chrome/Edge quirk with native dropdowns.)

---

## 8. After go-live (operations)

- ☐ **Backups** — confirm Aiven daily backups are on and do one practice restore.
- ☐ **Uploads backup** — the `leadops-uploads` volume holds the only copy of documents; back it up
  (e.g. nightly `tar` of the volume to another disk/cloud).
- ☐ **Monitoring** — Portainer container restart alerts at minimum; consider Sentry for errors.
- ☐ **Updating** — pull → run migrations → redeploy stack. Migrations must run **before** the new API starts.
- ☐ **Rollback** — keep the previous image tag; migrations here only *add* columns/tables
  (except `drop_tenders`, already applied), so the previous image keeps working after a migration.
- ☐ **Secrets rotation** — if `JWT_SECRET`, the Aiven password or the SMTP password ever leaks,
  rotate it in Portainer and redeploy.

---

## Appendix — what was checked

| Area | Result |
|---|---|
| Server production build (`tsc`) | ✅ compiles |
| Client production build (`tsc -b && vite build`) | ❌ 4 type errors (B2) |
| Server dependencies (`npm audit --omit=dev`) | ⚠️ 12 (6 high) — runtime-relevant ones fixable (S4) |
| Client dependencies | ✅ 0 |
| Secrets in git | ✅ `.env` not committed · ⚠️ sales sheet committed (B8) · ✅ Aiven CA is public |
| Route permissions (leads, proposals, projects, invoices, payments, activities, documents, tasks) | ⚠️ all correct **except** `PATCH /leads/:id` (B3) |
| Auth | ❌ dev backdoor (B1) · ❌ no rate limits (B7) · ⚠️ open sign-up (S1) · ⚠️ no reset (S2) |
| File uploads | ✅ type + 10 MB limit, random stored names, access-checked downloads · ❌ not persisted (B5) |
| Database | ✅ TLS with CA pinning, pool errors handled · ⚠️ 20-connection cap (S3) |
| Concurrency (numbering, one proposal/project per lead, Won race, overpayment) | ✅ 5/5 tests pass |
| Live notifications (SSE) | ✅ works locally · ⚠️ needs proxy buffering off (S5) · single replica only |
| Health check | ✅ `GET /health` |

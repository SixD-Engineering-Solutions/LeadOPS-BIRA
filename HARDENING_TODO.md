# Backend Hardening & Correctness — TODO

Ordered by actual impact for this app (small internal team, real client data already in it),
not by textbook completeness. Phase 1 is a live security bug — do it first, on its own.

## How to work through this

- One phase = one branch = one reviewable batch. Don't start the next phase until the
  current one is verified and reviewed.
- Per item: **define** expected behavior in a line or two before touching code (especially
  for the money/overpayment decisions in Phase 1–2) → **implement** the smallest change that
  satisfies it → **verify** (typecheck + manual run-through, tests once Phase 4 adds them) →
  **review** the diff before moving on.
- Don't fix unrelated things mid-phase — note them here instead and keep moving.
- Check items off (`- [x]`) as they land, same convention as `TODO.md`.
- **Every phase ends with a "Verification" log recorded in this file** — what was tested, how,
  and the actual result (pass/fail), not just "typechecks." Written after the fact from real
  requests/UI runs against the live app, not predicted. A phase isn't done until this log
  exists and everything in it passed.

---

## Phase 1 — Fix now (real bugs, cheap, high impact) — done

- [x] Add `requireAdmin` to `POST /users` in `Server/src/routes/reference.ts` — any logged-in
      employee could previously call this and set their own role
- [x] Constrain `role` to `z.enum(['admin', 'employee'])` instead of a free string, same route
- [x] Along the way: found and closed the same gap on every other write in `reference.ts`
      (`POST /locations`, `/client-categories`, `/clients`, `PATCH /clients/:id`,
      `/lead-sources`, `/service-types`, `/plants`, `/contacts`, `/verticals`, `/sectors`,
      `/lead-statuses`) — confirmed none of these are used by regular lead creation (that does
      its own find-or-create directly in `leads.ts`), only by the unwired admin Catalog page
- [x] Make `recomputeStatus` (in `Server/src/routes/invoices.ts`) run when `PATCH /invoices/:id`
      changes `amount`, not just on new payments — verified Paid → Partially Paid → Paid
      transitions live against the running server
- [x] Add a `requireAdmin`-gated reactivation endpoint (`POST /users/:id/reactivate`) — plus
      `GET /users?includeInactive=true` (admin-only) and a minimal Team-page "Removed" section
      with Reactivate, and an "Add employee" form, since `POST /users` had no UI at all before
- [x] Gate `POST /auth/dev-login` behind an explicit opt-in env flag (`ENABLE_DEV_LOGIN=true`),
      default off, with the `NODE_ENV==='production'` check kept as a hard backstop; documented
      in `Server/.env` and `Server/README.md`

### Phase 1 — Verification (2026-09-22) — **PASSED, 20/20**

Typecheck: `Server` clean, `Client` clean (only pre-existing, unrelated `leads.tsx` errors from
before this phase). Everything below run against the live dev server + real browser, not
predicted.

**Admin-escalation fix**
- [x] Employee token → `POST /users` → `403 Admin access required`
- [x] Admin token → `POST /users` valid data → `201`, full response shape (id/userName/email/
      role/department/phoneNumber/isActive)
- [x] Admin token → `POST /users` with `role: "superadmin"` → `400` (enum rejects it)
- [x] Employee token → `POST /locations` → `403` (confirms the same fix on the other 10 writes
      in `reference.ts`)

**Reactivation**
- [x] `DELETE /users/:id` → `200`, then `GET /users` (default) → removed user absent
- [x] `GET /users?includeInactive=true` as employee → removed user still absent (param silently
      ignored for non-admins, as designed)
- [x] `GET /users?includeInactive=true` as admin → removed user present, `isActive: false`
- [x] Employee token → `POST /users/:id/reactivate` → `403`
- [x] Admin token → `POST /users/:id/reactivate` → `200`, `isActive: true`, back in default
      `GET /users`
- [x] Reactivating an already-active user → `404`
- [x] Team page UI, end to end: Add Employee form creates a user → appears in active list →
      Remove → appears in "Removed" section → Reactivate → back in active list. Walked through
      by hand in the browser, not just via curl.

**Invoice status recompute**
- [x] Invoice paid in full → status `Paid`
- [x] `PATCH` amount raised above what's paid → status drops to `Partially Paid` (this is the
      actual bug fix — previously stayed stuck on `Paid`)
- [x] `PATCH` amount lowered back to match what's paid → status returns to `Paid`

**Dev-login opt-in**
- [x] `ENABLE_DEV_LOGIN="true"` → `POST /auth/dev-login` → `200`, returns a token
- [x] `ENABLE_DEV_LOGIN="false"` (server restarted to pick up the change) → `POST /auth/dev-login`
      → `404 Not found` — confirmed the default-off direction actually blocks it, not just that
      the on-direction works
- [x] Flag restored to `"true"` for continued local dev, confirmed working again

**Verdict: Phase 1 is successful.** All 5 planned items plus the adjacent lookup-table gap are
implemented and independently verified — not just "compiles," but the actual request/response
behavior in every case, including both sides of each permission check (denied *and* allowed) and
both sides of the opt-in flag (on *and* off). No regressions found in either typecheck.

## Phase 2 — Fix soon (real user-facing rough edges, cheap wins) — done

- [x] Removed the header search bar (`Client/src/pages/dashboard.tsx`) — it had no
      `value`/`onChange` at all, looked functional and wasn't. A real search feature is a
      bigger build than a "cheap win," so honest removal beats a fake affordance for now.
- [x] Added a confirm step before Delete on Leads and Tasks (`pages/leads.tsx`, `pages/tasks.tsx`)
      — matches the confirm pattern `team.tsx` already used for its own delete actions
- [x] Resolved "Lead Generation" vs "My Leads" — confirmed `GET /leads` already filters to the
      caller's own leads for non-admins (so "My Leads" was accurate for employees but wrong for
      admins, who see everyone's); collapsed to a single "Leads" nav/module entry matching the
      page's own heading. Old `'leads'` sessionStorage/key values still resolve (kept in
      `REAL_VIEWS` and the render-switch) so no one's stored tab breaks.
- [x] Payment correction + overpayment, decided and built: **reject** overpayment at entry
      (`POST /invoices/:id/payments` now 400s if it would exceed the invoice amount — simplest
      safe default for money data) and **void-and-re-enter** for corrections (`Payment` gained
      `deletedAt`, soft-delete via new `DELETE /invoices/:id/payments/:paymentId`, admin-only,
      matching the soft-delete pattern used everywhere else in this schema). Found and fixed one
      more bug while implementing this: `recomputeStatus` had no path back down from
      Paid/Partially Paid when `paid` returns to 0 (only possible now that voiding exists) — it
      would've stayed stuck; now falls back to `Sent`.

### Phase 2 — Verification (2026-09-22) — **PASSED, 15/15**

Typecheck: `Server` clean, `Client` clean (only the same pre-existing `leads.tsx` errors).
Server DB schema pushed (`Payment.deletedAt`) and client regenerated. All checks below run
against the live server and a real browser.

**Search bar / nav collapse / delete confirm**
- [x] Header no longer renders a search input — confirmed in a live screenshot
- [x] Sidebar shows a single "Leads" entry, no separate "My Leads" — confirmed in a live
      screenshot and in the nav's accessibility snapshot
- [x] Leads: clicking Delete shows a native confirm with the expected message; **Cancel** →
      row still present; **OK** → row gone (both directions tested against a throwaway lead)
- [x] Tasks: same confirm dialog, same message pattern, **OK** → row gone (throwaway task)
- [x] One pre-existing, unrelated 404 noticed in the console during the leads delete test —
      traced to `leads.tsx`'s own live-sync listener re-fetching the lead it just deleted (by
      design, `.catch()` handles it) — confirmed via source read this predates Phase 2 and isn't
      a regression

**Payment correction + overpayment**
- [x] Invoice amount 10000, pay 6000 → status `Partially Paid`
- [x] Attempt to pay 5000 more (would total 11000) → `400`, clear remaining-balance message,
      no payment created
- [x] Pay exactly the remaining 4000 → status `Paid`
- [x] Employee token → void a payment → `403`
- [x] Admin token → void the 4000 payment → status correctly drops back to `Partially Paid`,
      1 payment left
- [x] After voiding, paying 4000 again is now allowed (remaining balance correctly restored —
      confirms the overpayment check reads live, non-voided payments only)
- [x] Void the remaining 6000 payment too (paid → 0, invoice was `Paid`) → status correctly
      falls back to `Sent` instead of staying stuck (the extra bug fix, specifically verified)
- [x] Void button in the Invoices UI confirmed rendered (admin-only) in the right place,
      right next to who recorded the payment — not clicked against real seeded data, since the
      underlying logic was already fully verified via curl on throwaway data

**Verdict: Phase 2 is successful.** All 4 items implemented and independently verified,
including a bug found and fixed *during* implementation (the stuck-status fallback) that
wouldn't have surfaced without actually testing the void path end to end rather than assuming
the existing recompute logic would just work.

## Phase 3 — Harden concurrency (real bugs, low probability today, worth closing) — done

- [x] Replaced all three `count()+1` numbering functions (proposal, work order, invoice — plus
      proposals.ts's old "retry once on collision" band-aid, which was itself an admission the
      race was real) with one shared atomic counter: new `Counter` model + `INSERT ... ON
      CONFLICT ... RETURNING` in `Server/src/utils/sequence.ts`. Existing counters seeded to the
      current highest-used number first, so the switch didn't collide with real data.
- [x] Wrapped proposal-Won → Project-create in `prisma.$transaction` — status update and project
      creation now succeed or fail together. The "already has a project" pre-check can still
      theoretically race under Postgres's READ COMMITTED isolation; what actually prevents a
      duplicate either way is `Project.proposalId` being `@unique` (documented in the code).
- [x] Wrapped payment-create + status-recompute in `$transaction`, **plus** a `SELECT ... FOR
      UPDATE` row lock on the invoice and a fresh re-read of what's paid *inside* the lock —
      this is what actually closes the overpayment race, not just wrapping in a transaction
      (a bare transaction alone doesn't stop two concurrent requests from both reading the same
      pre-payment balance under READ COMMITTED). Also wrapped the amount-`PATCH` and
      payment-void paths in transactions for the same "succeed/fail together" reasoning.
- [x] Found and fixed a load-related issue *while verifying*, not before: an initial 15-way
      concurrent burst had 3 requests fail outright (not duplicate — just fail) because Aiven's
      plan caps this DB at 20 total connections and the app pool only opens 10; Prisma's default
      transaction wait/timeout (~2s/~5s) is tuned for a pool with more headroom than that. Since
      the connection ceiling itself can't safely be raised, added `TX_OPTS = { maxWait: 10000,
      timeout: 10000 }` to every transaction added in this phase — the same connections, just
      more patience to queue for one under a burst, so requests wait instead of erroring.

### Phase 3 — Verification (2026-09-22) — **PASSED, 8/8** (after one fix mid-verification)

Typecheck: `Server` clean. Schema pushed (`Counter` model), counters seeded to the real current
counts (proposals 20, projects 6, invoices 6) so numbering continuity was preserved — verified
directly (see below) before any concurrency testing. All checks run against the live server with
*actually concurrent* requests (backgrounded curl + `wait`, not sequential calls), which is the
only way this phase's claims mean anything.

- [x] Numbering continuity after the switch: one new proposal/invoice/project each correctly
      got `PROP-0021` / `INV-0007` / `WO-0007` — continuing from the seeded counts, no collision
      with existing data, no reset to 1
- [x] 15 truly concurrent `POST /proposals` — **first run: 12 succeeded with unique numbers, 3
      failed outright** (not duplicated — failed). Traced to Aiven's 20-connection cap plus
      Prisma's default transaction timeout, not the row lock itself (confirmed by reproducing
      the same 15-way contention with 15 raw `pg` connections outside Prisma, which all
      succeeded). Added `TX_OPTS`, restarted, **re-ran from scratch: 15/15 succeeded, 15/15
      unique** — verified programmatically (`Set` size check), not by eyeballing
- [x] 12 concurrent `POST /projects` → 12/12 succeeded, 12/12 unique work order numbers
- [x] 12 concurrent `POST /invoices` → 12/12 succeeded, 12/12 unique invoice numbers
- [x] 8 truly concurrent `PATCH` requests marking the *same* proposal "Won" → all 8 returned
      success (each just re-applies the same status, which is idempotent) — queried
      `GET /projects` directly afterward and confirmed **exactly one** project was created for
      that proposal, not eight
- [x] 5 concurrent payments of 6000 each against a 10000 invoice (individually valid, but two
      together would overpay) → exactly 1 succeeded, 4 correctly rejected with the *updated*
      remaining-balance message (₹4000, not the original ₹10000) — proving the row lock, not
      just the check, is what's preventing the race. Confirmed on the invoice directly
      afterward: exactly 1 payment, ₹6000 total, not ₹12000 or two payment rows
- [x] Full Phase 2 regression suite (partial pay → overpay-reject → pay-to-Paid → void as
      employee 403 → void as admin → Partially Paid → amount `PATCH` → Paid) re-run in full
      against the Phase 3-refactored transaction code — every step still passes, no regression
      from the rewrite
- [x] Real end-user flow, not just curl: created one proposal through the actual browser UI
      form — correctly got the next sequential number, confirming the fix works through the
      real request path end to end, not only via direct API calls
- [x] All test data (13 leftover rows from before the `TX_OPTS` fix, missed on first cleanup —
      caught by checking active row counts against the known baseline, not assumed clean)
      identified by number pattern and removed; active counts confirmed back to the exact
      baseline (20 proposals / 6 projects / 3 invoices) before moving on

**Verdict: Phase 3 is successful**, but it's the clearest example yet of why this file requires
a real verification pass rather than "it typechecks": the first concurrency run genuinely failed
(3 of 15 requests errored), and the fix that followed — tuning transaction timeouts to a pool
that's capped by the DB plan's connection limit, rather than just scaling the pool up — came from
diagnosing that failure with a raw-`pg` reproduction, not from anything in the original plan for
this phase.

### Phase 3 — Re-verification (2026-09-22, later same day) — **PASSED, 8/8, zero app errors**

Requested explicitly as a clean re-run with no errors tolerated. Re-baselined first (20/6/3
active proposals/projects/invoices — matching the earlier baseline exactly) and re-ran every
check from scratch, tracking and cleaning up every created row immediately after each test
instead of batching cleanup at the end.

- [x] All 6 checks from the first pass repeated: numbering continuity, 15-way concurrent
      proposals (15/15, all unique), 12-way concurrent projects (12/12, all unique), 12-way
      concurrent invoices (12/12, all unique), 8-way Won-race (exactly 1 project), 5-way
      overpayment race (exactly 1 payment landed, 4 correctly rejected against the *updated*
      balance) — all passed cleanly on this run, no `TX_OPTS` fix needed this time (already in
      place from the first pass)
- [x] One anomaly surfaced and run to ground rather than ignored: the first 12-way project-
      concurrency attempt had 2 requests produce *no output file at all* (not an error response —
      nothing). Investigated before accepting the result: queried the DB directly for rows
      matching that batch's naming and found exactly 10, matching the 10 files that *did* get
      written — proving those 2 requests never reached the server at all. This is a client-side
      artifact of backgrounding many `curl` processes under git-bash on Windows, not a server or
      concurrency-logic defect. Added a completion guard (assert the expected file count exists
      after `wait`, retry the whole batch if not) to the remaining tests as a precaution; every
      later batch completed on the first attempt with no retries needed.
- [x] Full Phase 2 regression suite re-run in full again, including the amount-drops-paid-to-zero
      → falls back to `Sent` case explicitly — passed
- [x] Cleanup discipline tightened based on the first pass's own findings: voiding a payment was
      being skipped before deleting its parent invoice, leaving the payment row orphaned-but-
      active (harmless — permanently unreachable, since nothing queries payments except through
      a non-deleted invoice — but not clean). Found 4 such rows accumulated across *both* the
      original Phase 3 verification and this re-verification, voided all 4, and confirmed the
      true baseline is `payments: 2` (matching the two real seeded payments visible on INV-0001
      and INV-0002 in the app) — not the `5` first assumed, which was itself already inflated by
      3 undiscovered orphans from the earlier session.
- [x] Final state confirmed by direct query, not assumption: `proposals: 20, projects: 6,
      invoices: 3, payments: 2`, zero orphaned active payments under deleted invoices, `WO-0007`
      (an earlier test project) confirmed actually soft-deleted rather than just assumed so

**Verdict: Phase 3 re-verification passed with zero application-level errors.** The one anomaly
encountered (2 dropped requests in a concurrency test) was traced to its root cause before being
dismissed, and confirmed to be a test-harness artifact rather than a defect in the code under
test — worth recording precisely because "investigated and ruled out" is a different, and more
trustworthy, claim than "didn't happen again."

## Phase 4 — Infra hygiene (before this grows past "internal tool, small team") — done

- [x] Introduced versioned `prisma migrate` history. No `prisma/migrations/` existed before —
      everything had gone through `db push`. Baselined the current schema as an `_init`
      migration (generated via `migrate diff --from-empty`, marked applied via `migrate resolve`
      without re-running it, since the DB was already in that state) so `migrate dev`/`deploy`
      work cleanly from here on. Added `db:migrate:deploy` and `db:migrate:status` scripts.
- [x] Moved `amount` / `amountReceived` / `value` (Invoice, Payment, Proposal, Tender) off
      `Float` to `Decimal(14,2)` — the first real migration under the new history
      (`money_to_decimal`). **Backed up all 4 columns' exact values before applying**, applied,
      then diffed old vs. new value-by-value (not just row counts) and confirmed zero mismatches
      across all 118 rows.
      - JSON responses still return plain numbers, not strings: Prisma's `Decimal` serializes to
        a string by default (so `JSON.stringify` doesn't silently lose precision) — one
        `Decimal.prototype.toJSON` override in `prisma.ts` keeps every API response, and
        therefore the client, completely unchanged.
      - Decimal doesn't overload `+`/`-`/`>=` (using them would silently string-concatenate
        instead of adding) — `tsc` itself caught every place this mattered
        (`totalPaid`/`recomputeStatus`/the overpayment check in `invoices.ts`) as compile
        errors; fixed each with an explicit `Number(...)` conversion at the point of use.
      - Tracker's imported fields (`valueLakhs` etc.) deliberately left as `Float` — read-only
        imported reference data, not user-entered financial records with a correctness
        invariant depending on them; out of scope for this item.
- [x] TLS certificate verification is genuinely back on — not just "not disabled." Extracted
      this Aiven project's actual CA certificate directly from the live TLS handshake (walked
      the presented chain to its self-signed root), saved as `Server/certs/aiven-ca.pem`
      (committed — a CA *certificate* is a public trust anchor, not a secret), and `prisma.ts`
      now connects with `ssl: { ca, rejectUnauthorized: true }`. Verified both directions: the
      real cert connects successfully, and a deliberately wrong CA is correctly rejected
      (`SELF_SIGNED_CERT_IN_CHAIN`) — proving verification is actually active, not a no-op.
      `db:push`/`db:migrate`/`db:studio` switched from the blanket
      `NODE_TLS_REJECT_UNAUTHORIZED=0` (disables checking for every connection that process
      makes) to `NODE_EXTRA_CA_CERTS=./certs/aiven-ca.pem` (trusts only this one CA in addition
      to the normal trust store). `db:seed`/`db:import-tracker` needed no flag at all — they go
      through `prisma.ts`, which now handles this itself.
- [x] Added focused tests covering Phases 1–3 specifically (`Server/tests/`, Vitest): permission
      matrix (admin vs. employee, allowed + denied case per resource/action, reactivation
      lifecycle), invoice correctness (the full partial → overpay-reject → paid → void → repaid
      → amount-edit → zero lifecycle, with genuinely fractional Decimal amounts throughout), and
      concurrency (unique numbering under real parallel load, exactly-one-project from a Won
      race, exactly-one-payment from an overpayment race) — 15 tests, not a test-everything push.
      These are real integration tests against the live running server (`index.ts` calls
      `app.listen()` directly with no exported `app` to test in-process — refactoring that is
      Phase 5 territory, not bundled in here), each creating and cleaning up its own throwaway
      lead/proposal/project/invoice so the suite is safe to run repeatedly against the real
      database.

### Phase 4 — Verification (2026-09-22) — **PASSED, 4/4 items, 15/15 tests**

- [x] Full Phase 2 + Phase 3 regression suite re-run against the Decimal-backed columns, this
      time with genuinely fractional amounts (₹10000.55, ₹6000.25, ₹4000.30) rather than round
      numbers, specifically to exercise precision the earlier round-number tests couldn't have:
      remaining-balance math came back exactly `4000.3`, not `4000.299999999999`-style float
      noise — every status transition (Partially Paid → Paid → void → Partially Paid → PATCH →
      Paid) still correct
- [x] Overpayment concurrency race (5 concurrent ₹6000 payments against a ₹10000 invoice)
      re-run against the Decimal columns specifically to confirm the `FOR UPDATE` row lock still
      holds with the new column type — exactly 1 succeeded, 4 correctly rejected, same as before
      the migration
- [x] Confirmed by direct query, not assumption: `invoice.amount`, `payment.amountReceived`,
      `proposal.value`, `tender.value` all come back as JSON `number` (`typeof === 'number'`),
      including the nested `payments[].amountReceived` — the client needed zero changes
- [x] Browser check: dashboard's money tiles (Pipeline Value, Orders Received, Pending
      Payments) render identically to before the migration, no console errors
- [x] Live server confirmed connecting and serving real data through the actual
      `rejectUnauthorized: true` + extracted-CA path, not just in an isolated test script
- [x] Baseline discipline carried over from the Phase 3 re-verification: checked active row
      counts against the known baseline afterward rather than assuming clean, found 2 more
      orphaned-but-active payments from this round's own test invoices, voided both, confirmed
      by direct query back to the exact baseline (`20 / 6 / 3 / 2`)
- [x] Test suite (`Server/tests/`, run via `npm test` against the live dev server): 3 files, 15
      tests, all passing — `permissions.test.ts` (8), `invoices.test.ts` (1, walking the full
      lifecycle in sequence), `concurrency.test.ts` (4, each firing genuinely parallel requests
      via `Promise.all`, not a for-loop of awaits)
  - **Caught and fixed a real bug in the test suite itself before trusting it**: the
    overpayment-race test logged one real payment but only deleted the invoice afterward,
    never voiding the payment underneath it — the exact same orphaned-active-payment mistake
    made manually (twice) during the Phase 3/4 verifications. Found it by checking the active
    payment count after the first run (`4`, not the expected `2`), not by assuming a green run
    meant a clean one. Added a `deleteInvoiceAndPayments` helper so this class of mistake can't
    recur, cleaned up the pre-fix orphans, then re-ran.
  - **Repeatability verified directly, not assumed**: ran the full suite twice in a row after
    the fix and queried the database after each run — both times landed on the exact baseline
    (`proposals: 20, projects: 6, invoices: 3, payments: 2, orphaned payments: 0`) with zero
    drift. A test suite that passes but silently leaves the database different each run would
    be worse than no suite at all for a shared, non-disposable database like this one.
  - `tsc --noEmit` on `tests/tsconfig.json` (a separate config, since `tests/` isn't in the
    main `src`-scoped `tsconfig.json` and doesn't need to be — the tests only make HTTP calls,
    they don't import app code) passes clean, and confirmed this didn't affect the main
    `tsconfig.json`'s own typecheck.

**Verdict: Phase 4 is complete.** All 4 items done and independently verified: versioned
migrations, the Decimal money migration (zero data loss across 118 rows), real TLS verification
(proven to actually reject a wrong CA, not just accept the right one), and a 15-test automated
suite covering Phases 1–3 that's been proven repeatable, not just "green once."

## Phase 5 — Code health (opportunistic, not blocking anything)

- [x] Consolidate the repeated `isAdmin()` / `canAccessX()` pairs duplicated across
      `leads.ts`, `proposals.ts`, `projects.ts`, `invoices.ts`, `documents.ts` into one shared
      helper module
- [x] Standardize the backend error response shape across all routes (including 500s); add a
      stable machine-readable code alongside the human message
- [x] Add distinct loading / empty / error UI states with a retry action wherever still missing
- [x] Split `Client/src/pages/dashboard.tsx` (~880 lines) along its existing internal seams
      (stats / proposal stats / invoice stats / follow-ups / sidebar) into separate
      components/hooks
- [x] Split `Client/src/components/LeadDetailModal.tsx`'s activity / proposal / document
      handling into three sub-components
- [x] Update `Server/README.md` / `Client/README.md` to match actual behavior once the above
      lands (new env vars, migration workflow replacing `db push`, etc.)

### Phase 5, item 1 — Verification (2026-09-22) — **PASSED**

New shared module `Server/src/utils/access.ts` (`isAdmin`, `canAccessLead`, `canAccessProject`).
The original plan named 5 files; a repo-wide grep during this item turned up the identical
byte-for-byte duplication in 3 more (`tasks.ts`, `activities.ts`, `reference.ts`) that had been
missed earlier — all 8 were consolidated, not just the originally-listed 5, since leaving 3
duplicates behind would defeat the point of the item.

- [x] Confirmed via `grep` that every local `isAdmin()` was byte-for-byte identical (all 8 files),
      and `canAccessLead()` identical across the 4 files that had it (`proposals.ts`,
      `projects.ts`, `documents.ts`, `activities.ts`) before merging them — a real behavioral
      change hiding in one of these would have made consolidation unsafe
- [x] `leads.ts`'s own `visibilityFilter()` left local (not duplicated elsewhere, leads-specific)
- [x] `invoices.ts`'s `findAccessibleInvoice`/`totalPaid`/`recomputeStatus`/`ValidationError`/`Db`
      type (all Phase 3/4 work) left untouched — only its `isAdmin`/`canAccessProject` pair was
      removed and replaced with the import, checked by reading the whole file's diff, not just
      the top
- [x] Repo-wide grep for `async function isAdmin|canAccessLead|canAccessProject` across
      `Server/src/routes/` after all edits → zero matches, confirming no local duplicate survived
      anywhere, not just in the 5 originally-named files
- [x] `Server` typecheck (`tsc --noEmit`): clean
- [x] `Client` typecheck (`tsc --noEmit`): clean
- [x] Full test suite (`npm test`, live dev server, real HTTP): **15/15 passed** — including the
      full permission matrix in `permissions.test.ts`, which exercises `isAdmin`/`canAccessLead`
      on every route now sourcing them from the shared module, so a behavioral slip during the
      merge would have shown up as a permission-check failure, not just a compile error

**Verdict: Phase 5 item 1 is complete.** All 8 duplicate-bearing files (3 more than the plan
named) now import from one shared module; behavior verified unchanged by the full existing test
suite plus a clean double typecheck, not just by the refactor "looking mechanical."

### Phase 5, item 2 — Verification (2026-09-22) — **PASSED**

New `Server/src/utils/errors.ts`: `sendError(res, status, message)` looks up one stable code per
HTTP status from a small table (`400→VALIDATION_ERROR`, `401→UNAUTHORIZED`, `403→FORBIDDEN`,
`404→NOT_FOUND`, `409→CONFLICT`, `500→INTERNAL_ERROR`, `502→UPSTREAM_ERROR`,
`503→SERVICE_UNAVAILABLE`, anything else `ERROR`) and writes `{ error, code }` — chosen over a
unique code per one of the ~100 individual call sites, since a per-status table is centrally
defined (so it's actually "stable," not just consistent by convention) and this app doesn't have
per-call-site error semantics worth a client branching on beyond the status class.

- [x] Confirmed by grep that every one of the 100 `res.status(N).json({ error: ... })` call sites
      across 13 files (`middleware/authenticate.ts` + 12 route files) matched one exact pattern
      with no extra response fields anywhere, before writing a codemod to convert them — safe to
      automate mechanically rather than hand-edit 100 sites with the attendant transcription risk
- [x] Ran the codemod, then manually re-read every edge case that wasn't a plain string literal
      to confirm the regex captured the full expression correctly: a ternary
      (`documents.ts` — `err instanceof Error ? err.message : '...'`), a dynamic `e.message` off a
      caught `ValidationError` (`invoices.ts`), an inline `if (err && !res.headersSent)` guard
      (`documents.ts`), and `reference.ts`'s local `bad(res, msg)` helper (updated once, which
      automatically fixed all 16 of its call sites — not touched individually)
- [x] Repo-wide grep for the old `res.status(N).json({ error:` pattern after the codemod → zero
      matches anywhere in `src/`
- [x] Added two `index.ts` handlers that didn't exist before: a JSON 404 fallback for routes that
      match nothing, and a 4-argument Express error-handling middleware as a last resort for
      anything a route didn't catch itself — including Express 5's auto-forwarded async
      rejections. Before this, an uncaught error would fall through to Express's default handler
      and leak a stack trace as HTML instead of this app's JSON shape; now it logs server-side and
      returns the same `{ error, code: 'INTERNAL_ERROR' }` shape as everything else.
- [x] Live-server checks against the actual running app, not just typecheck: a `401` (missing
      auth header), a `400` (missing `leadId` on `POST /activities`), a `404` (nonexistent lead
      id, and a route matching nothing) — each returned the expected `code` alongside the
      unchanged human message
- [x] Noted, not fixed (out of scope for this item): `referenceRoutes` is mounted at `app.use('/',
      ...)`, so its `authenticate` middleware intercepts *any* unmatched path before it can reach
      the new global 404 handler when no auth header is sent — a pre-existing routing quirk from
      before this phase, not a regression from this change (confirmed the new 404 handler does
      fire correctly once a valid token is supplied)
- [x] `Server` typecheck (`tsc --noEmit`): clean
- [x] `Client` typecheck (`tsc --noEmit`): clean — the client already only reads `data.error` as
      a string (`Client/src/lib/api.ts`) and ignores unknown fields, so adding `code` alongside it
      is additive and required no client changes
- [x] Full test suite (`npm test`, live dev server): **15/15 passed**, no regressions from
      rewriting 100 error-response call sites

**Verdict: Phase 5 item 2 is complete.** Every error response in the app (all ~100 existing call
sites, plus the two new fallback handlers for 404s and uncaught 500s) now returns the same
`{ error: string, code: string }` shape, verified against the live server and the full test suite,
not just by the codemod "looking like it worked."

### Phase 5, items 3–4–5 — Verification (2026-09-22) — **PASSED**

Done together since items 4 and 5 (splitting `dashboard.tsx` and `LeadDetailModal.tsx`) touch the
same files item 3's error/retry work needed to land in, and doing the error-state work twice
(once before, once during the split) would've been wasted motion.

**Item 3 — loading/empty/error+retry states.** New shared `Client/src/components/ErrorBanner.tsx`
(a message plus an inline "Try again" button). A repo-wide survey (via a research subagent, since
this spanned 11+ files) found every list page already had loading/empty/error, but the only retry
available anywhere was an unrelated always-visible header "Refresh" button, never a retry scoped
to the error itself — and `dashboard.tsx`, `LeadDetailModal.tsx`, and `NotificationBell.tsx` had no
error state at all (fetch failures were silently swallowed via `.catch(() => {})`, leaving the user
looking at permanent "—" placeholders or an empty list with zero explanation).

- [x] Wired `ErrorBanner` into the 9 pages that already had error state + a named reload function
      (`leads.tsx`, `tasks.tsx`, `projects.tsx`, `invoices.tsx`, `tenders.tsx`, `proposals.tsx`,
      `team.tsx`, `reports.tsx`, `catalog.tsx`) — mechanical, one call site each
- [x] `tracker.tsx`: both `PipelineTab` and `InvoicesTab` had their fetch inlined directly in
      `useEffect` with no way to call it again — extracted each into a named `load()` function
      first, *then* wired the retry, since there was nothing to retry into before that
- [x] `NotificationBell.tsx`: added an error state to the initial notification fetch (previously
      fully silent) — shown inside the dropdown in place of the empty-state message, with retry
- [x] `LeadDetailModal.tsx`: added error state to all three of its independent loaders
      (documents/proposals/activities — previously all `.catch(() => {})`), each with its own
      scoped retry
- [x] `dashboard.tsx`: the biggest gap — none of its 5 data sources (lead stats, proposal stats,
      pending invoices, my tasks, follow-ups) had any visible error state; a failed fetch just
      reset that section to empty/zero with nothing telling the user why. Fixed as part of the
      hook extraction below, so each source's hook now returns its own `error` + `reload`,
      surfaced as an `ErrorBanner` at the relevant spot (above the stat tiles for lead/proposal
      stats, in place of the panel for follow-ups/pending-payments/tasks)

**Item 4 — split `dashboard.tsx`** (874 → 274 lines). Extracted:

- 5 hooks (`Client/src/hooks/useLeadStats.ts`, `useProposalStats.ts`, `usePendingInvoices.ts`,
  `useMyTasks.ts`, `useFollowUps.ts`) — each owns one data source's fetch, SSE-resync listener,
  loading state, and (new, per item 3) error + reload
- `Client/src/components/dashboard/`: `icons.tsx` (shared icon set), `DashboardSidebar.tsx`,
  `StatTiles.tsx`, `FollowUpsPanel.tsx`, `PendingPaymentsPanel.tsx`, `TasksPanel.tsx`,
  `LeadAssignmentsModal.tsx` — `dashboard.tsx` itself is now just the tab-routing shell that
  composes these

**Item 5 — split `LeadDetailModal.tsx`** (406 → 124 lines). Extracted
`Client/src/components/leadDetail/`: `shared.tsx` (`DetailSection`/`inputCls`/`fmtDay`, used by all
three), `LeadDocumentsSection.tsx`, `LeadProposalsSection.tsx`, `LeadActivitySection.tsx` — each is
now a fully self-contained component owning its own fetch, form, and error/retry state, taking only
`leadId` as a prop. `LeadDetailModal.tsx` itself keeps the static info sections (Client/Plant/
Contact/Classification/Ownership/Notes) and composes the three extracted sections.

**Verification, run against the live app, not just typecheck:**

- [x] `Server` typecheck (`tsc --noEmit`): clean
- [x] `Client` typecheck (`tsc --noEmit`): clean
- [x] Full test suite (`npm test`, live dev server): **15/15 passed**, both before and after the
      dashboard/modal split (run once after item 3's wiring, once after the final split)
- [x] Live browser walkthrough (Playwright) as the dev-admin user: dashboard loads with all 6 stat
      tiles, Pending Payments panel, and Modules grid rendering correctly with real data; clicked
      "Total Leads" → `LeadAssignmentsModal` opens with all 6 admins' grouped leads plus an
      Unassigned bucket; clicked a lead row → `LeadDetailModal` opens on top with every section
      (Documents/Proposals/Activity, each showing its correct empty state) intact
- [x] **Error/retry path actually exercised, not just wired**: killed the backend process, reloaded
      the dashboard — all 4 data-source error banners appeared correctly ("Cannot reach the
      server. Please try again." + Try again), tiles fell back to "—" as before, console showed
      only the expected fetch-failure errors and no React errors. Restarted the backend and clicked
      each of the 4 "Try again" buttons individually — each one recovered *only* its own source
      (e.g. clicking the lead-stats retry populated the lead tiles while the other 3 banners stayed
      up), and after all 4 the page matched the original pre-failure state exactly. This is the
      part that would have been easy to get wrong (four independent hooks, four independent
      retries) and the live test is what actually proves the wiring is correct per-source, not just
      that the code compiles.
- [x] Tracker page re-tested after the `load()` extraction: Pipeline tab (129 imported rows) and
      Invoices tab (summary + register tables) both still render correctly
- [x] `LeadActivitySection`'s write path re-tested live: logged a real activity through the split
      component's form, confirmed it appeared in the timeline immediately with the form reset —
      proves the extracted component's create+reload cycle works, not just its read path
- [x] No console errors or warnings at any point during the browser walkthrough (checked after
      every navigation)

**Known artifact, disclosed rather than hidden:** the live activity-logging test above added one
real row ("Phase 5 split verification test", Call, today) to the Cipla Kurkumbh Plant lead's
activity timeline in the dev database. Activities have no delete/edit endpoint in this app by
design (append-only audit log, same as everywhere else soft-delete is used instead) — there's no
way to remove it through the application layer, and reaching around the app to delete it directly
in the database would be a worse precedent than one harmless, clearly-labeled test note. Flagged
here rather than silently left for someone to wonder about later.

**Verdict: Phase 5 items 3, 4, and 5 are complete.** Every page's error state now offers a scoped
retry, the three components named in the plan (dashboard/LeadDetailModal, plus NotificationBell
found during the survey) no longer silently swallow fetch failures, and both large files are split
along the seams the plan named — verified by a live, once-broken-then-recovered walkthrough of the
actual failure mode this item exists to fix, not just a green typecheck.

### Phase 5, item 6 — Verification (2026-09-22) — **PASSED**

`Server/README.md` was already partly current (Phase 1's `ENABLE_DEV_LOGIN` and Phase 4's Aiven
TLS/migration-baselining notes had been written in as those phases landed), but still described
`db:push` as the primary "create the tables" path and said nothing about the `{ error, code }`
shape from this phase's item 2, the new `utils/access.ts`/`utils/errors.ts` modules, or the actual
current route set (still only listed `auth`/`leads`/`reference` in the folder tree, though
proposals/projects/invoices/tasks/tenders/documents/tracker/notifications/activities have existed
since earlier sessions). `Client/README.md` was still the untouched Vite scaffold template — it
never described the app at all.

- [x] `Server/README.md`: rewrote "Create the tables" to present `db:migrate:deploy` as the normal
      path and `db:push` as local-only iteration (matching Phase 4's actual migration workflow);
      updated the npm-scripts table to match; added the `{ error, code }` shape to the API
      Reference section; added `utils/access.ts`/`utils/errors.ts`/`utils/sequence.ts` and
      `prisma/migrations/`/`tests/`/`certs/` to the folder structure; rewrote Roles & Permissions
      to describe the actual current visibility model (admin-sees-all / employee-sees-assigned,
      the full list of admin-only actions, the assign-to-admin block) instead of the stale
      "leads only" description from before proposals/projects/invoices/tasks existed
- [x] `Client/README.md`: replaced the generic Vite template with a real description of the app —
      how to run it against the backend, the dev-login bypass and why it's safe (`import.meta.env
      .DEV` gate), the post-split directory structure (`hooks/`, `components/dashboard/`,
      `components/leadDetail/`), the error/retry convention from item 3, and the SSE live-update
      mechanism
- [x] Scope check: deliberately did **not** attempt a full route-by-route API reference rewrite
      documenting every endpoint added across earlier, unrelated feature sessions (proposals/
      projects/invoices/etc. already had no README coverage before this hardening effort started,
      and backfilling that is a documentation debt from those sessions, not from Phases 1–5) —
      scoped this item to what Phases 1–5's actual changes require the docs to now say, per the
      item's own wording ("update... to match actual behavior once the above lands")
- [x] Read both files back in full after editing to confirm they render as valid Markdown and
      match the real `package.json` script names (`db:migrate:deploy`, `db:migrate:status`,
      `db:migrate`, `db:push`, `db:generate`, `db:seed`, `db:studio`, `db:import-tracker` for
      Server; `dev`, `build`, `lint`, `preview` for Client) — checked directly against each
      `package.json`, not from memory

**Verdict: Phase 5 item 6 is complete**, scoped to documenting what this hardening effort actually
changed rather than backfilling unrelated pre-existing documentation gaps.

## Phase 5 — Verdict

**All 6 items complete.** Duplicated permission helpers consolidated into one module (8 files, 3
more than originally scoped, found via a repo-wide grep rather than trusting the original list);
every error response in the app standardized to `{ error, code }` including new 404/500 fallback
handlers; every page's error state now offers a scoped retry, proven by actually killing and
restarting the backend rather than just wiring the code; `dashboard.tsx` and `LeadDetailModal.tsx`
split along the seams named in the plan (874→274 and 406→124 lines respectively); and both READMEs
brought back in line with what Phases 1–5 actually built. Every item was verified against a live
running server (or, for the client, a live browser session against a live server) and the full
15-test automated suite — re-run clean after each of this phase's structural changes — not just a
passing typecheck.

This closes out the hardening initiative that began at Phase 1. `HARDENING_TODO.md` now reflects
five complete phases, each independently verified and logged.

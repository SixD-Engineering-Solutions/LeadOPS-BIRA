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

## Phase 4 — Infra hygiene (before this grows past "internal tool, small team") — 3/4 done

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
- [ ] Add focused tests covering Phases 1–3 specifically: permission matrix (admin vs.
      employee, allowed + denied case per resource/action), invoice recompute boundary cases
      (exact/partial/over/zero), concurrent numbering + transaction races — not a
      test-everything push

### Phase 4 — Verification so far (2026-09-22) — 3/4 items PASSED

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
- [ ] Phase 4 test-suite item not yet started — verification for it will follow once written

## Phase 5 — Code health (opportunistic, not blocking anything)

- [ ] Consolidate the repeated `isAdmin()` / `canAccessX()` pairs duplicated across
      `leads.ts`, `proposals.ts`, `projects.ts`, `invoices.ts`, `documents.ts` into one shared
      helper module
- [ ] Standardize the backend error response shape across all routes (including 500s); add a
      stable machine-readable code alongside the human message
- [ ] Add distinct loading / empty / error UI states with a retry action wherever still missing
- [ ] Split `Client/src/pages/dashboard.tsx` (~880 lines) along its existing internal seams
      (stats / proposal stats / invoice stats / follow-ups / sidebar) into separate
      components/hooks
- [ ] Split `Client/src/components/LeadDetailModal.tsx`'s activity / proposal / document
      handling into three sub-components
- [ ] Update `Server/README.md` / `Client/README.md` to match actual behavior once the above
      lands (new env vars, migration workflow replacing `db push`, etc.)

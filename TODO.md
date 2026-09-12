
# CRM Roadmap — TODO

## Current State (already built)
- [x] Lead management: `Lead`, `LeadStatus`, assignment to users
- [x] Client hierarchy: `Location -> Plant -> Contact`
- [x] Lookups: `Vertical`, `Sector`
- [x] Tasks with deadlines, Notifications
- [x] Pages: dashboard, leads, tasks, team, catalog, reports, login


## Phase 1 — Foundation (Client + Lookups)
- [x] Add `Client` model above `Plant` (industry type, website, LinkedIn)
- [x] Add `ClientCategory` lookup (Govt / Private / PSU / EPC / Consultant)
- [x] Add `LeadSource` lookup (Expo / Reference / Website / Cold mail / Call)
- [x] Add `ServiceType` lookup (Laser scanning / 3D modelling / BIM / RBI / Tank inspection / SOP / Engineering services)
- [x] Link `Plant` to `Client`
- [x] Link `Lead` to `LeadSource`, `ServiceType`
- [x] Backfill: existing `Plant.companyName` values migrated into `Client` rows (17 clients created from 18 plants; the 43 plants with no `companyName` were left unlinked — nothing to base a client on)

## Phase 2 — Activity Tracking
- [x] Add `Activity` model (date, user, lead, type: Call/Visit/Meeting/Mail/Proposal, notes, next action date)
- [x] Activity list/timeline view per lead (in the lead detail modal)
- [x] Dashboard: Today's follow-ups
- [x] Dashboard: Overdue follow-ups
- [x] Dashboard: Upcoming meetings (next 7 days, shown as a count)

## Phase 3 — Proposal / Opportunity Tracking
- [x] Add `Proposal` model (proposal number — auto-generated PROP-0001 style, lead, project name, value, submission date, status, probability %, expected order date)
- [x] Proposal status workflow (Draft / Submitted / Follow-up / Negotiation / Won / Lost / Hold)
- [x] Proposal list page (`Client/src/pages/proposals.tsx`) + per-lead proposals shown in the lead detail modal
- [x] Dashboard: Pipeline Value tile (sum of open proposals, replaced the old unwired "Revenue" placeholder)

## Phase 4 — Project / Work Order Tracking
- [x] Add `Project` model (WO no — auto-generated WO-0001 style, lead, project name, location, start/completion date, responsible engineer, status, billing stage)
- [x] Auto-create Project when Proposal marked "Won" (in `proposals.ts` PATCH handler)
- [x] Project status tracking page (`Client/src/pages/projects.tsx`)

## Phase 5 — Document Storage (deferred — revisit after Phase 6)
- [x] Choose storage provider — local disk (`Server/uploads/documents`, gitignored), auto-created at server startup
- [x] Add `Document` model (leadId, fileName, bcrypt-derived `storedFileName`, fileSize, uploader, date)
- [x] Upload support — PDF only, capped at 10MB (multer `fileFilter` + `limits`), tracked per lead
- [x] Document viewer/list per lead (in the lead detail modal — upload, list, download)
- [ ] Not yet done: attaching documents directly to Proposals/Projects, or non-PDF types (Drawing/Agreement/MOM/Photos) — scoped down to "PDFs on leads" for this pass; revisit if needed

## Phase 6 — Billing / Payment
- [x] Add `Invoice` model (invoice number — auto-generated INV-0001 style, linked to Project, amount, dates, status)
- [x] Add `Payment` model (linked to Invoice, amount received, date, notes) — invoice status (Paid/Partially Paid) is recomputed server-side from payments, not hand-set
- [x] Dashboard: Pending Payments widget (invoices with an outstanding balance)
- [x] Invoices page (`Client/src/pages/invoices.tsx`) — create, log payments, change status; Projects page shows a per-project billing summary column

## Phase 7 — Dashboard & Reporting Expansion
- [x] Total leads / active leads widget — already existed (Total Leads + Active Campaigns tiles)
- [x] Total proposal value widget — already existed (Pipeline Value tile, from Phase 3)
- [x] Orders received widget (sum of Won proposal value, dashboard stat tile)
- [x] Lost deals widget (count + value of Lost proposals, dashboard stat tile)
- [x] Monthly performance chart (Won vs Lost proposal value by month, Reports page)
- [x] Employee-wise performance report (leads/won/lost/conversion/won-value table, Reports page)

## Phase 8 — Specialized Modules
- [x] Empanelment tracking (client, service category, status, renewal date) — `empanelments.tsx`
- [x] Tender tracking (manually-entered tender no, client, submission date, value, status) — `tenders.tsx`
- [x] Expo / visit data tagging — `Event` model (name, type, date), leads generated tracked live per event; leads can be tagged to an event on creation
- [x] Global client tracking (`country`/`region` fields added to `Client`)

---

## Decisions to lock in before starting
- [x] Lookup tables editable via admin UI — done (Catalog page: Client, Client Category, Lead Source, Service Type, Events all editable there)
- [x] Document storage provider — local disk for now (Phase 5, deferred); wider/cloud storage is the open item noted in Phase 5 above
- [x] Proposal and Project confirmed as separate models (not merged)

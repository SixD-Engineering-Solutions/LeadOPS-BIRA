# LeadOps Frontend

React + TypeScript + Vite single-page app for the LeadOps CRM — lead capture, proposals, projects,
invoices/payments, tasks, tenders, and an imported pipeline/invoice tracker. Talks to the
[Server](../Server/README.md) REST API over JSON, with live updates over Server-Sent Events.

---

## Running

```powershell
npm install
npm run dev      # http://localhost:5173 (or the next free port, e.g. 5174)
```

Needs the backend running too (`npm run dev` in `Server/`) — see its README for setup.

By default the client talks to `http://localhost:3000`. Override with a `.env` file if the backend
runs elsewhere:

```env
VITE_API_URL="http://localhost:3000"
```

Other scripts: `npm run build` (typecheck + production build), `npm run preview` (serve the
build), `npm run lint`.

### Dev login bypass

`src/lib/devAuth.ts` lets you sign in without a real account **in a dev build only**
(`import.meta.env.DEV` is hard-coded `false` in `vite build`, so this can't reach production):
email `dev@leadops.local`, password `devmode123`, signs in as an admin. Useful when the database is
reachable but you don't want to create a real account, or for quick UI verification.

---

## Structure

```text
src/
├── pages/                    # One file per top-level view (dashboard, leads, proposals,
│                              #   projects, invoices, tasks, tenders, tracker, reports, team,
│                              #   catalog, login) — routed by Dashboard's own tab state, not
│                              #   a router library
├── components/
│   ├── dashboard/             # Dashboard's own sub-components (sidebar, stat tiles, follow-ups/
│   │                          #   pending-payments/tasks panels, lead-assignments modal, icons)
│   ├── leadDetail/             # LeadDetailModal's three independent sections (documents,
│   │                          #   proposals, activity timeline) — each owns its own fetch,
│   │                          #   form, and error/retry state
│   ├── ErrorBanner.tsx         # Shared error message + retry button, used wherever a fetch can fail
│   ├── LeadDetailModal.tsx     # Composes leadDetail/* plus the lead's static info sections
│   └── NotificationBell.tsx    # Notification dropdown + live SSE toast stream
├── hooks/                     # Dashboard's data-fetching hooks (useLeadStats, useProposalStats,
│                              #   usePendingInvoices, useMyTasks, useFollowUps) — each owns one
│                              #   data source's fetch, SSE-resync listener, and error/reload
├── lib/
│   ├── api.ts                 # Typed API client (`api()`), all shared types, SSE event names
│   └── devAuth.ts              # Dev-only login bypass (see above)
└── App.tsx                    # Auth gate — renders Login or Dashboard
```

---

## Error handling

Every fetch that can fail shows a distinct loading / empty / error state, and an error always
offers a scoped retry (`components/ErrorBanner.tsx`) rather than silently leaving stale or empty
data on screen — each data source retries only itself, not the whole page. The API client
(`api()` in `lib/api.ts`) reads the backend's `{ error, code }` shape (see the
[Server README](../Server/README.md#api-reference)) and throws an `Error` carrying the human
message; `code` isn't currently used client-side but is available on the response if a future
change needs to branch on it instead of the message text.

---

## Live updates

The backend pushes changes over a single SSE connection (`NotificationBell.tsx` owns the
`EventSource`) and re-broadcasts them as `window` `CustomEvent`s (`LEAD_SYNC_EVENT`,
`TASK_SYNC_EVENT`, `ACTIVITY_SYNC_EVENT`, `PROPOSAL_SYNC_EVENT`, `PROJECT_SYNC_EVENT`,
`INVOICE_SYNC_EVENT` — all defined in `lib/api.ts`). Any component that shows one of these
entities listens for its event and re-fetches, so a change made in one tab (or by another user)
shows up everywhere without a manual refresh.

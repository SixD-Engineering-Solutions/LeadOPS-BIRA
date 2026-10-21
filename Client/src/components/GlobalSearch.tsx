import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { Lead, Proposal, Project, Invoice } from '../lib/api'
import { formatINR } from '../lib/format'
import { LeadDetailById } from './LeadDetailModal'

type Page = { key: string; label: string }
type Data = { leads: Lead[]; proposals: Proposal[]; projects: Project[]; invoices: Invoice[] }
type Result = { id: string; group: string; title: string; sub?: string; select: () => void }

const STALE_MS = 60_000
const PER_GROUP = 5
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean)
const matches = (text: string, terms: string[]) => { const t = text.toLowerCase(); return terms.every(w => t.includes(w)) }

// The top bar's search: one box for every lead, proposal, project and invoice
// you can see, plus the app's pages. Ctrl+K (⌘K) or "/" jumps to it. Picking a
// record opens its lead's side panel over whatever page you're on; picking a
// page goes there. Data is fetched when the box is first used, and again if
// it's over a minute old.
export function GlobalSearch({ pages, onNavigate }: { pages: Page[]; onNavigate: (page: Page) => void }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const [openLeadId, setOpenLeadId] = useState<string | null>(null)
  const loadedAt = useRef(0)
  const input = useRef<HTMLInputElement | null>(null)
  const box = useRef<HTMLDivElement | null>(null)

  function ensureData() {
    if (loading || Date.now() - loadedAt.current < STALE_MS) return
    setLoading(true)
    Promise.allSettled([
      api<{ leads: Lead[] }>('/leads', { auth: true }),
      api<{ proposals: Proposal[] }>('/proposals', { auth: true }),
      api<{ projects: Project[] }>('/projects', { auth: true }),
      api<{ invoices: Invoice[] }>('/invoices', { auth: true }),
    ]).then(([l, p, pr, i]) => {
      setData({
        leads: l.status === 'fulfilled' ? l.value.leads : [],
        proposals: p.status === 'fulfilled' ? p.value.proposals : [],
        projects: pr.status === 'fulfilled' ? pr.value.projects : [],
        invoices: i.status === 'fulfilled' ? i.value.invoices : [],
      })
      loadedAt.current = Date.now()
    }).finally(() => setLoading(false))
  }

  // Ctrl+K / ⌘K anywhere, or "/" when not already typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
        e.preventDefault()
        setMobileOpen(true)
        // On a desktop the box is already showing: focus it now. On a phone
        // it appears with this render, so wait a frame.
        if (input.current?.offsetParent) input.current.focus()
        else requestAnimationFrame(() => input.current?.focus())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) { setOpen(false); setMobileOpen(false) } }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const terms = words(query)
  const close = () => { setOpen(false); setMobileOpen(false); setQuery(''); input.current?.blur() }
  const openLead = (id: string | undefined) => { if (id) { close(); setOpenLeadId(id) } }

  const results: Result[] = []
  const add = <T,>(group: string, rows: T[], text: (r: T) => string, make: (r: T) => Omit<Result, 'group'>) => {
    let n = 0
    for (const r of rows) {
      if (n >= PER_GROUP) break
      if (matches(text(r), terms)) { results.push({ group, ...make(r) }); n++ }
    }
  }
  if (terms.length > 0) {
    add('Pages', pages, p => p.label, p => ({ id: `page-${p.key}`, title: p.label, sub: 'Go to page', select: () => { close(); onNavigate(p) } }))
    if (data) {
      add('Leads', data.leads,
        l => [l.plant?.plantName, l.plant?.client?.clientName, l.contact?.contactPersonName, l.plant?.location?.city, l.sector?.sectorName].join(' '),
        l => ({ id: `lead-${l.id}`, title: l.plant?.plantName ?? 'Lead', sub: [l.plant?.client?.clientName, l.plant?.location?.city, l.status?.statusName].filter(Boolean).join(' · '), select: () => openLead(l.id) }))
      add('Proposals', data.proposals,
        p => [p.proposalNumber, p.projectName, p.lead?.plant?.plantName, p.lead?.plant?.client?.clientName].join(' '),
        p => ({ id: `prop-${p.id}`, title: p.proposalNumber, sub: [p.lead?.plant?.plantName, p.value != null ? formatINR(p.value) : null, p.status].filter(Boolean).join(' · '), select: () => openLead(p.leadId) }))
      add('Projects', data.projects,
        p => [p.workOrderNo, p.projectName, p.lead?.plant?.plantName, p.lead?.plant?.client?.clientName].join(' '),
        p => ({ id: `proj-${p.id}`, title: `${p.workOrderNo} · ${p.projectName}`, sub: [p.lead?.plant?.plantName, p.status].filter(Boolean).join(' · '), select: () => openLead(p.leadId) }))
      add('Invoices', data.invoices,
        i => [i.invoiceNumber, i.project?.workOrderNo, i.project?.projectName, i.project?.lead?.plant?.client?.clientName].join(' '),
        i => ({ id: `inv-${i.id}`, title: i.invoiceNumber, sub: [i.project?.lead?.plant?.client?.clientName ?? i.project?.projectName, formatINR(i.amount), i.status].filter(Boolean).join(' · '), select: () => openLead(i.project?.lead?.id) }))
    }
  }
  const activeIndex = Math.min(active, Math.max(0, results.length - 1))

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((activeIndex + 1) % Math.max(1, results.length)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((activeIndex - 1 + results.length) % Math.max(1, results.length)) }
    else if (e.key === 'Enter') { e.preventDefault(); results[activeIndex]?.select() }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
  }

  const showPanel = open && query.trim().length > 0

  return (
    <>
      {/* phones: just an icon until tapped */}
      <button
        type="button"
        onClick={() => { setMobileOpen(true); requestAnimationFrame(() => input.current?.focus()) }}
        aria-label="Search"
        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 md:hidden dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
      >
        <SearchIcon />
      </button>

      <div
        ref={box}
        className={`${mobileOpen ? 'absolute inset-x-0 top-0 z-10 flex h-16 items-center bg-white px-3 dark:bg-gray-900' : 'hidden'} md:relative md:flex md:h-auto md:w-full md:max-w-md md:bg-transparent md:px-0`}
      >
        <div className="relative w-full">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"><SearchIcon /></span>
          <input
            ref={input}
            type="search"
            role="combobox"
            aria-expanded={showPanel}
            aria-controls="global-search-results"
            aria-activedescendant={showPanel && results[activeIndex] ? `gs-${results[activeIndex].id}` : undefined}
            aria-label="Search leads, proposals, projects and invoices"
            value={query}
            onChange={e => { setQuery(e.target.value); setActive(0); setOpen(true) }}
            onFocus={() => { setOpen(true); ensureData() }}
            onKeyDown={onKeyDown}
            placeholder="Search leads, proposals, invoices…"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2 pl-9 pr-14 text-sm text-gray-800 outline-none placeholder:text-gray-400 focus:border-transparent focus:bg-white focus:ring-2 focus:ring-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:bg-gray-800 [&::-webkit-search-cancel-button]:hidden"
          />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded-md border border-gray-200 bg-white px-1.5 py-0.5 font-sans text-[10px] font-semibold text-gray-400 md:block dark:border-gray-600 dark:bg-gray-700 dark:text-gray-400">
            {isMac ? '⌘K' : 'Ctrl K'}
          </kbd>

          {showPanel && (
            <div id="global-search-results" role="listbox" className="popover-in absolute left-0 right-0 top-full mt-2 max-h-[70vh] overflow-y-auto rounded-xl border border-gray-100 bg-white p-1.5 shadow-xl shadow-gray-900/10 dark:border-gray-700 dark:bg-gray-800 dark:shadow-black/40">
              {results.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-gray-400">{loading && !data ? 'Searching…' : `Nothing matches “${query.trim()}”`}</p>
              ) : results.map((r, i) => (
                <div key={r.id}>
                  {(i === 0 || results[i - 1].group !== r.group) && (
                    <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{r.group}</p>
                  )}
                  <button
                    id={`gs-${r.id}`}
                    type="button"
                    role="option"
                    aria-selected={i === activeIndex}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={e => e.preventDefault()}
                    onClick={r.select}
                    className={`flex w-full flex-col rounded-lg px-2.5 py-1.5 text-left outline-none ${i === activeIndex ? 'bg-orange-50 dark:bg-orange-500/10' : ''}`}
                  >
                    <span className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">{r.title}</span>
                    {r.sub && <span className="truncate text-[11px] text-gray-500 dark:text-gray-400">{r.sub}</span>}
                  </button>
                </div>
              ))}
              {loading && data && <p className="px-2.5 py-1 text-[11px] text-gray-400">Refreshing…</p>}
            </div>
          )}
        </div>
        {mobileOpen && (
          <button type="button" onClick={close} className="ml-2 shrink-0 text-sm font-medium text-gray-500 md:hidden dark:text-gray-400">Cancel</button>
        )}
      </div>

      {openLeadId && <LeadDetailById leadId={openLeadId} onClose={() => setOpenLeadId(null)} />}
    </>
  )
}

const SearchIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M8.5 3a5.5 5.5 0 014.38 8.82l3.65 3.65a1 1 0 01-1.42 1.42l-3.65-3.65A5.5 5.5 0 118.5 3zm0 2a3.5 3.5 0 100 7 3.5 3.5 0 000-7z" clipRule="evenodd" />
  </svg>
)

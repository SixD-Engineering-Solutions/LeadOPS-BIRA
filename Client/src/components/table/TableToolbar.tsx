import { useState } from 'react'
import type { ReactNode } from 'react'
import type { TableView } from '../../lib/useTableView'
import { formatCount } from '../../lib/format'
import { Popover } from './Popover'
import type { Column } from './DataGrid'
import { exportTableCsv } from '../../lib/csv'

type View = Pick<TableView<unknown>, 'views' | 'view' | 'setView' | 'query' | 'setQuery' | 'facets' | 'setFilter' | 'clearFilters' | 'isFiltered' | 'matching' | 'total'
  | 'saved' | 'activeSaved' | 'saveFilter' | 'applySaved' | 'removeSaved'>

// Above every table: the view tabs ("All · My leads · Unassigned"), then a
// search box, a menu per filter, saved filters, and how many rows are
// showing. `exportCsv` adds an "Export" button that downloads every row the
// search and filters leave, with the table's own columns. `children` goes at
// the right end (e.g. a Refresh button).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any table's columns
export function TableToolbar({ view, noun, placeholder, exportCsv, children }: { view: View; noun: string; placeholder: string; exportCsv?: { filename: string; columns: Column<any>[] }; children?: ReactNode }) {
  const showing = view.matching.length
  return (
    <div className="border-b border-gray-100 dark:border-gray-800">
      {view.views.length > 1 && (
        <div className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-gray-100 px-3 [scrollbar-width:none] dark:border-gray-800 [&::-webkit-scrollbar]:hidden" role="tablist" aria-label={`${noun} views`}>
          {view.views.map(v => {
            const active = v.id === view.view
            return (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => view.setView(v.id)}
                className={`-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-xs font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-orange-300 ${
                  active ? 'border-orange-500 text-gray-900 dark:text-gray-100' : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                {v.label}
                <span className={`rounded-full px-1.5 py-px text-[10px] tabular-nums ${active ? 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>
                  {formatCount(v.count)}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 px-5 py-3">
        <label className="relative w-full sm:w-64">
          <span className="sr-only">Search {noun}</span>
          <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M8.5 3a5.5 5.5 0 014.38 8.82l3.65 3.65a1 1 0 01-1.42 1.42l-3.65-3.65A5.5 5.5 0 118.5 3zm0 2a3.5 3.5 0 100 7 3.5 3.5 0 000-7z" clipRule="evenodd" />
          </svg>
          <input
            type="search"
            data-table-search
            value={view.query}
            onChange={e => view.setQuery(e.target.value)}
            placeholder={placeholder}
            className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-xs text-gray-800 outline-none placeholder:text-gray-400 focus:border-transparent focus:ring-2 focus:ring-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 [&::-webkit-search-cancel-button]:cursor-pointer"
          />
        </label>

        {view.facets.map(f => <FilterMenu key={f.id} facet={f} onChange={values => view.setFilter(f.id, values)} />)}

        {view.isFiltered && (
          <button type="button" onClick={view.clearFilters} className="rounded-lg px-2 py-1.5 text-xs font-medium text-gray-500 outline-none hover:text-gray-800 focus-visible:ring-2 focus-visible:ring-orange-300 dark:text-gray-400 dark:hover:text-gray-200">
            Clear all
          </button>
        )}

        <SavedMenu view={view} />

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400" aria-live="polite">
            {view.isFiltered ? `${formatCount(showing)} of ${formatCount(view.total)} ${noun}` : `${formatCount(showing)} ${noun}`}
          </span>
          {exportCsv && <ExportButton filename={exportCsv.filename} columns={exportCsv.columns} rows={view.matching} />}
          {children}
        </div>
      </div>
    </div>
  )
}

// Named search + filter sets for this table: one click to apply, saved in
// this browser. "Save current filters…" appears once something is filtered.
function SavedMenu({ view }: { view: View }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  if (view.saved.length === 0 && !view.isFiltered) return null
  const close = () => { setAnchor(null); setNaming(false); setName('') }
  const save = () => {
    const n = name.trim()
    if (!n) return
    view.saveFilter(n)
    close()
  }

  return (
    <>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onClick={e => (anchor ? close() : setAnchor(e.currentTarget))}
        className={`inline-flex max-w-[200px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-orange-300 ${
          view.activeSaved
            ? 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/40 dark:bg-orange-500/10 dark:text-orange-300'
            : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-800 dark:border-gray-700 dark:text-gray-300'
        }`}
      >
        <svg className="h-3 w-3 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M5 3a2 2 0 00-2 2v12l7-3.5 7 3.5V5a2 2 0 00-2-2H5z" /></svg>
        <span className="truncate">{view.activeSaved ?? 'Saved'}</span>
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={close} label="Saved filters" minWidth={240}>
          {view.saved.length > 0 && (
            <div className="max-h-64 overflow-y-auto">
              {view.saved.map(f => (
                <div key={f.name} className="group flex items-center rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/60">
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={view.activeSaved === f.name}
                    onClick={() => { view.applySaved(f.name); close() }}
                    className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left text-xs text-gray-700 outline-none focus:bg-gray-50 dark:text-gray-200 dark:focus:bg-gray-700/60"
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${view.activeSaved === f.name ? 'bg-orange-500' : 'bg-transparent'}`} />
                    <span className="truncate">{f.name}</span>
                  </button>
                  <button type="button" onClick={() => view.removeSaved(f.name)} aria-label={`Delete saved filter ${f.name}`} className="mr-1 rounded px-1.5 text-gray-300 outline-none hover:text-rose-500 focus-visible:ring-2 focus-visible:ring-orange-300 dark:text-gray-600">✕</button>
                </div>
              ))}
            </div>
          )}
          {view.isFiltered && !view.activeSaved && (
            <div className={view.saved.length ? 'mt-1 border-t border-gray-100 pt-1 dark:border-gray-700' : ''}>
              {naming ? (
                <form onSubmit={e => { e.preventDefault(); save() }} className="flex gap-1.5 p-1">
                  <input
                    autoFocus
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. My open leads in Steel"
                    aria-label="Name for these filters"
                    maxLength={40}
                    className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-orange-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                  />
                  <button type="submit" disabled={!name.trim()} className="rounded-lg bg-orange-500 px-2 py-1 text-xs font-semibold text-white disabled:opacity-40">Save</button>
                </form>
              ) : (
                <button type="button" role="menuitem" onClick={() => setNaming(true)} className="w-full rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-orange-600 outline-none hover:bg-gray-50 focus:bg-gray-50 dark:text-orange-300 dark:hover:bg-gray-700/60">
                  + Save current filters…
                </button>
              )}
            </div>
          )}
        </Popover>
      )}
    </>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any table's columns and rows
function ExportButton({ filename, columns, rows }: { filename: string; columns: Column<any>[]; rows: unknown[] }) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      disabled={busy || rows.length === 0}
      onClick={() => { setBusy(true); exportTableCsv(filename, columns, rows).finally(() => setBusy(false)) }}
      title={`Download these ${formatCount(rows.length)} rows as a spreadsheet (CSV)`}
      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-gray-500 outline-none transition hover:bg-gray-100 hover:text-gray-800 focus-visible:ring-2 focus-visible:ring-orange-300 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
    >
      <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M10 3a1 1 0 011 1v7.6l2.3-2.3a1 1 0 111.4 1.4l-4 4a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L9 11.6V4a1 1 0 011-1zM4 15a1 1 0 011 1h10a1 1 0 112 0 2 2 0 01-2 2H5a2 2 0 01-2-2 1 1 0 011-1z" clipRule="evenodd" /></svg>
      {busy ? 'Exporting…' : 'Export'}
    </button>
  )
}

type Facet = View['facets'][number]

function FilterMenu({ facet, onChange }: { facet: Facet; onChange: (values: string[]) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [search, setSearch] = useState('')
  const selected = facet.selected
  const options = search ? facet.options.filter(o => o.label.toLowerCase().includes(search.toLowerCase())) : facet.options
  if (facet.options.length === 0) return null
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v])
  const summary = selected.length === 0 ? null
    : selected.length === 1 ? facet.options.find(o => o.value === selected[0])?.label ?? selected[0]
    : `${selected.length} selected`

  return (
    <>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        aria-label={`Filter by ${facet.label}${summary ? `: ${summary}` : ""}`}
        onClick={e => setAnchor(anchor ? null : e.currentTarget)}
        className={`inline-flex max-w-[220px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-orange-300 ${
          summary
            ? 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/40 dark:bg-orange-500/10 dark:text-orange-300'
            : 'border-dashed border-gray-300 text-gray-600 hover:border-gray-400 hover:text-gray-800 dark:border-gray-600 dark:text-gray-300 dark:hover:border-gray-500'
        }`}
      >
        {!summary && (
          <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M10 4a1 1 0 011 1v4h4a1 1 0 110 2h-4v4a1 1 0 11-2 0v-4H5a1 1 0 110-2h4V5a1 1 0 011-1z" /></svg>
        )}
        <span>{facet.label}</span>
        {summary && <span className="truncate font-semibold">: {summary}</span>}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => { setAnchor(null); setSearch('') }} label={`Filter by ${facet.label}`} minWidth={220}>
          {facet.options.length > 8 && (
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={`Search ${facet.label.toLowerCase()}…`}
              aria-label={`Search ${facet.label}`}
              className="mb-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-orange-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
          )}
          <div className="max-h-72 overflow-y-auto">
            {options.map(o => {
              const on = selected.includes(o.value)
              return (
                <button
                  key={o.value}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={on}
                  onClick={() => toggle(o.value)}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-gray-700 outline-none hover:bg-gray-50 focus:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700/60 dark:focus:bg-gray-700/60"
                >
                  <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${on ? 'border-orange-500 bg-orange-500 text-white' : 'border-gray-300 dark:border-gray-600'}`}>
                    {on && <svg className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L8 12.6l7.3-7.3a1 1 0 011.4 0z" clipRule="evenodd" /></svg>}
                  </span>
                  <span className={`min-w-0 flex-1 truncate ${o.value === '(blank)' ? 'italic text-gray-400' : ''}`}>{o.label}</span>
                  <span className="shrink-0 tabular-nums text-[11px] text-gray-400 dark:text-gray-500">{formatCount(o.count)}</span>
                </button>
              )
            })}
            {options.length === 0 && <p className="px-2.5 py-2 text-xs text-gray-400">No matches</p>}
          </div>
          {selected.length > 0 && (
            <div className="mt-1 border-t border-gray-100 pt-1 dark:border-gray-700">
              <button type="button" role="menuitem" onClick={() => onChange([])} className="w-full rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-gray-500 outline-none hover:bg-gray-50 focus:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700/60">
                Clear {facet.label.toLowerCase()} filter
              </button>
            </div>
          )}
        </Popover>
      )}
    </>
  )
}

const PAGE_SIZES = [25, 50, 100, 0] as const

// Under every table: which rows are showing, the page size, and paging.
// Hidden when everything fits on one page at the smallest size.
export function TableFooter({ view }: { view: Pick<TableView<unknown>, 'matching' | 'page' | 'pageCount' | 'pageSize' | 'setPage' | 'setPageSize'> }) {
  const n = view.matching.length
  if (n <= PAGE_SIZES[0]) return null
  const from = view.pageSize ? view.page * view.pageSize + 1 : 1
  const to = view.pageSize ? Math.min(n, from + view.pageSize - 1) : n
  const btn = 'inline-flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 text-gray-500 outline-none transition hover:bg-gray-50 hover:text-gray-800 focus-visible:ring-2 focus-visible:ring-orange-300 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200'

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-xs text-gray-500 dark:text-gray-400">
      <span className="tabular-nums">Showing {formatCount(from)}–{formatCount(to)} of {formatCount(n)}</span>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5">
          Rows per page
          <select
            value={view.pageSize}
            onChange={e => view.setPageSize(Number(e.target.value))}
            className="rounded-lg border border-gray-200 bg-white px-1.5 py-1 text-xs text-gray-700 outline-none focus:ring-2 focus:ring-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            {PAGE_SIZES.map(s => <option key={s} value={s}>{s || 'All'}</option>)}
          </select>
        </label>
        {view.pageCount > 1 && (
          <div className="flex items-center gap-1.5">
            <button type="button" className={btn} disabled={view.page === 0} onClick={() => view.setPage(view.page - 1)} aria-label="Previous page">
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M12.8 5.2a1 1 0 010 1.4L9.4 10l3.4 3.4a1 1 0 11-1.4 1.4l-4.1-4.1a1 1 0 010-1.4l4.1-4.1a1 1 0 011.4 0z" clipRule="evenodd" /></svg>
            </button>
            <span className="tabular-nums">Page {view.page + 1} of {view.pageCount}</span>
            <button type="button" className={btn} disabled={view.page >= view.pageCount - 1} onClick={() => view.setPage(view.page + 1)} aria-label="Next page">
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M7.2 14.8a1 1 0 010-1.4l3.4-3.4-3.4-3.4a1 1 0 011.4-1.4l4.1 4.1a1 1 0 010 1.4l-4.1 4.1a1 1 0 01-1.4 0z" clipRule="evenodd" /></svg>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** The body of a table whose search / filters leave nothing. */
export function NoMatches({ noun, onClear }: { noun: string; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center px-5 py-12 text-center">
      <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">No {noun} match</p>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Try a different search, or clear the filters.</p>
      <button type="button" onClick={onClear} className="mt-4 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-orange-300 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
        Clear filters
      </button>
    </div>
  )
}

/** The small "Refresh" icon button at the end of a toolbar. */
export function RefreshButton({ onClick, busy = false }: { onClick: () => void; busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Refresh"
      aria-label="Refresh"
      className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 outline-none transition hover:bg-gray-100 hover:text-gray-700 focus-visible:ring-2 focus-visible:ring-orange-300 dark:hover:bg-gray-800 dark:hover:text-gray-200"
    >
      <svg className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M4 4a1 1 0 011 1v1.6A7 7 0 0117 9a1 1 0 11-2 .3 5 5 0 00-9-2.3h2a1 1 0 110 2H4a1 1 0 01-1-1V5a1 1 0 011-1zm12 7a1 1 0 011 1v4a1 1 0 11-2 0v-1.6A7 7 0 013 11a1 1 0 112-.3 5 5 0 009 2.3h-2a1 1 0 110-2h4z" clipRule="evenodd" />
      </svg>
    </button>
  )
}

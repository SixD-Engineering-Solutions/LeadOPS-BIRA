import { useState } from 'react'

// Search, view tabs, filters, column sorting and paging for one table — the
// same behaviour on every list in the app (components/table/ draws it).
// Remembered per table in this browser, so a list opens the way it was left;
// the page number isn't, so a list always opens on its first page.

export type SortDir = 'asc' | 'desc'
export type SortState = { id: string; dir: SortDir }

export type SortSpec<T> = {
  /** The value to sort by. Blank (null / undefined / '') always sorts last. */
  value?: (row: T) => string | number | null | undefined
  /** For orderings a single value can't express (e.g. "on hold always last"). */
  compare?: (a: T, b: T, dir: 1 | -1) => number
  /** The direction a first click picks: newest / biggest first for dates and amounts. */
  firstDir?: SortDir
}

export type FilterDef<T> = {
  id: string
  label: string
  /** The row's value(s) for this filter; a row with several matches any of them. */
  value: (row: T) => string | string[] | null | undefined
  /** Fixed order for the options (e.g. a status's natural order); others follow A→Z. */
  order?: readonly string[]
}

export type ViewDef<T> = {
  id: string
  label: string
  match?: (row: T) => boolean
}

type Stored = { view: string; query: string; filters: Record<string, string[]>; sort: SortState | null; pageSize: number }

export type TableView<T> = ReturnType<typeof useTableView<T>>

const BLANK = '(blank)'
const keyOf = (id: string) => `leadops.table.${id}`

function load(id: string): Partial<Stored> {
  try {
    const raw = localStorage.getItem(keyOf(id))
    return raw ? (JSON.parse(raw) as Partial<Stored>) : {}
  } catch {
    return {}
  }
}

function save(id: string, s: Stored) {
  try { localStorage.setItem(keyOf(id), JSON.stringify(s)) } catch { /* private window etc. — just not remembered */ }
}

const valuesOf = <T,>(f: FilterDef<T>, row: T): string[] => {
  const v = f.value(row)
  const list = (Array.isArray(v) ? v : [v]).map(x => (x ?? '').toString().trim())
  return list.some(Boolean) ? list.filter(Boolean) : [BLANK]
}

const isBlank = (v: unknown) => v == null || v === '' || (typeof v === 'number' && Number.isNaN(v))

export function useTableView<T>(opts: {
  id: string
  rows: T[]
  search: (row: T) => string
  filters?: FilterDef<T>[]
  views?: ViewDef<T>[]
  sorts?: Record<string, SortSpec<T>>
  defaultSort?: SortState | null
  defaultPageSize?: number
}) {
  const { id, rows, search, filters = [], views = [], sorts = {}, defaultSort = null, defaultPageSize = 50 } = opts

  const [state, setState] = useState<Stored>(() => {
    const s = load(id)
    return {
      view: s.view && views.some(v => v.id === s.view) ? s.view : views[0]?.id ?? '',
      query: s.query ?? '',
      filters: s.filters ?? {},
      sort: s.sort && sorts[s.sort.id] ? s.sort : defaultSort,
      pageSize: s.pageSize ?? defaultPageSize,
    }
  })
  const [page, setPage] = useState(0)

  const update = (patch: Partial<Stored>) => {
    setState(prev => {
      const next = { ...prev, ...patch }
      save(id, next)
      return next
    })
    setPage(0)
  }

  const activeView = views.find(v => v.id === state.view)
  const tokens = state.query.toLowerCase().split(/\s+/).filter(Boolean)
  const activeFilters = filters.filter(f => (state.filters[f.id] ?? []).length > 0)

  // Recomputed every render: these lists are hundreds of rows, not thousands,
  // and it can never go stale when data a sort depends on (e.g. lead
  // statuses) arrives after the rows.
  const result = (() => {
    const searchText = new Map<T, string>()
    const textOf = (r: T) => {
      let t = searchText.get(r)
      if (t == null) { t = search(r).toLowerCase(); searchText.set(r, t) }
      return t
    }
    const passQuery = (r: T) => tokens.every(t => textOf(r).includes(t))
    const passFilter = (f: FilterDef<T>, r: T) => {
      const want = state.filters[f.id] ?? []
      return want.length === 0 || valuesOf(f, r).some(v => want.includes(v))
    }

    // Every view's count reflects the search and filters, so the tabs say what
    // switching to them would show.
    const searched = rows.filter(r => passQuery(r) && activeFilters.every(f => passFilter(f, r)))
    const viewCounts = Object.fromEntries(views.map(v => [v.id, v.match ? searched.filter(v.match).length : searched.length]))

    const inView = activeView?.match ? rows.filter(activeView.match) : rows
    const base = inView.filter(passQuery)

    // Each filter's options count the rows the OTHER filters leave, so a
    // number next to an option is what ticking it would show.
    const facets = filters.map(f => {
      const pool = base.filter(r => activeFilters.every(g => g === f || passFilter(g, r)))
      const counts = new Map<string, number>()
      for (const r of pool) for (const v of new Set(valuesOf(f, r))) counts.set(v, (counts.get(v) ?? 0) + 1)
      for (const v of state.filters[f.id] ?? []) if (!counts.has(v)) counts.set(v, 0) // keep a ticked option visible
      const rank = (v: string) => (v === BLANK ? 1e6 : f.order ? (f.order.indexOf(v) + 1 || 1e5) : 0)
      const options = [...counts.entries()]
        .map(([value, count]) => ({ value, label: value === BLANK ? 'Blank' : value, count }))
        .sort((a, b) => rank(a.value) - rank(b.value) || a.value.localeCompare(b.value, undefined, { sensitivity: 'base' }))
      return { id: f.id, label: f.label, options, selected: state.filters[f.id] ?? [] }
    })

    let filtered = base.filter(r => activeFilters.every(f => passFilter(f, r)))

    const spec = state.sort ? sorts[state.sort.id] : undefined
    if (spec && state.sort) {
      const dir = state.sort.dir === 'asc' ? 1 : -1
      filtered = [...filtered].sort((a, b) => {
        if (spec.compare) return spec.compare(a, b, dir)
        const va = spec.value!(a), vb = spec.value!(b)
        if (isBlank(va) || isBlank(vb)) return (isBlank(va) ? 1 : 0) - (isBlank(vb) ? 1 : 0)
        if (typeof va === 'number' && typeof vb === 'number') return dir * (va - vb)
        return dir * String(va).localeCompare(String(vb), undefined, { sensitivity: 'base', numeric: true })
      })
    }
    return { filtered, facets, viewCounts }
  })()

  const pageSize = state.pageSize
  const pageCount = pageSize > 0 ? Math.max(1, Math.ceil(result.filtered.length / pageSize)) : 1
  const currentPage = Math.min(page, pageCount - 1)
  const pageRows = pageSize > 0 ? result.filtered.slice(currentPage * pageSize, currentPage * pageSize + pageSize) : result.filtered

  return {
    rows: pageRows,
    /** Every row the search, view and filters leave, across all pages. */
    matching: result.filtered,
    total: rows.length,
    query: state.query,
    view: state.view,
    views: views.map(v => ({ id: v.id, label: v.label, count: result.viewCounts[v.id] ?? 0 })),
    facets: result.facets,
    sort: state.sort,
    page: currentPage,
    pageCount,
    pageSize,
    /** Anything narrowing the list beyond the chosen view. */
    isFiltered: tokens.length > 0 || activeFilters.length > 0,
    setQuery: (query: string) => update({ query }),
    setView: (view: string) => update({ view }),
    setFilter: (filterId: string, values: string[]) => update({ filters: { ...state.filters, [filterId]: values } }),
    clearFilters: () => update({ query: '', filters: {} }),
    isSortable: (columnId: string) => columnId in sorts,
    toggleSort: (columnId: string) => {
      const spec = sorts[columnId]
      if (!spec) return
      const first = spec.firstDir ?? 'asc'
      const cur = state.sort
      // first click → its natural direction, second → reversed, third → back to the default order
      const next: SortState | null = cur?.id !== columnId ? { id: columnId, dir: first }
        : cur.dir === first ? { id: columnId, dir: first === 'asc' ? 'desc' : 'asc' }
        : defaultSort
      update({ sort: next })
    },
    setPage,
    setPageSize: (n: number) => update({ pageSize: n }),
  }
}

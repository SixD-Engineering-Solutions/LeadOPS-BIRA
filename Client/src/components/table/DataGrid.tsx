import { Fragment } from 'react'
import type { ReactNode } from 'react'
import type { TableView } from '../../lib/useTableView'

export type Column<T> = {
  id: string
  header: ReactNode
  cell: (row: T) => ReactNode
  /** Money and counts go right, with even-width digits so they line up. */
  align?: 'left' | 'right' | 'center'
  /** The first column: stays in place while the table scrolls sideways. */
  sticky?: boolean
  /** Extra cell classes — usually a min/max width. */
  className?: string
}

const ALIGN = { left: 'text-left', right: 'text-right tabular-nums', center: 'text-center' } as const

// Opaque backgrounds for pinned cells, so rows scrolling underneath don't
// show through; they follow the row's hover colour.
const PINNED = 'bg-white group-hover:bg-gray-50 dark:bg-gray-900 dark:group-hover:bg-gray-800'
// The first column only stays put from tablet width up: on a phone it would
// take most of the screen, so there the whole table scrolls together.
const PIN_LEFT = 'sm:sticky sm:left-0'
const PINNED_EDGE = 'after:pointer-events-none after:absolute after:inset-y-0 after:hidden after:w-px after:bg-gray-100 sm:after:block dark:after:bg-gray-800'

function SortIcon({ dir }: { dir: 'asc' | 'desc' | null }) {
  return (
    <svg className={`h-3 w-3 shrink-0 transition ${dir ? 'text-orange-500' : 'text-gray-300 opacity-0 group-hover/th:opacity-100 dark:text-gray-600'}`} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      {dir !== 'desc' && <path d="M6 2l3 3.5H3z" opacity={dir === 'asc' || !dir ? 1 : 0.3} />}
      {dir !== 'asc' && <path d="M6 10L3 6.5h6z" opacity={dir === 'desc' || !dir ? 1 : 0.3} />}
    </svg>
  )
}

// The one table every list in the app uses. Header and first column stay put
// while it scrolls (down inside the card, across for wide sheets); clicking a
// sortable header sorts by it (again to reverse, a third time to reset);
// clicking a row opens it; `actions` puts a row's "⋯" menu at its right edge,
// pinned so it's reachable without scrolling across.
export function DataGrid<T>({ columns, rows, getKey, view, onRowClick, isRowClickable, rowClassName, rowLabel, actions, expandedKey, renderExpanded, empty, minWidth = 0, maxHeight = 'max(360px, calc(100vh - 290px))' }: {
  columns: Column<T>[]
  rows: T[]
  getKey: (row: T) => string
  view?: Pick<TableView<T>, 'sort' | 'toggleSort' | 'isSortable'>
  onRowClick?: (row: T) => void
  /** Rows that can't be opened (e.g. read-only synced rows) — default all can. */
  isRowClickable?: (row: T) => boolean
  rowClassName?: (row: T) => string
  /** What a row is, for screen readers: "Open Bhilai Steel Plant". */
  rowLabel?: (row: T) => string
  actions?: (row: T) => ReactNode
  expandedKey?: string | null
  renderExpanded?: (row: T) => ReactNode
  /** Shown instead of the body when there are no rows. */
  empty?: ReactNode
  minWidth?: number
  maxHeight?: string
}) {
  const colCount = columns.length + (actions ? 1 : 0)

  return (
    // `isolate`: the pinned header/column layers stay inside the table, so they
    // never draw over the app's top bar, sidebar or overlays.
    <div className="isolate overflow-auto overscroll-x-contain" style={{ maxHeight }}>
      <table className="w-full border-separate border-spacing-0 text-sm" style={{ minWidth }}>
        <thead>
          <tr>
            {columns.map(c => {
              const sortable = view?.isSortable(c.id)
              const dir = view?.sort?.id === c.id ? view.sort.dir : null
              return (
                <th
                  key={c.id}
                  scope="col"
                  aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}
                  className={`group/th sticky top-0 whitespace-nowrap border-b border-gray-100 bg-gray-50 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 first:pl-5 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 ${ALIGN[c.align ?? 'left']} ${c.sticky ? `sm:left-0 z-30 ${PINNED_EDGE} after:right-0` : 'z-20'}`}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => view!.toggleSort(c.id)}
                      title={typeof c.header === "string" ? `Sort by ${c.header.toLowerCase()}` : undefined}
                      className={`-mx-1 inline-flex items-center gap-1 rounded px-1 uppercase tracking-wider outline-none hover:text-gray-800 focus-visible:ring-2 focus-visible:ring-orange-300 dark:hover:text-gray-200 ${dir ? 'text-gray-800 dark:text-gray-200' : ''} ${c.align === 'right' ? 'flex-row-reverse' : ''}`}
                    >
                      {c.header}
                      <SortIcon dir={dir} />
                    </button>
                  ) : c.header}
                </th>
              )
            })}
            {actions && <th scope="col" className={`sticky right-0 top-0 z-30 w-10 border-b border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-gray-900`}><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && empty ? (
            <tr><td colSpan={colCount}>{empty}</td></tr>
          ) : rows.map(row => {
            const key = getKey(row)
            const expanded = expandedKey === key && renderExpanded
            const clickable = !!onRowClick && (isRowClickable?.(row) ?? true)
            return (
              <Fragment key={key}>
                <tr
                  onClick={clickable ? () => onRowClick!(row) : undefined}
                  onKeyDown={clickable ? e => { if (e.key === 'Enter' && e.target === e.currentTarget) onRowClick!(row) } : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  aria-label={clickable && rowLabel ? rowLabel(row) : undefined}
                  aria-expanded={renderExpanded ? !!expanded : undefined}
                  className={`group outline-none transition-colors hover:bg-gray-50 focus-visible:bg-orange-50/60 dark:hover:bg-gray-800 dark:focus-visible:bg-orange-500/10 ${clickable ? 'cursor-pointer' : ''} ${expanded ? 'bg-gray-50 dark:bg-gray-800' : ''} ${rowClassName?.(row) ?? ''}`}
                >
                  {columns.map(c => (
                    <td
                      key={c.id}
                      className={`whitespace-nowrap border-b border-gray-100 px-3 py-3 align-middle text-[13px] text-gray-600 first:pl-5 dark:border-gray-800 dark:text-gray-300 ${ALIGN[c.align ?? 'left']} ${c.sticky ? `${PIN_LEFT} z-10 ${PINNED} ${PINNED_EDGE} after:right-0` : ''} ${c.className ?? ''}`}
                    >
                      {c.cell(row)}
                    </td>
                  ))}
                  {actions && (
                    <td className={`sticky right-0 z-10 w-10 border-b border-gray-100 px-2 py-3 text-right dark:border-gray-800 ${PINNED}`} onClick={e => e.stopPropagation()}>
                      {actions(row)}
                    </td>
                  )}
                </tr>
                {expanded && (
                  <tr>
                    <td colSpan={colCount} className="border-b border-gray-100 bg-gray-50/70 px-5 py-4 dark:border-gray-800 dark:bg-gray-800/40">
                      {renderExpanded!(row)}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

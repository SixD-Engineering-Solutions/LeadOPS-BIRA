import type { ReactNode } from 'react'

type ExportColumn<T> = { header: ReactNode; cell: (row: T) => ReactNode; exportValue?: (row: T) => string | number | null | undefined }

const BLOCKS = new Set(['P', 'DIV', 'LI', 'BR', 'TR', 'DD', 'DT'])

// The text a cell shows, as a person reads it: icons and initials (marked
// aria-hidden) left out, and separate lines joined with " · ".
function textOf(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  doc.querySelectorAll('[aria-hidden="true"], svg, .sr-only, [data-csv-skip]').forEach(n => n.remove())
  // "3 days ago" means little in a spreadsheet: write the date itself.
  doc.querySelectorAll('time[datetime]').forEach(t => { t.textContent = new Date(t.getAttribute('datetime')!).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })
  const parts: string[] = []
  let line = ''
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) line += child.textContent ?? ''
      else if (child instanceof Element) {
        const block = BLOCKS.has(child.tagName)
        if (block && line.trim()) { parts.push(line.trim()); line = '' }
        walk(child)
        if (block && line.trim()) { parts.push(line.trim()); line = '' }
      }
    }
  }
  walk(doc.body.firstChild!)
  if (line.trim()) parts.push(line.trim())
  return parts.map(p => p.replace(/\s+/g, ' ')).join(' · ')
}

// A plain rupee amount ("₹5,60,000") goes in as a number, so a spreadsheet can add it up.
const RUPEES = /^₹\s?(-?[\d,]+(?:\.\d+)?)$/
const csvCell = (raw: string) => {
  const v = RUPEES.test(raw) ? raw.replace(RUPEES, '$1').replace(/,/g, '') : raw
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

// Downloads `rows` as a CSV with the table's own columns, each cell written
// the way the table shows it (or a column's `exportValue`, for a raw number).
// React's string renderer is fetched only when someone exports.
export async function exportTableCsv<T>(filename: string, columns: ExportColumn<T>[], rows: T[]) {
  const { renderToStaticMarkup } = await import('react-dom/server')
  const text = (node: ReactNode) => (node == null || typeof node === 'boolean' ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : textOf(renderToStaticMarkup(node)))
  const lines = [
    columns.map(c => csvCell(text(c.header))).join(','),
    ...rows.map(r => columns.map(c => csvCell(c.exportValue ? String(c.exportValue(r) ?? '') : text(c.cell(r)))).join(',')),
  ]
  // The BOM makes Excel read ₹ and other non-ASCII characters correctly.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: `${filename}-${new Date().toISOString().slice(0, 10)}.csv` })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

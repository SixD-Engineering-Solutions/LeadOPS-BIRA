import { useEffect, useState } from 'react'
import { api } from './api'
import type { TrackerTable, TrackerValue } from './api'

// Which tracker fields can be edited, with labels and types — loaded from the
// server (GET /tracker/fields, defined in utils/trackerFields.ts there), which
// is also what decides what an edit may change. Nothing here lists fields.

export type FieldKind = 'text' | 'longtext' | 'number' | 'int' | 'date'
export type EditField = { key: string; label: string; kind: FieldKind; hint?: string }
export type TrackerTableDef = { title: string; labelField: string; detailFields: string[]; fields: EditField[] }
export type TrackerFieldDefs = Record<TrackerTable, TrackerTableDef>

// Fetched once per page load and shared — the definitions don't change while
// the app is open. A failed fetch isn't cached, so the next use retries.
let cached: Promise<TrackerFieldDefs> | null = null
export function loadTrackerFields(): Promise<TrackerFieldDefs> {
  cached ??= api<{ tables: TrackerFieldDefs }>('/tracker/fields', { auth: true })
    .then(r => r.tables)
    .catch(e => { cached = null; throw e })
  return cached
}

export function useTrackerFields(): { defs: TrackerFieldDefs | null; error: string | null } {
  const [defs, setDefs] = useState<TrackerFieldDefs | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    loadTrackerFields()
      .then(d => { if (live) setDefs(d) })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : 'Failed to load the tracker’s fields.') })
    return () => { live = false }
  }, [])
  return { defs, error }
}

export const fieldLabel = (defs: TrackerFieldDefs | null, table: TrackerTable, key: string) =>
  defs?.[table].fields.find(f => f.key === key)?.label ?? key

// A row's readable name, the same way the server names it in requests and
// notifications: the label field, plus the first non-blank detail field.
export function rowLabelFor(def: TrackerTableDef, row: Record<string, unknown>): string {
  const text = (k: string) => (typeof row[k] === 'string' && (row[k] as string).trim() ? (row[k] as string).trim() : null)
  const name = text(def.labelField) ?? `Unnamed ${def.title.toLowerCase()} row`
  const detail = def.detailFields.map(text).find(Boolean)
  return detail ? `${name} · ${detail}` : name
}

// A stored value as the form shows it: dates as YYYY-MM-DD, blanks as ''.
export function toInput(kind: FieldKind, v: unknown): string {
  if (v == null) return ''
  if (kind === 'date') return String(v).slice(0, 10)
  return String(v)
}

// A value for display in a change list.
export function showValue(v: TrackerValue): string {
  if (v == null || v === '') return '(blank)'
  return typeof v === 'number' ? v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : v
}

import { useEffect, useState } from 'react'
import { api } from '../lib/api'

export type Lookups = { clients: string[]; verticals: string[]; sectors: string[]; sources: string[]; serviceTypes: string[] }
const EMPTY: Lookups = { clients: [], verticals: [], sectors: [], sources: [], serviceTypes: [] }

// The names a new lead can be classified by, for the form's suggestions —
// fetched when `enabled` turns on (the form opening), so the lists are fresh.
// A list that fails to load just offers no suggestions.
export function useLookups(enabled: boolean): Lookups {
  const [lookups, setLookups] = useState<Lookups>(EMPTY)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const names = <T,>(path: string, key: string, field: keyof T) =>
      api<Record<string, T[]>>(path, { auth: true }).then(r => (r[key] ?? []).map(x => String(x[field])).filter(Boolean)).catch(() => [] as string[])
    Promise.all([
      names<{ clientName: string }>('/clients', 'clients', 'clientName'),
      names<{ verticalName: string }>('/verticals', 'verticals', 'verticalName'),
      names<{ sectorName: string }>('/sectors', 'sectors', 'sectorName'),
      names<{ sourceName: string }>('/lead-sources', 'leadSources', 'sourceName'),
      names<{ serviceTypeName: string }>('/service-types', 'serviceTypes', 'serviceTypeName'),
    ]).then(([clients, verticals, sectors, sources, serviceTypes]) => {
      if (!cancelled) setLookups({ clients, verticals, sectors, sources, serviceTypes })
    })
    return () => { cancelled = true }
  }, [enabled])
  return lookups
}

import { useEffect, useState } from 'react'
import { api, ACTIVITY_SYNC_EVENT, PROPOSAL_SYNC_EVENT, PROJECT_SYNC_EVENT, INVOICE_SYNC_EVENT } from '../../lib/api'
import type { Activity, Proposal, Project, Invoice, LeadDocument } from '../../lib/api'

export type LeadRecords = {
  activities: Activity[]
  proposals: Proposal[]
  projects: Project[]
  invoices: Invoice[]
  documents: LeadDocument[]
}

const EMPTY: LeadRecords = { activities: [], proposals: [], projects: [], invoices: [], documents: [] }

// Everything recorded against one lead, for its side panel: the summary
// strip and the timeline both read from this. Re-fetched whenever anyone
// changes an activity, proposal, project or invoice (the server pings every
// open tab), and on `reload()` after an upload here.
export function useLeadRecords(leadId: string) {
  const [records, setRecords] = useState<LeadRecords>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [token, setToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const [{ activities }, { proposals }, { projects }, { documents }] = await Promise.all([
          api<{ activities: Activity[] }>(`/activities?leadId=${leadId}`, { auth: true }),
          api<{ proposals: Proposal[] }>(`/proposals?leadId=${leadId}`, { auth: true }),
          api<{ projects: Project[] }>(`/projects?leadId=${leadId}`, { auth: true }),
          api<{ documents: LeadDocument[] }>(`/documents?leadId=${leadId}`, { auth: true }),
        ])
        const invoiceLists = await Promise.all(projects.map(p => api<{ invoices: Invoice[] }>(`/invoices?projectId=${p.id}`, { auth: true })))
        if (cancelled) return
        setRecords({ activities, proposals, projects, documents, invoices: invoiceLists.flatMap(l => l.invoices) })
        setError(null)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load this lead’s history.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [leadId, token])

  useEffect(() => {
    const bump = () => setToken(t => t + 1)
    const events = [ACTIVITY_SYNC_EVENT, PROPOSAL_SYNC_EVENT, PROJECT_SYNC_EVENT, INVOICE_SYNC_EVENT]
    events.forEach(e => window.addEventListener(e, bump))
    return () => events.forEach(e => window.removeEventListener(e, bump))
  }, [])

  return { records, loading, error, reload: () => setToken(t => t + 1) }
}

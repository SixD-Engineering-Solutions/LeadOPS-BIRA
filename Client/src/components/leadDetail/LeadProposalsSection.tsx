import { useEffect, useState } from 'react'
import { api, PROPOSAL_SYNC_EVENT } from '../../lib/api'
import type { Proposal } from '../../lib/api'
import { ErrorBanner } from '../ErrorBanner'
import { DetailSection } from './shared'
import { formatINR } from '../../lib/format'
import { PROPOSAL_STATUS_STYLES, DEFAULT_STATUS_STYLE } from '../../lib/statusStyles'
import { EmptyState } from '../EmptyState'
import { SkeletonRows } from '../Skeleton'

// The proposal raised against a lead — read-only here. Proposals are created
// and edited on the Proposals page.
export function LeadProposalsSection({ leadId }: { leadId: string }) {
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [proposalsError, setProposalsError] = useState<string | null>(null)

  // Loading until the list on screen is for this lead and the latest refresh.
  const [attempt, setAttempt] = useState(0)
  const key = `${leadId}:${attempt}`
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const loadingProposals = loadedKey !== key
  useEffect(() => {
    api<{ proposals: Proposal[] }>(`/proposals?leadId=${leadId}`, { auth: true })
      .then(({ proposals }) => { setProposals(proposals); setProposalsError(null) })
      .catch(e => setProposalsError(e instanceof Error ? e.message : 'Failed to load proposals.'))
      .finally(() => setLoadedKey(key))
  }, [key, leadId])
  const loadProposals = () => setAttempt(a => a + 1)

  // Live updates — any proposal change anywhere re-syncs this lead's list.
  useEffect(() => {
    window.addEventListener(PROPOSAL_SYNC_EVENT, loadProposals)
    return () => window.removeEventListener(PROPOSAL_SYNC_EVENT, loadProposals)
  }, [])

  return (
    <DetailSection title="Proposals">
      {proposalsError ? (
        <ErrorBanner message={proposalsError} onRetry={loadProposals} className="my-2" />
      ) : loadingProposals ? (
        <SkeletonRows rows={2} compact />
      ) : proposals.length === 0 ? (
        <EmptyState compact icon="document" title="No proposal raised yet" message="Raise one from the Proposals page." />
      ) : (
        <ul className="space-y-2">
          {proposals.map(p => (
            <li key={p.id} className="text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{p.proposalNumber}</span>
                  {p.projectName && <span className="ml-1 text-gray-500 dark:text-gray-400">{p.projectName}</span>}
                  {p.value != null && <span className="ml-1 text-gray-400 dark:text-gray-400">{formatINR(p.value)}</span>}
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 font-semibold ${PROPOSAL_STATUS_STYLES[p.status] ?? DEFAULT_STATUS_STYLE}`}>{p.status}</span>
              </div>
              {p.lostReason && (
                <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 dark:border-rose-500/40 dark:bg-rose-500/10">
                  <span className="font-semibold text-rose-600 dark:text-rose-300">Reason lost</span>
                  <p className="mt-0.5 whitespace-pre-line text-sm text-gray-900 dark:text-gray-100">{p.lostReason}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </DetailSection>
  )
}

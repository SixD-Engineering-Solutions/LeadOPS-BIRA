import { useEffect, useState } from 'react'
import { api, PROPOSAL_SYNC_EVENT } from '../../lib/api'
import type { Proposal } from '../../lib/api'
import { ErrorBanner } from '../ErrorBanner'
import { DetailSection, inputCls } from './shared'
import { formatINR } from '../../lib/format'
import { PROPOSAL_STATUS_STYLES, DEFAULT_STATUS_STYLE } from '../../lib/statusStyles'
import { EmptyState } from '../EmptyState'
import { SkeletonRows } from '../Skeleton'

// Proposals raised against a lead — quick-add form and list.
export function LeadProposalsSection({ leadId }: { leadId: string }) {
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [loadingProposals, setLoadingProposals] = useState(true)
  const [proposalsError, setProposalsError] = useState<string | null>(null)
  const [propForm, setPropForm] = useState({ projectName: '', value: '', submissionDate: '', probabilityPct: '', expectedOrderDate: '' })
  const [creatingProp, setCreatingProp] = useState(false)
  const [propError, setPropError] = useState<string | null>(null)

  function loadProposals() {
    setLoadingProposals(true)
    api<{ proposals: Proposal[] }>(`/proposals?leadId=${leadId}`, { auth: true })
      .then(({ proposals }) => { setProposals(proposals); setProposalsError(null) })
      .catch(e => setProposalsError(e instanceof Error ? e.message : 'Failed to load proposals.'))
      .finally(() => setLoadingProposals(false))
  }
  useEffect(() => { loadProposals() }, [leadId])

  // Live updates — any proposal change anywhere re-syncs this lead's list.
  useEffect(() => {
    function onProposalSync() { loadProposals() }
    window.addEventListener(PROPOSAL_SYNC_EVENT, onProposalSync)
    return () => window.removeEventListener(PROPOSAL_SYNC_EVENT, onProposalSync)
  }, [leadId])

  async function createProposal(e: React.FormEvent) {
    e.preventDefault()
    setPropError(null)
    setCreatingProp(true)
    try {
      await api('/proposals', {
        method: 'POST',
        auth: true,
        body: {
          leadId,
          projectName: propForm.projectName || undefined,
          value: propForm.value ? Number(propForm.value) : undefined,
          submissionDate: propForm.submissionDate || undefined,
          probabilityPct: propForm.probabilityPct ? Number(propForm.probabilityPct) : undefined,
          expectedOrderDate: propForm.expectedOrderDate || undefined,
        },
      })
      setPropForm({ projectName: '', value: '', submissionDate: '', probabilityPct: '', expectedOrderDate: '' })
      loadProposals()
    } catch (e) {
      setPropError(e instanceof Error ? e.message : 'Could not create proposal.')
    } finally {
      setCreatingProp(false)
    }
  }

  // One proposal per lead (enforced server-side too): the quick-add form is
  // only offered until this lead has one.
  const canAdd = !loadingProposals && !proposalsError && proposals.length === 0

  return (
    <DetailSection title="Proposals">
      {canAdd && (
      <form onSubmit={createProposal} className="mb-3 grid grid-cols-2 gap-2">
        <input value={propForm.projectName} onChange={e => setPropForm({ ...propForm, projectName: e.target.value })} placeholder="Project name" className={`${inputCls} col-span-2`} />
        <input type="number" value={propForm.value} onChange={e => setPropForm({ ...propForm, value: e.target.value })} placeholder="Value (₹)" className={inputCls} />
        <input type="number" min={0} max={100} value={propForm.probabilityPct} onChange={e => setPropForm({ ...propForm, probabilityPct: e.target.value })} placeholder="Probability %" className={inputCls} />
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
          Submission date
          <input type="date" value={propForm.submissionDate} onChange={e => setPropForm({ ...propForm, submissionDate: e.target.value })} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
          Expected order date
          <input type="date" value={propForm.expectedOrderDate} onChange={e => setPropForm({ ...propForm, expectedOrderDate: e.target.value })} className={inputCls} />
        </label>
        {propError && <p className="col-span-2 text-xs text-red-500 dark:text-red-400">{propError}</p>}
        <div className="col-span-2">
          <button disabled={creatingProp} className="rounded-xl bg-gradient-to-r from-rose-400 to-orange-400 px-4 py-1.5 text-xs font-semibold text-white transition hover:from-rose-500 hover:to-orange-500 disabled:opacity-60">
            {creatingProp ? 'Saving…' : 'Add proposal'}
          </button>
        </div>
      </form>
      )}

      {proposalsError ? (
        <ErrorBanner message={proposalsError} onRetry={loadProposals} className="my-2" />
      ) : loadingProposals ? (
        <SkeletonRows rows={2} compact />
      ) : proposals.length === 0 ? (
        <EmptyState compact icon="document" title="No proposal raised yet" message="Add one with the form above — each lead has one proposal." />
      ) : (
        <ul className="space-y-2 border-t border-gray-50 pt-3 dark:border-gray-800/60">
          {proposals.map(p => (
            <li key={p.id} className="flex items-center justify-between gap-2 text-xs">
              <div className="min-w-0">
                <span className="font-semibold text-gray-900 dark:text-gray-100">{p.proposalNumber}</span>
                {p.projectName && <span className="ml-1 text-gray-500 dark:text-gray-400">{p.projectName}</span>}
                {p.value != null && <span className="ml-1 text-gray-400 dark:text-gray-400">{formatINR(p.value)}</span>}
              </div>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 font-semibold ${PROPOSAL_STATUS_STYLES[p.status] ?? DEFAULT_STATUS_STYLE}`}>{p.status}</span>
            </li>
          ))}
        </ul>
      )}
    </DetailSection>
  )
}

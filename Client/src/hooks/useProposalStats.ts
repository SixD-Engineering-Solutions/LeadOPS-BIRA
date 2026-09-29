import { useEffect, useState } from 'react'
import { api, PROPOSAL_SYNC_EVENT } from '../lib/api'
import type { Proposal } from '../lib/api'

export type ProposalStats = {
  pendingValue: number; pendingCount: number
  wonValue: number; wonCount: number
  lostValue: number; lostCount: number
  loaded: boolean
}

const EMPTY_STATS: ProposalStats = { pendingValue: 0, pendingCount: 0, wonValue: 0, wonCount: 0, lostValue: 0, lostCount: 0, loaded: false }

// "Pipeline Value" / "Orders Received" / "Lost Deals" tiles — sum of proposal
// values grouped by whether they're still open, Won, or Lost.
export function useProposalStats(active: boolean) {
  const [proposalStats, setProposalStats] = useState<ProposalStats>(EMPTY_STATS)
  const [error, setError] = useState<string | null>(null)

  function reload() {
    return api<{ proposals: Proposal[] }>('/proposals', { auth: true })
      .then(({ proposals }) => {
        const pending = proposals.filter(p => p.status !== 'Won' && p.status !== 'Lost')
        const won = proposals.filter(p => p.status === 'Won')
        const lost = proposals.filter(p => p.status === 'Lost')
        setProposalStats({
          pendingValue: pending.reduce((sum, p) => sum + (p.value ?? 0), 0), pendingCount: pending.length,
          wonValue: won.reduce((sum, p) => sum + (p.value ?? 0), 0), wonCount: won.length,
          lostValue: lost.reduce((sum, p) => sum + (p.value ?? 0), 0), lostCount: lost.length,
          loaded: true,
        })
        setError(null)
      })
      .catch(e => {
        setProposalStats(EMPTY_STATS)
        setError(e instanceof Error ? e.message : 'Failed to load proposal stats.')
      })
  }

  useEffect(() => {
    if (active) reload()
  }, [active])

  useEffect(() => {
    function onProposalSync() {
      if (active) reload()
    }
    window.addEventListener(PROPOSAL_SYNC_EVENT, onProposalSync)
    return () => window.removeEventListener(PROPOSAL_SYNC_EVENT, onProposalSync)
  }, [active])

  return { proposalStats, error, reload }
}

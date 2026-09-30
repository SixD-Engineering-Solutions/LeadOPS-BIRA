import { useEffect, useState } from 'react'
import { api, PROPOSAL_SYNC_EVENT, PROPOSAL_STATUSES } from '../lib/api'
import type { Proposal, ProposalStatus, Lead } from '../lib/api'
import { ErrorBanner } from '../components/ErrorBanner'
import { PROPOSAL_STATUS_STYLES, DEFAULT_STATUS_STYLE } from '../lib/statusStyles'
import { formatINR } from '../lib/format'
import { EmptyState } from '../components/EmptyState'
import { focusCreateForm } from '../lib/focusCreateForm'
import { SkeletonRows } from '../components/Skeleton'

const statusStyle = (name: string) => PROPOSAL_STATUS_STYLES[name] ?? DEFAULT_STATUS_STYLE
const fmtDate = (ts: string | null) => (ts ? new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—')
const fmtValue = (v: number | null) => (v == null ? '—' : formatINR(v))

const inputCls = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'
const emptyForm = { leadId: '', projectName: '', value: '', submissionDate: '', probabilityPct: '', expectedOrderDate: '' }

export default function Proposals() {
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({ ...emptyForm })
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  function load() {
    setLoading(true)
    api<{ proposals: Proposal[] }>('/proposals', { auth: true })
      .then(({ proposals }) => { setProposals(proposals); setError(null) })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load proposals.'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    api<{ leads: Lead[] }>('/leads', { auth: true }).then(({ leads }) => setLeads(leads)).catch(() => {})
  }, [])

  // Live updates — a proposal created/updated by anyone resyncs this list.
  useEffect(() => {
    function onProposalSync() { load() }
    window.addEventListener(PROPOSAL_SYNC_EVENT, onProposalSync)
    return () => window.removeEventListener(PROPOSAL_SYNC_EVENT, onProposalSync)
  }, [])

  const leadLabel = (l: Lead) => `${l.plant?.plantName ?? 'Unnamed plant'}${l.plant?.client?.clientName ? ` — ${l.plant.client.clientName}` : ''}`
  // One proposal per lead (enforced server-side too) — only leads without one
  // are offered; an existing proposal is revised in place instead.
  const leadsWithProposal = new Set(proposals.map(p => p.leadId))
  const availableLeads = leads.filter(l => !leadsWithProposal.has(l.id))

  async function createProposal(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!form.leadId) { setFormError('Lead is required.'); return }
    setCreating(true)
    try {
      const { proposal } = await api<{ proposal: Proposal }>('/proposals', {
        method: 'POST',
        auth: true,
        body: {
          leadId: form.leadId,
          projectName: form.projectName || undefined,
          value: form.value ? Number(form.value) : undefined,
          submissionDate: form.submissionDate || undefined,
          probabilityPct: form.probabilityPct ? Number(form.probabilityPct) : undefined,
          expectedOrderDate: form.expectedOrderDate || undefined,
        },
      })
      setProposals(prev => [proposal, ...prev])
      setForm({ ...emptyForm })
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not create proposal.')
    } finally {
      setCreating(false)
    }
  }

  async function changeStatus(id: string, status: ProposalStatus) {
    setSavingId(id)
    try {
      const { proposal } = await api<{ proposal: Proposal }>(`/proposals/${id}`, { method: 'PATCH', auth: true, body: { status } })
      setProposals(prev => prev.map(p => (p.id === id ? proposal : p)))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update status.')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-5">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Proposals</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Quote value and probability against a lead, and track it through to Won or Lost.</p>
      </div>

      {/* create form */}
      <form onSubmit={createProposal} className="mb-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h3 className="mb-3 text-sm font-bold text-gray-900 dark:text-gray-100">New proposal</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400 sm:col-span-2 lg:col-span-1">
            Lead *
            <select value={form.leadId} onChange={e => setForm({ ...form, leadId: e.target.value })} className={inputCls}>
              <option value="">{leads.length > 0 && availableLeads.length === 0 ? 'Every lead already has a proposal' : 'Select a lead…'}</option>
              {availableLeads.map(l => <option key={l.id} value={l.id}>{leadLabel(l)}</option>)}
            </select>
            <span className="text-[11px] font-normal text-gray-400 dark:text-gray-400">Only leads without a proposal are listed — one proposal per lead.</span>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            Project name
            <input value={form.projectName} onChange={e => setForm({ ...form, projectName: e.target.value })} placeholder="e.g. Plant-wide laser scan" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            Value (₹)
            <input type="number" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} placeholder="e.g. 500000" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            Submission date
            <input type="date" value={form.submissionDate} onChange={e => setForm({ ...form, submissionDate: e.target.value })} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            Probability %
            <input type="number" min={0} max={100} value={form.probabilityPct} onChange={e => setForm({ ...form, probabilityPct: e.target.value })} placeholder="e.g. 60" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            Expected order date
            <input type="date" value={form.expectedOrderDate} onChange={e => setForm({ ...form, expectedOrderDate: e.target.value })} className={inputCls} />
          </label>
        </div>
        {formError && <p className="mt-2 text-xs text-red-500 dark:text-red-400">{formError}</p>}
        <div className="mt-3">
          <button type="submit" disabled={creating} className="rounded-xl bg-gradient-to-r from-rose-400 to-orange-400 px-5 py-2 text-sm font-semibold text-white transition hover:from-rose-500 hover:to-orange-500 disabled:opacity-60">
            {creating ? 'Saving…' : 'Add Proposal'}
          </button>
        </div>
      </form>

      {/* list */}
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3 dark:border-gray-800">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Proposals {proposals.length > 0 && <span className="text-gray-400 dark:text-gray-400">({proposals.length})</span>}</h3>
          <button onClick={load} className="text-xs font-medium text-orange-500 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-300">Refresh</button>
        </div>

        {error && <ErrorBanner message={error} onRetry={load} />}

        {loading ? (
          <SkeletonRows />
        ) : proposals.length === 0 && !error ? (
          <EmptyState icon="document" title="No proposals yet" message="Quote a value against one of your leads to start tracking it to Won or Lost." action={{ label: 'Create proposal', onClick: focusCreateForm }} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs uppercase tracking-wider text-gray-400 dark:border-gray-800 dark:text-gray-400">
                  <th className="px-5 py-3 font-semibold">Proposal</th>
                  <th className="px-3 py-3 font-semibold">Lead</th>
                  <th className="px-3 py-3 font-semibold">Value</th>
                  <th className="px-3 py-3 font-semibold">Probability</th>
                  <th className="px-3 py-3 font-semibold">Expected order</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map(p => (
                  <tr key={p.id} className="border-b border-gray-50 dark:border-gray-800">
                    <td className="px-5 py-3">
                      <p className="font-semibold text-gray-900 dark:text-gray-100">{p.proposalNumber}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{p.projectName ?? 'No project name'}</p>
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-600 dark:text-gray-400">
                      <p>{p.lead?.plant?.plantName ?? '—'}</p>
                      <p className="text-gray-400 dark:text-gray-400">{p.lead?.plant?.client?.clientName ?? ''}</p>
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-700 dark:text-gray-300">{fmtValue(p.value)}</td>
                    <td className="px-3 py-3 text-sm text-gray-700 dark:text-gray-300">{p.probabilityPct != null ? `${p.probabilityPct}%` : '—'}</td>
                    <td className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400">{fmtDate(p.expectedOrderDate)}</td>
                    <td className="px-3 py-3">
                      <select
                        value={p.status}
                        disabled={savingId === p.id}
                        onChange={e => changeStatus(p.id, e.target.value as ProposalStatus)}
                        className={`rounded-lg border px-2 py-1 text-xs font-semibold outline-none focus:ring-2 focus:ring-orange-300 disabled:opacity-60 ${statusStyle(p.status)}`}
                      >
                        {PROPOSAL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

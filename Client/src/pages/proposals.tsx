import { useEffect, useState } from 'react'
import { api, PROPOSAL_SYNC_EVENT, PROPOSAL_STATUSES } from '../lib/api'
import type { Proposal, ProposalStatus, Lead, EmployeeUser } from '../lib/api'
import { Modal } from '../components/Modal'
import { LostReasonModal } from '../components/LostReasonModal'
import { ErrorBanner } from '../components/ErrorBanner'
import { PROPOSAL_STATUS_STYLES, DEFAULT_STATUS_STYLE } from '../lib/statusStyles'
import { formatINR } from '../lib/format'
import { EmptyState } from '../components/EmptyState'
import { PageHeader, NewButton } from '../components/PageHeader'
import { CreatePanel } from '../components/CreatePanel'
import { PAGE_CLASS } from '../lib/pageChrome'
import { Field } from '../components/form/Field'
import { SearchSelect } from '../components/form/SearchSelect'
import { focusFirstInvalid } from '../lib/formStyles'
import type { FieldErrors } from '../lib/formStyles'
import { toast } from '../lib/toast'
import { SkeletonRows } from '../components/Skeleton'
import { LeadDetailById } from '../components/LeadDetailModal'
import { useTableView } from '../lib/useTableView'
import { DataGrid } from '../components/table/DataGrid'
import type { Column } from '../components/table/DataGrid'
import { TableToolbar, TableFooter, NoMatches, RefreshButton } from '../components/table/TableToolbar'
import { MenuSelect } from '../components/table/MenuSelect'
import { RowMenu } from '../components/table/RowMenu'
import { DueDate, RelTime } from '../components/table/RelTime'
import { btn } from '../lib/ui'
import { DatePicker } from '../components/form/DatePicker'

const statusStyle = (name: string) => PROPOSAL_STATUS_STYLES[name] ?? DEFAULT_STATUS_STYLE
const fmtValue = (v: number | null) => (v == null ? <span className="text-gray-300 dark:text-gray-600">—</span> : formatINR(v))
const OPEN: readonly string[] = ['Draft', 'Submitted', 'Follow-up', 'Negotiation', 'Hold']

const inputCls = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'
const emptyForm = { leadId: '', value: '', submissionDate: '', probabilityPct: '', expectedOrderDate: '' }

export default function Proposals() {
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({ ...emptyForm })
  const [creating, setCreating] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<'leadId'>>({})
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

  // One proposal per lead (enforced server-side too) — only leads without one
  // are offered; an existing proposal is revised in place instead.
  const leadsWithProposal = new Set(proposals.map(p => p.leadId))
  const availableLeads = leads.filter(l => !leadsWithProposal.has(l.id))

  async function createProposal(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!form.leadId) { setFieldErrors({ leadId: 'Choose the lead this proposal is for.' }); focusFirstInvalid(); return }
    setFieldErrors({})
    setCreating(true)
    try {
      const { proposal } = await api<{ proposal: Proposal }>('/proposals', {
        method: 'POST',
        auth: true,
        body: {
          leadId: form.leadId,
          value: form.value ? Number(form.value) : undefined,
          submissionDate: form.submissionDate || undefined,
          probabilityPct: form.probabilityPct ? Number(form.probabilityPct) : undefined,
          expectedOrderDate: form.expectedOrderDate || undefined,
        },
      })
      setProposals(prev => [proposal, ...prev])
      setForm({ ...emptyForm })
      setShowCreate(false)
      toast(`Proposal ${proposal.proposalNumber} added`, { action: { label: 'View', onClick: () => setOpenLeadId(proposal.leadId) } })
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not create proposal.')
    } finally {
      setCreating(false)
    }
  }

  async function changeStatus(id: string, status: ProposalStatus, undoable = true) {
    const before = proposals.find(p => p.id === id)?.status as ProposalStatus | undefined
    setSavingId(id)
    try {
      const { proposal } = await api<{ proposal: Proposal }>(`/proposals/${id}`, { method: 'PATCH', auth: true, body: { status } })
      setProposals(prev => prev.map(p => (p.id === id ? proposal : p)))
      setError(null)
      // No undo into or out of Won / Lost: Won creates a project, Lost needs a reason.
      const canUndo = undoable && before && before !== status && ![before, status].some(x => x === 'Won' || x === 'Lost')
      toast(`${proposal.proposalNumber} marked ${status}`, canUndo ? { action: { label: 'Undo', onClick: () => changeStatus(id, before!, false) } } : {})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update status.')
    } finally {
      setSavingId(null)
    }
  }

  // Marking Won creates the lead's project, and a project needs an engineer
  // and dates — so Won goes through a small form first. Skipped when the lead
  // already has a project (it's linked instead of a new one being created).
  const [wonFor, setWonFor] = useState<Proposal | null>(null)
  // Lost likewise asks why first — the reason is mandatory.
  const [lostFor, setLostFor] = useState<Proposal | null>(null)
  async function onStatusSelect(p: Proposal, status: ProposalStatus) {
    if (status === 'Lost' && p.status !== 'Lost') return setLostFor(p)
    if (status !== 'Won' || p.status === 'Won') return changeStatus(p.id, status)
    setSavingId(p.id)
    try {
      const { projects } = await api<{ projects: unknown[] }>(`/projects?leadId=${p.leadId}`, { auth: true })
      if (projects.length > 0) return changeStatus(p.id, status)
      setWonFor(p)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update status.')
    } finally {
      setSavingId(null)
    }
  }

  const [openLeadId, setOpenLeadId] = useState<string | null>(null)
  const plantOf = (p: Proposal) => p.lead?.plant?.plantName ?? null
  const clientOf = (p: Proposal) => p.lead?.plant?.client?.clientName ?? null

  const view = useTableView<Proposal>({
    id: 'proposals',
    rows: proposals,
    search: p => [p.proposalNumber, p.projectName, plantOf(p), clientOf(p), p.status, p.lostReason].join(' '),
    views: [
      { id: 'all', label: 'All' },
      { id: 'open', label: 'Open', match: p => OPEN.includes(p.status) },
      { id: 'won', label: 'Won', match: p => p.status === 'Won' },
      { id: 'lost', label: 'Lost', match: p => p.status === 'Lost' },
    ],
    filters: [
      { id: 'status', label: 'Status', value: p => p.status, order: PROPOSAL_STATUSES },
      { id: 'client', label: 'Client', value: clientOf },
    ],
    sorts: {
      proposal: { value: p => p.proposalNumber, firstDir: 'desc' },
      lead: { value: plantOf },
      value: { value: p => p.value, firstDir: 'desc' },
      probability: { value: p => p.probabilityPct, firstDir: 'desc' },
      expected: { value: p => (p.expectedOrderDate ? new Date(p.expectedOrderDate).getTime() : null) },
      status: { value: p => PROPOSAL_STATUSES.indexOf(p.status as ProposalStatus) },
      updated: { value: p => new Date(p.updatedAt).getTime(), firstDir: 'desc' },
    },
    defaultSort: { id: 'proposal', dir: 'desc' },
  })

  const columns: Column<Proposal>[] = [
    {
      id: 'proposal', header: 'Proposal', sticky: true, className: 'min-w-[220px]',
      cell: p => (
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{p.proposalNumber}</p>
          {p.projectName && <p className="max-w-[260px] truncate text-xs text-gray-500 dark:text-gray-400">{p.projectName}</p>}
        </div>
      ),
    },
    {
      id: 'lead', header: 'Lead',
      cell: p => (
        <>
          <p className="text-gray-700 dark:text-gray-200">{plantOf(p) ?? '—'}</p>
          <p className="text-gray-400 dark:text-gray-500">{clientOf(p) ?? ''}</p>
        </>
      ),
    },
    { id: 'value', header: 'Value', align: 'right', cell: p => <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{fmtValue(p.value)}</span> },
    { id: 'probability', header: 'Probability', align: 'right', cell: p => (p.probabilityPct != null ? `${p.probabilityPct}%` : <span className="text-gray-300 dark:text-gray-600">—</span>) },
    { id: 'expected', header: 'Expected order', cell: p => <DueDate ts={p.expectedOrderDate} done={!OPEN.includes(p.status)} /> },
    {
      id: 'status', header: 'Status',
      cell: p => (
        <>
          <MenuSelect
            variant="pill"
            label={`Status of ${p.proposalNumber}`}
            value={p.status}
            options={PROPOSAL_STATUSES.map(s => ({ value: s, label: s }))}
            toneOf={statusStyle}
            busy={savingId === p.id}
            onChange={v => onStatusSelect(p, v as ProposalStatus)}
          />
          {p.lostReason && <p className="mt-1 max-w-[200px] truncate text-[11px] text-rose-500 dark:text-rose-400" title={p.lostReason}>Lost: {p.lostReason}</p>}
        </>
      ),
    },
    { id: 'updated', header: 'Updated', align: 'right', cell: p => <span className="text-gray-500 dark:text-gray-400"><RelTime ts={p.updatedAt} /></span> },
  ]

  return (
    <div className={PAGE_CLASS}>
      <PageHeader title="Proposals" subtitle="Quote value and probability against a lead, and track it through to Won or Lost.">
        <NewButton label="New proposal" onClick={() => setShowCreate(true)} />
      </PageHeader>

      {/* list */}
      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <TableToolbar view={view} noun="proposals" placeholder="Search number, plant, client…">
          <RefreshButton onClick={load} busy={loading} />
        </TableToolbar>

        {error && <ErrorBanner message={error} onRetry={load} />}

        {loading && proposals.length === 0 ? (
          <SkeletonRows />
        ) : proposals.length === 0 && !error ? (
          <EmptyState icon="document" title="No proposals yet" message="Quote a value against one of your leads to start tracking it to Won or Lost." action={{ label: 'Create proposal', onClick: () => setShowCreate(true) }} />
        ) : (
          <>
            <DataGrid
              columns={columns}
              rows={view.rows}
              getKey={p => p.id}
              view={view}
              onRowClick={p => setOpenLeadId(p.leadId)}
              rowLabel={p => `Open the lead for ${p.proposalNumber}`}
              actions={p => <RowMenu label={p.proposalNumber} actions={[{ label: 'Open lead', onSelect: () => setOpenLeadId(p.leadId) }]} />}
              empty={<NoMatches noun="proposals" onClear={view.clearFilters} />}
              minWidth={920}
            />
            <TableFooter view={view} />
          </>
        )}
      </div>

      {openLeadId && <LeadDetailById leadId={openLeadId} onClose={() => setOpenLeadId(null)} />}

      {lostFor && (
        <LostReasonModal
          title={`Why was ${lostFor.proposalNumber} lost?`}
          subject={`Marking the proposal for ${lostFor.lead?.plant?.plantName ?? 'this lead'} as Lost — the reason is required.`}
          onCancel={() => setLostFor(null)}
          onConfirm={async reason => {
            const { proposal } = await api<{ proposal: Proposal }>(`/proposals/${lostFor.id}`, { method: 'PATCH', auth: true, body: { status: 'Lost', lostReason: reason } })
            setProposals(prev => prev.map(p => (p.id === proposal.id ? proposal : p)))
            setLostFor(null)
          }}
        />
      )}

      {wonFor && (
        <MarkWonModal
          proposal={wonFor}
          onClose={() => setWonFor(null)}
          onWon={updated => { setProposals(prev => prev.map(p => (p.id === updated.id ? updated : p))); setWonFor(null) }}
        />
      )}
      {showCreate && (
        <CreatePanel
          title="New proposal"
          subtitle="One proposal per lead — revise an existing one from its row instead."
          onClose={() => setShowCreate(false)}
          onSubmit={createProposal}
          saving={creating}
          submitLabel="Add proposal"
          savingLabel="Saving…"
          error={formError}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Lead" required error={fieldErrors.leadId} hint="Only leads without a proposal are listed — one proposal per lead." className="sm:col-span-2">
              <SearchSelect
                value={form.leadId}
                onChange={v => { setForm({ ...form, leadId: v }); setFieldErrors({}) }}
                options={availableLeads.map(l => ({ value: l.id, label: l.plant?.plantName ?? 'Unnamed plant', hint: l.plant?.client?.clientName ?? undefined }))}
                emptyLabel={leads.length > 0 && availableLeads.length === 0 ? 'Every lead already has a proposal' : 'Select a lead…'}
                invalid={!!fieldErrors.leadId}
                label="Lead"
              />
            </Field>
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
              Value (₹)
              <input type="number" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} placeholder="e.g. 500000" className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
              Submission date
              <DatePicker value={form.submissionDate} onChange={v => setForm({ ...form, submissionDate: v })} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
              Probability %
              <input type="number" min={0} max={100} value={form.probabilityPct} onChange={e => setForm({ ...form, probabilityPct: e.target.value })} placeholder="e.g. 60" className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
              Expected order date
              <DatePicker value={form.expectedOrderDate} onChange={v => setForm({ ...form, expectedOrderDate: v })} />
            </label>
          </div>
        </CreatePanel>
      )}
    </div>
  )
}

// Collects the new project's mandatory engineer and dates, then marks the
// proposal Won in one request — the server creates the project with them.
function MarkWonModal({ proposal, onClose, onWon }: { proposal: Proposal; onClose: () => void; onWon: (p: Proposal) => void }) {
  const [employees, setEmployees] = useState<EmployeeUser[]>([])
  const [form, setForm] = useState({ responsibleUserId: '', startDate: '', completionDate: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<{ users: EmployeeUser[] }>('/users', { auth: true })
      .then(({ users }) => setEmployees(users.filter(u => u.role !== 'admin' && u.isActive)))
      .catch(() => {})
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.responsibleUserId) { setError('Responsible engineer is required.'); return }
    if (!form.startDate || !form.completionDate) { setError('Start and completion dates are required.'); return }
    if (form.completionDate < form.startDate) { setError('Completion date can’t be before the start date.'); return }
    setSaving(true)
    try {
      const { proposal: updated } = await api<{ proposal: Proposal }>(`/proposals/${proposal.id}`, {
        method: 'PATCH',
        auth: true,
        body: { status: 'Won', project: form },
      })
      onWon(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not mark the proposal Won.')
    } finally {
      setSaving(false)
    }
  }

  const label = 'flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400'
  return (
    <Modal
      title={`Mark ${proposal.proposalNumber} as Won`}
      subtitle={`This creates the project for ${proposal.lead?.plant?.plantName ?? 'this lead'} — assign who runs it and when.`}
      onClose={onClose}
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className={label}>
          Responsible engineer *
          <SearchSelect value={form.responsibleUserId} onChange={v => setForm({ ...form, responsibleUserId: v })} options={employees.map(u => ({ value: u.id, label: u.userName || u.email, hint: u.email }))} emptyLabel="Select an engineer…" label="Responsible engineer" autoFocus />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            Start date *
            <DatePicker value={form.startDate} max={form.completionDate || undefined} onChange={v => setForm({ ...form, startDate: v })} />
          </label>
          <label className={label}>
            Completion date *
            <DatePicker value={form.completionDate} min={form.startDate || undefined} onChange={v => setForm({ ...form, completionDate: v })} />
          </label>
        </div>
        {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btn('secondary', 'md')}>Cancel</button>
          <button type="submit" disabled={saving} className={btn('primary', 'md')}>
            {saving ? 'Saving…' : 'Mark Won & create project'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

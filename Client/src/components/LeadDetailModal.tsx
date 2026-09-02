import { useEffect, useRef, useState } from 'react'
import { api, ACTIVITY_SYNC_EVENT, ACTIVITY_TYPES, PROPOSAL_SYNC_EVENT, uploadDocument, downloadDocument } from '../lib/api'
import type { Lead, Activity, ActivityType, Proposal, LeadDocument } from '../lib/api'

const STATUS_STYLES: Record<string, string> = {
  Submitted: 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-900/40 dark:text-sky-300 dark:border-sky-800',
  'In Process': 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800',
  Dead: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/40 dark:text-rose-300 dark:border-rose-800',
}
const statusStyle = (name: string | null | undefined) => STATUS_STYLES[name ?? ''] ?? 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'
const fmt = (ts: string) => new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const fmtDay = (ts: string) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
const todayInput = () => new Date().toISOString().slice(0, 10)
const fmtSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`)

const inputCls = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'

// Full-detail modal for a single lead — plant, contact, classification,
// ownership, notes, and the activity timeline. Shared by the Leads page (row
// click) and the dashboard's Lead Assignments breakdown (lead click), so both
// surfaces show the exact same information for a given lead.
export default function LeadDetailModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const [activities, setActivities] = useState<Activity[]>([])
  const [loadingActivities, setLoadingActivities] = useState(true)
  const [logForm, setLogForm] = useState({ activityType: 'Call' as ActivityType, activityDate: todayInput(), notes: '', nextActionDate: '' })
  const [logging, setLogging] = useState(false)
  const [logError, setLogError] = useState<string | null>(null)

  function loadActivities() {
    setLoadingActivities(true)
    api<{ activities: Activity[] }>(`/activities?leadId=${lead.id}`, { auth: true })
      .then(({ activities }) => setActivities(activities))
      .catch(() => {})
      .finally(() => setLoadingActivities(false))
  }
  useEffect(() => { loadActivities() }, [lead.id])

  // Live updates — an activity logged against this lead by anyone (this tab
  // included) re-syncs the timeline without a manual refresh.
  useEffect(() => {
    function onActivitySync(e: Event) {
      const leadId = (e as CustomEvent<{ leadId: string }>).detail?.leadId
      if (leadId === lead.id) loadActivities()
    }
    window.addEventListener(ACTIVITY_SYNC_EVENT, onActivitySync)
    return () => window.removeEventListener(ACTIVITY_SYNC_EVENT, onActivitySync)
  }, [lead.id])

  const [proposals, setProposals] = useState<Proposal[]>([])
  const [loadingProposals, setLoadingProposals] = useState(true)
  const [propForm, setPropForm] = useState({ projectName: '', value: '', submissionDate: '', probabilityPct: '', expectedOrderDate: '' })
  const [creatingProp, setCreatingProp] = useState(false)
  const [propError, setPropError] = useState<string | null>(null)

  function loadProposals() {
    setLoadingProposals(true)
    api<{ proposals: Proposal[] }>(`/proposals?leadId=${lead.id}`, { auth: true })
      .then(({ proposals }) => setProposals(proposals))
      .catch(() => {})
      .finally(() => setLoadingProposals(false))
  }
  useEffect(() => { loadProposals() }, [lead.id])

  // Live updates — any proposal change anywhere re-syncs this lead's list.
  useEffect(() => {
    function onProposalSync() { loadProposals() }
    window.addEventListener(PROPOSAL_SYNC_EVENT, onProposalSync)
    return () => window.removeEventListener(PROPOSAL_SYNC_EVENT, onProposalSync)
  }, [lead.id])

  async function createProposal(e: React.FormEvent) {
    e.preventDefault()
    setPropError(null)
    setCreatingProp(true)
    try {
      await api('/proposals', {
        method: 'POST',
        auth: true,
        body: {
          leadId: lead.id,
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

  const [documents, setDocuments] = useState<LeadDocument[]>([])
  const [loadingDocuments, setLoadingDocuments] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function loadDocuments() {
    setLoadingDocuments(true)
    api<{ documents: LeadDocument[] }>(`/documents?leadId=${lead.id}`, { auth: true })
      .then(({ documents }) => setDocuments(documents))
      .catch(() => {})
      .finally(() => setLoadingDocuments(false))
  }
  useEffect(() => { loadDocuments() }, [lead.id])

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError(null)
    if (file.type !== 'application/pdf') {
      setUploadError('Only PDF files are accepted.')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('File exceeds the 10MB limit.')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    setUploading(true)
    try {
      const document = await uploadDocument(lead.id, file)
      setDocuments(prev => [document, ...prev])
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Could not upload document.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleDownload(doc: LeadDocument) {
    try {
      await downloadDocument(doc.id, doc.fileName)
    } catch {
      setUploadError('Could not download document.')
    }
  }

  async function logActivity(e: React.FormEvent) {
    e.preventDefault()
    setLogError(null)
    setLogging(true)
    try {
      await api('/activities', {
        method: 'POST',
        auth: true,
        body: {
          leadId: lead.id,
          activityType: logForm.activityType,
          activityDate: logForm.activityDate,
          notes: logForm.notes.trim() || undefined,
          nextActionDate: logForm.nextActionDate || undefined,
        },
      })
      setLogForm({ activityType: 'Call', activityDate: todayInput(), notes: '', nextActionDate: '' })
      loadActivities()
    } catch (e) {
      setLogError(e instanceof Error ? e.message : 'Could not log activity.')
    } finally {
      setLogging(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-gray-100 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{lead.plant?.plantName ?? 'Lead details'}</h3>
            <span className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusStyle(lead.status?.statusName)}`}>
              {lead.status?.statusName ?? 'Submitted'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 text-base leading-none"
            aria-label="Close"
          >✕</button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <DetailSection title="Client">
            <DetailRow label="Client" value={lead.plant?.client?.clientName} />
          </DetailSection>

          <DetailSection title="Plant">
            <DetailRow label="Name" value={lead.plant?.plantName} />
            <DetailRow label="Company" value={lead.plant?.companyName} />
            <DetailRow label="Plant code" value={lead.plant?.plantCode} />
            <DetailRow label="City" value={lead.plant?.location?.city} />
            <DetailRow label="State" value={lead.plant?.location?.state} />
            <DetailRow label="Country" value={lead.plant?.location?.country} />
            <DetailRow label="Address" value={lead.plant?.location?.address} />
          </DetailSection>

          <DetailSection title="Contact person">
            <DetailRow label="Name" value={lead.contact?.contactPersonName} />
            <DetailRow label="Designation" value={lead.contact?.designation} />
            <DetailRow label="Email" value={lead.contact?.mailId} isEmail />
            <DetailRow label="Phone" value={lead.contact?.contactPersonNumber} />
            <DetailRow label="Alternate phone" value={lead.contact?.alternateNumber} />
          </DetailSection>

          <DetailSection title="Classification">
            <DetailRow label="Vertical" value={lead.vertical?.verticalName} />
            <DetailRow label="Sector" value={lead.sector?.sectorName} />
            <DetailRow label="Source" value={lead.source?.sourceName} />
            <DetailRow label="Service type" value={lead.serviceType?.serviceTypeName} />
            <DetailRow label="Event" value={lead.event?.eventName} />
          </DetailSection>

          <DetailSection title="Ownership">
            <DetailRow label="Assigned to" value={lead.assignedToUser ? (lead.assignedToUser.userName || lead.assignedToUser.email) : undefined} />
            <DetailRow label="Assigned by" value={lead.assignedByUser ? (lead.assignedByUser.userName || lead.assignedByUser.email) : undefined} />
            <DetailRow label="Created by" value={lead.createdByUser ? (lead.createdByUser.userName || lead.createdByUser.email) : undefined} />
          </DetailSection>

          <DetailSection title="Notes">
            <DetailRow label="Remark" value={lead.remark} />
            <DetailRow label="Created" value={fmt(lead.createdAt)} />
            <DetailRow label="Updated" value={fmt(lead.updatedAt)} />
          </DetailSection>

          <DetailSection title="Documents">
            <div className="mb-3">
              <input ref={fileInputRef} type="file" accept="application/pdf" onChange={handleFileSelected} disabled={uploading} className="text-xs text-gray-500 file:mr-2 file:rounded-lg file:border-0 file:bg-orange-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-orange-600 hover:file:bg-orange-100 dark:text-gray-400 dark:file:bg-orange-950/40 dark:file:text-orange-400" />
              <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">PDF only, up to 10MB.</p>
              {uploading && <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Uploading…</p>}
              {uploadError && <p className="mt-1 text-xs text-red-500 dark:text-red-400">{uploadError}</p>}
            </div>

            {loadingDocuments ? (
              <p className="py-2 text-center text-xs text-gray-400 dark:text-gray-500">Loading…</p>
            ) : documents.length === 0 ? (
              <p className="py-2 text-center text-xs text-gray-400 dark:text-gray-500">No documents uploaded yet.</p>
            ) : (
              <ul className="space-y-2 border-t border-gray-50 pt-3 dark:border-gray-800/60">
                {documents.map(doc => (
                  <li key={doc.id} className="flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-gray-900 dark:text-gray-100">{doc.fileName}</p>
                      <p className="text-gray-400 dark:text-gray-500">
                        {fmtSize(doc.fileSize)} · {doc.uploadedByUser ? (doc.uploadedByUser.userName || doc.uploadedByUser.email) : 'Unknown'} · {fmtDay(doc.createdAt)}
                      </p>
                    </div>
                    <button onClick={() => handleDownload(doc)} className="shrink-0 font-semibold text-orange-500 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-300">Download</button>
                  </li>
                ))}
              </ul>
            )}
          </DetailSection>

          <DetailSection title="Proposals">
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

            {loadingProposals ? (
              <p className="py-2 text-center text-xs text-gray-400 dark:text-gray-500">Loading…</p>
            ) : proposals.length === 0 ? (
              <p className="py-2 text-center text-xs text-gray-400 dark:text-gray-500">No proposals raised yet.</p>
            ) : (
              <ul className="space-y-2 border-t border-gray-50 pt-3 dark:border-gray-800/60">
                {proposals.map(p => (
                  <li key={p.id} className="flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <span className="font-semibold text-gray-900 dark:text-gray-100">{p.proposalNumber}</span>
                      {p.projectName && <span className="ml-1 text-gray-500 dark:text-gray-400">{p.projectName}</span>}
                      {p.value != null && <span className="ml-1 text-gray-400 dark:text-gray-500">₹{p.value.toLocaleString()}</span>}
                    </div>
                    <span className="shrink-0 rounded-full border border-gray-200 px-2 py-0.5 font-semibold text-gray-600 dark:border-gray-700 dark:text-gray-300">{p.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </DetailSection>

          <DetailSection title="Activity timeline" last>
            <form onSubmit={logActivity} className="mb-3 grid grid-cols-2 gap-2">
              <select value={logForm.activityType} onChange={e => setLogForm({ ...logForm, activityType: e.target.value as ActivityType })} className={inputCls}>
                {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <input type="date" value={logForm.activityDate} onChange={e => setLogForm({ ...logForm, activityDate: e.target.value })} className={inputCls} />
              <textarea value={logForm.notes} onChange={e => setLogForm({ ...logForm, notes: e.target.value })} placeholder="Notes" rows={2} className={`${inputCls} col-span-2 resize-none`} />
              <label className="col-span-2 flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
                Next action date (optional)
                <input type="date" value={logForm.nextActionDate} onChange={e => setLogForm({ ...logForm, nextActionDate: e.target.value })} className={inputCls} />
              </label>
              {logError && <p className="col-span-2 text-xs text-red-500 dark:text-red-400">{logError}</p>}
              <div className="col-span-2">
                <button disabled={logging} className="rounded-xl bg-gradient-to-r from-rose-400 to-orange-400 px-4 py-1.5 text-xs font-semibold text-white transition hover:from-rose-500 hover:to-orange-500 disabled:opacity-60">
                  {logging ? 'Logging…' : 'Log activity'}
                </button>
              </div>
            </form>

            {loadingActivities ? (
              <p className="py-2 text-center text-xs text-gray-400 dark:text-gray-500">Loading…</p>
            ) : activities.length === 0 ? (
              <p className="py-2 text-center text-xs text-gray-400 dark:text-gray-500">No activity logged yet.</p>
            ) : (
              <ul className="space-y-2.5 border-t border-gray-50 pt-3 dark:border-gray-800/60">
                {activities.map(a => (
                  <li key={a.id} className="text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-gray-900 dark:text-gray-100">{a.activityType}</span>
                      <span className="text-gray-400 dark:text-gray-500">{fmtDay(a.activityDate)}</span>
                    </div>
                    {a.notes && <p className="mt-0.5 text-gray-600 dark:text-gray-400">{a.notes}</p>}
                    <p className="mt-0.5 text-gray-400 dark:text-gray-500">
                      {a.user ? `by ${a.user.userName || a.user.email}` : ''}
                      {a.nextActionDate ? ` · next: ${fmtDay(a.nextActionDate)}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </DetailSection>
        </div>
      </div>
    </div>
  )
}

function DetailSection({ title, children, last = false }: { title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`${last ? '' : 'mb-4 border-b border-gray-50 pb-4 dark:border-gray-800/60'}`}>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function DetailRow({ label, value, isEmail = false }: { label: string; value?: string | null; isEmail?: boolean }) {
  if (!value) return null
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="shrink-0 text-gray-500 dark:text-gray-400">{label}</span>
      {isEmail ? (
        <a href={`mailto:${value}`} className="truncate text-right font-medium text-orange-500 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-300">{value}</a>
      ) : (
        <span className="truncate text-right font-medium text-gray-900 dark:text-gray-100">{value}</span>
      )}
    </div>
  )
}

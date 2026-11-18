import { useEffect, useRef, useState } from 'react'
import { api, uploadDocument, downloadDocument } from '../lib/api'
import type { LeadDocument } from '../lib/api'
import { fmtDay } from '../lib/format'
import { btn } from '../lib/ui'
import { toast } from '../lib/toast'
import { useConfirm } from '../lib/useConfirm'

const fmtSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`)

// Kept in sync with the server's ALLOWED_EXTENSIONS in routes/documents.ts.
const EXTENSIONS = ['.pdf', '.xlsx', '.xls', '.csv']

// Files attached to an invoice or a proposal: an "Add" button, and the files
// already attached with download / remove.
type Target = { invoiceId: string } | { proposalId: string }
export function InvoiceDocuments({ invoiceId, invoiceNumber }: { invoiceId: string; invoiceNumber: string }) {
  return <AttachedDocuments target={{ invoiceId }} subject={invoiceNumber} addLabel="+ Add invoice document" />
}
export function ProposalDocuments({ proposalId, proposalNumber }: { proposalId: string; proposalNumber: string }) {
  return <AttachedDocuments target={{ proposalId }} subject={proposalNumber} addLabel="+ Add documentation" />
}

function AttachedDocuments({ target, subject, addLabel }: { target: Target; subject: string; addLabel: string }) {
  const query = 'proposalId' in target ? `proposalId=${target.proposalId}` : `invoiceId=${target.invoiceId}`
  const [documents, setDocuments] = useState<LeadDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [confirmDialog, confirm] = useConfirm()

  useEffect(() => {
    setLoading(true)
    api<{ documents: LeadDocument[] }>(`/documents?${query}`, { auth: true })
      .then(({ documents }) => { setDocuments(documents); setError(null) })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load documents.'))
      .finally(() => setLoading(false))
  }, [query])

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    if (inputRef.current) inputRef.current.value = ''
    if (!picked.length) return
    const bad = picked.find(f => !EXTENSIONS.some(x => f.name.toLowerCase().endsWith(x)))
      ? 'Only PDF, Excel (.xlsx/.xls) or CSV files are accepted.'
      : picked.find(f => f.size > 10 * 1024 * 1024) ? 'Each file must be 10MB or smaller.' : null
    setError(bad)
    if (bad) return
    setUploading(true)
    const failed: string[] = []
    for (const file of picked) {
      try {
        const document = await uploadDocument(target, file)
        setDocuments(prev => [{ ...document, canDelete: true }, ...prev])
      } catch { failed.push(file.name) }
    }
    setUploading(false)
    if (failed.length) setError(`Could not upload: ${failed.join(', ')}.`)
    else toast(`${picked.length === 1 ? 'Document' : `${picked.length} documents`} added to ${subject}`)
  }

  async function remove(doc: LeadDocument) {
    const ok = await confirm({ title: `Remove ${doc.fileName}?`, message: `It will no longer be attached to ${subject}.`, confirmLabel: 'Remove', danger: true })
    if (!ok) return
    try {
      await api(`/documents/${doc.id}`, { method: 'DELETE', auth: true })
      setDocuments(prev => prev.filter(d => d.id !== doc.id))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove document.')
    }
  }

  return (
    <div className="mb-3" onClick={e => e.stopPropagation()}>
      <input ref={inputRef} type="file" multiple accept={EXTENSIONS.join(',')} onChange={onPick} className="sr-only" tabIndex={-1} aria-hidden="true" />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading} className={btn('secondary', 'sm')}>
          {uploading ? 'Uploading…' : addLabel}
        </button>
        <span className="text-[11px] text-gray-400 dark:text-gray-500">PDF, Excel or CSV, up to 10MB each.</span>
      </div>
      {error && <p className="mt-1.5 text-xs text-red-500 dark:text-red-400">{error}</p>}
      {!loading && documents.length > 0 && (
        <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-100 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
          {documents.map(doc => (
            <li key={doc.id} className="flex items-center justify-between gap-3 px-3.5 py-2 text-xs">
              <span className="min-w-0">
                <span className="block truncate font-medium text-gray-900 dark:text-gray-100">{doc.fileName}</span>
                <span className="text-gray-400 dark:text-gray-500">{fmtSize(doc.fileSize)} · {doc.uploadedByUser ? (doc.uploadedByUser.userName || doc.uploadedByUser.email) : 'Unknown'} · {fmtDay(doc.createdAt)}</span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <button type="button" onClick={() => downloadDocument(doc.id, doc.fileName).catch(() => setError('Could not download document.'))} className="font-semibold text-orange-500 hover:text-orange-600 dark:text-orange-400">Download</button>
                {doc.canDelete && <button type="button" onClick={() => remove(doc)} className="font-semibold text-red-500 hover:text-red-600 dark:text-red-400">Remove</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {confirmDialog}
    </div>
  )
}

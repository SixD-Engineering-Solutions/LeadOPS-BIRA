import { useEffect, useRef, useState } from 'react'
import { api, uploadDocument, downloadDocument } from '../../lib/api'
import type { LeadDocument } from '../../lib/api'
import { ErrorBanner } from '../ErrorBanner'
import { DetailSection, fmtDay } from './shared'

const fmtSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`)

// Kept in sync with the server's ALLOWED_EXTENSIONS in routes/documents.ts.
const ALLOWED_DOCUMENT_EXTENSIONS = ['.pdf', '.xlsx', '.xls', '.csv']

// Documents uploaded against a lead — upload form, list, and download.
export function LeadDocumentsSection({ leadId }: { leadId: string }) {
  const [documents, setDocuments] = useState<LeadDocument[]>([])
  const [loadingDocuments, setLoadingDocuments] = useState(true)
  const [documentsError, setDocumentsError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function loadDocuments() {
    setLoadingDocuments(true)
    api<{ documents: LeadDocument[] }>(`/documents?leadId=${leadId}`, { auth: true })
      .then(({ documents }) => { setDocuments(documents); setDocumentsError(null) })
      .catch(e => setDocumentsError(e instanceof Error ? e.message : 'Failed to load documents.'))
      .finally(() => setLoadingDocuments(false))
  }
  useEffect(() => { loadDocuments() }, [leadId])

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError(null)
    if (!ALLOWED_DOCUMENT_EXTENSIONS.some(ext => file.name.toLowerCase().endsWith(ext))) {
      setUploadError('Only PDF, Excel (.xlsx/.xls), or CSV files are accepted.')
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
      const document = await uploadDocument(leadId, file)
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

  return (
    <DetailSection title="Documents">
      <div className="mb-3">
        <input ref={fileInputRef} type="file" accept={ALLOWED_DOCUMENT_EXTENSIONS.join(',')} onChange={handleFileSelected} disabled={uploading} className="text-xs text-gray-500 file:mr-2 file:rounded-lg file:border-0 file:bg-orange-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-orange-600 hover:file:bg-orange-100 dark:text-gray-400 dark:file:bg-orange-950/40 dark:file:text-orange-400" />
        <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">PDF, Excel, or CSV, up to 10MB.</p>
        {uploading && <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Uploading…</p>}
        {uploadError && <p className="mt-1 text-xs text-red-500 dark:text-red-400">{uploadError}</p>}
      </div>

      {documentsError ? (
        <ErrorBanner message={documentsError} onRetry={loadDocuments} className="my-2" />
      ) : loadingDocuments ? (
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
  )
}

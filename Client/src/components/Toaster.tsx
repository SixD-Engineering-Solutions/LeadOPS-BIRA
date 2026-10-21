import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useToasts, dismissToast } from '../lib/toast'
import type { Toast } from '../lib/toast'

const ICONS: Record<Toast['tone'], { path: string; cls: string }> = {
  success: { path: 'M5 13l4 4L19 7', cls: 'text-emerald-500' },
  error: { path: 'M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z', cls: 'text-red-500' },
  info: { path: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z', cls: 'text-sky-500' },
}

// Where toast() messages appear: bottom right (bottom centre on a phone),
// announced to screen readers.
export function Toaster() {
  const toasts = useToasts()
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[80] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end" role="status" aria-live="polite">
      {toasts.map(t => <ToastItem key={t.id} toast={t} />)}
    </div>,
    document.body,
  )
}

function ToastItem({ toast }: { toast: Toast }) {
  const [busy, setBusy] = useState(false)
  const icon = ICONS[toast.tone]
  return (
    <div className="popover-in pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl border border-gray-100 bg-white px-3.5 py-2.5 text-sm shadow-xl shadow-gray-900/10 dark:border-gray-700 dark:bg-gray-800 dark:shadow-black/40">
      <svg className={`h-4 w-4 shrink-0 ${icon.cls}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d={icon.path} /></svg>
      <span className="min-w-0 flex-1 text-gray-800 dark:text-gray-100">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => { setBusy(true); try { await toast.action!.onClick() } finally { dismissToast(toast.id) } }}
          className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-orange-600 hover:bg-orange-50 disabled:opacity-50 dark:text-orange-400 dark:hover:bg-orange-500/10"
        >
          {busy ? '…' : toast.action.label}
        </button>
      )}
      <button type="button" onClick={() => dismissToast(toast.id)} aria-label="Dismiss" className="shrink-0 rounded-md p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
        <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M4.3 4.3a1 1 0 011.4 0L10 8.6l4.3-4.3a1 1 0 111.4 1.4L11.4 10l4.3 4.3a1 1 0 01-1.4 1.4L10 11.4l-4.3 4.3a1 1 0 01-1.4-1.4L8.6 10 4.3 5.7a1 1 0 010-1.4z" clipRule="evenodd" /></svg>
      </button>
    </div>
  )
}

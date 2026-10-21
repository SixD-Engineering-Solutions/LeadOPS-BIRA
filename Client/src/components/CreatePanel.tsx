import { useId } from 'react'
import type { ReactNode } from 'react'
import { Drawer } from './Drawer'
import { btn } from '../lib/ui'

// The side panel every "+ New …" button opens: the page's create form, with
// Cancel / save pinned at the bottom. The form's state lives in the page, so
// closing the panel half-way keeps what was typed for next time.
export function CreatePanel({ title, subtitle, onClose, onSubmit, saving, submitLabel, savingLabel = 'Saving…', error, children }: {
  title: string
  subtitle?: ReactNode
  onClose: () => void
  onSubmit: (e: React.FormEvent) => void
  saving: boolean
  submitLabel: string
  savingLabel?: string
  error?: string | null
  children: ReactNode
}) {
  const formId = useId()
  return (
    <Drawer
      label={title}
      onClose={onClose}
      size="md"
      header={
        <div className="pr-10">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>}
        </div>
      }
      footer={
        <div>
          {error && <p role="alert" className="mb-2 text-xs text-red-500 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className={btn('secondary', 'md')}>
              Cancel
            </button>
            <button type="submit" form={formId} disabled={saving} className={btn('primary', 'md')}>
              {saving ? savingLabel : submitLabel}
            </button>
          </div>
        </div>
      }
    >
      <form id={formId} onSubmit={onSubmit} className="px-6 py-5" noValidate>
        {children}
      </form>
    </Drawer>
  )
}

import type { ReactNode } from 'react'

// A labelled form control with its own error line underneath ("Plant is
// required." under Plant) and an optional hint. The control itself is the
// child; give it `aria-invalid` and the INVALID_CLS look when `error` is set
// (lib/formStyles), so the first problem can be focused on submit.
export function Field({ label, error, hint, required = false, className = '', children }: {
  label: ReactNode
  error?: string
  hint?: ReactNode
  required?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <label className={`flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400 ${className}`}>
      <span>{label}{required && <span aria-hidden="true"> *</span>}</span>
      {children}
      {error
        ? <span role="alert" className="text-[11px] font-normal text-red-500 dark:text-red-400">{error}</span>
        : hint && <span className="text-[11px] font-normal text-gray-400 dark:text-gray-400">{hint}</span>}
    </label>
  )
}

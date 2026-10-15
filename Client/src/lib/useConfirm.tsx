import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Modal } from '../components/Modal'

type ConfirmOptions = {
  title: string
  message: ReactNode
  confirmLabel: string
  /** Red button — for deleting / removing / voiding. */
  danger?: boolean
}

// A styled replacement for window.confirm(): `await confirm({...})` resolves
// true only if the person clicks the confirm button. Render `dialog` once in
// the component that calls it.
//
//   const [dialog, confirm] = useConfirm()
//   if (!(await confirm({ title: 'Delete lead?', ... }))) return
export function useConfirm(): [ReactNode, (opts: ConfirmOptions) => Promise<boolean>] {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const finish = (ok: boolean) => {
    resolver.current?.(ok)
    resolver.current = null
    setOpts(null)
  }

  const ask = (o: ConfirmOptions) => new Promise<boolean>(resolve => {
    resolver.current?.(false) // a second ask replaces the first
    resolver.current = resolve
    setOpts(o)
  })

  const dialog = opts && (
    <Modal title={opts.title} onClose={() => finish(false)}>
      <div className="text-sm text-gray-600 dark:text-gray-300">{opts.message}</div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={() => finish(false)} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-orange-300 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
          Cancel
        </button>
        <button
          type="button"
          autoFocus
          onClick={() => finish(true)}
          className={`rounded-xl px-4 py-2 text-sm font-semibold text-white outline-none transition focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900 ${
            opts.danger ? 'bg-rose-600 hover:bg-rose-700 focus-visible:ring-rose-400' : 'bg-orange-500 hover:bg-orange-600 focus-visible:ring-orange-300'
          }`}
        >
          {opts.confirmLabel}
        </button>
      </div>
    </Modal>
  )

  return [dialog, ask]
}

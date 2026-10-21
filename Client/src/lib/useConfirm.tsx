import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Modal } from '../components/Modal'
import { btn } from './ui'

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
        <button type="button" onClick={() => finish(false)} className={btn('secondary', 'md')}>
          Cancel
        </button>
        <button
          type="button"
          autoFocus
          onClick={() => finish(true)}
          className={opts.danger ? btn('danger', 'md') : `${btn('primary', 'md')} !bg-none bg-orange-500 hover:bg-orange-600`}
        >
          {opts.confirmLabel}
        </button>
      </div>
    </Modal>
  )

  return [dialog, ask]
}

import { useSyncExternalStore } from 'react'

// Small confirmation messages in the corner after an action ("Lead added",
// "Status changed to In Process"), with an optional action button such as
// Undo or View. Call `toast(...)` from anywhere; <Toaster> (rendered once, by
// the dashboard shell) shows them. Each one leaves after a few seconds, or
// when its action is used.

export type ToastAction = { label: string; onClick: () => void | Promise<void> }
export type Toast = { id: number; message: string; tone: 'success' | 'error' | 'info'; action?: ToastAction }

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())

export function dismissToast(id: number) {
  toasts = toasts.filter(t => t.id !== id)
  emit()
}

export function toast(message: string, opts: { tone?: Toast['tone']; action?: ToastAction; duration?: number } = {}) {
  const id = nextId++
  // Newest last; at most three on screen.
  toasts = [...toasts, { id, message, tone: opts.tone ?? 'success', action: opts.action }].slice(-3)
  emit()
  window.setTimeout(() => dismissToast(id), opts.duration ?? (opts.action ? 7000 : 4000))
  return id
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => { listeners.delete(cb) } },
    () => toasts,
    () => toasts,
  )
}

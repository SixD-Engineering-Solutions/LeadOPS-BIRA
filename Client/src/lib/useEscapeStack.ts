import { useEffect, useRef } from 'react'

// Every open overlay (modal, side panel, menu), oldest first — Esc closes only
// the top one: a menu inside a lead's side panel closes the menu, a second Esc
// the panel. Shared so the different kinds of overlay agree on who is on top.
const openStack: symbol[] = []

export function useEscapeStack(onClose: () => void, active = true) {
  // Latest onClose without re-binding the key listener on every parent render.
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  useEffect(() => {
    if (!active) return
    const id = Symbol('overlay')
    openStack.push(id)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openStack[openStack.length - 1] === id) {
        e.stopPropagation()
        onCloseRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      openStack.splice(openStack.indexOf(id), 1)
    }
  }, [active])
}

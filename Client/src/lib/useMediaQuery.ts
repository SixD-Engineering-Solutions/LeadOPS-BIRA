import { useSyncExternalStore } from 'react'

// Whether a CSS media query matches right now, kept up to date as the window
// is resized or a phone is turned.
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    onChange => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** Below Tailwind's `sm` breakpoint (640px) — a phone held upright. */
export const useIsPhone = () => useMediaQuery('(max-width: 639px)')

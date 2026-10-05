import { useEffect, useState } from 'react'

const THEME_KEY = 'leadops_theme'
export type Theme = 'light' | 'dark'

// Broadcast so anything rendering theme-dependent inline colors (e.g. recharts
// SVG props, which Tailwind's `dark:` variant can't reach) can react — see
// useTheme() below.
const THEME_CHANGE_EVENT = 'leadops:theme-change'

// Light by default, whatever the computer's own setting — dark only once
// someone picks it with the toggle (remembered per browser).
export function getTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY)
  return stored === 'dark' ? 'dark' : 'light'
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(THEME_KEY, theme)
  applyTheme(theme)
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: theme }))
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark'
  setTheme(next)
  return next
}

/** Reactive current theme — re-renders when ThemeToggle flips it. */
export function useTheme(): Theme {
  const [theme, setThemeState] = useState(getTheme)
  useEffect(() => {
    const onChange = (e: Event) => setThemeState((e as CustomEvent<Theme>).detail)
    window.addEventListener(THEME_CHANGE_EVENT, onChange)
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange)
  }, [])
  return theme
}

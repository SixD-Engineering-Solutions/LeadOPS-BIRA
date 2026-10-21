import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Inter, bundled with the app (no request to Google Fonts — works on a closed
// network and under a strict content-security policy).
import '@fontsource-variable/inter'
import './index.css'
import App from './App.tsx'
import { applyTheme, getTheme } from './lib/theme'

applyTheme(getTheme())

// Pages are downloaded when first opened. After a redeploy, a tab that was
// already open asks for page files the new version has replaced — reload it
// once onto the new version instead of showing a blank screen. (The time
// guard stops a reload loop if the server itself is down.)
window.addEventListener('vite:preloadError', event => {
  const KEY = 'leadops.reloadedForUpdate'
  let last = 0
  try { last = Number(sessionStorage.getItem(KEY) ?? 0) } catch { /* ignore */ }
  if (Date.now() - last < 30_000) return
  try { sessionStorage.setItem(KEY, String(Date.now())) } catch { /* ignore */ }
  event.preventDefault()
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Inter, bundled with the app (no request to Google Fonts — works on a closed
// network and under a strict content-security policy).
import '@fontsource-variable/inter'
import './index.css'
import App from './App.tsx'
import { applyTheme, getTheme } from './lib/theme'

applyTheme(getTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

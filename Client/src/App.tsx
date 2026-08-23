import { useEffect, useState } from 'react'
import Login from './pages/login'
import Dashboard from './pages/dashboard'
import { api, getToken, clearToken } from './lib/api'
import type { AuthUser } from './lib/api'
import { hasDevSession, endDevSession, DEV_USER } from './lib/devAuth'

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [restoring, setRestoring] = useState(true)

  // On load, restore the session.
  useEffect(() => {
    // DEV-ONLY: restore the bypass session without hitting the DB-backed /auth/me.
    if (hasDevSession()) {
      setUser(DEV_USER)
      setRestoring(false)
      return
    }
    if (!getToken()) {
      setRestoring(false)
      return
    }
    api<{ user: AuthUser }>('/auth/me', { auth: true })
      .then(res => setUser(res.user))
      .catch(() => clearToken())
      .finally(() => setRestoring(false))
  }, [])

  function handleSignOut() {
    clearToken()
    endDevSession()
    setUser(null)
  }

  if (restoring) {
    return (
      <div className="h-screen flex items-center justify-center text-gray-400 text-sm">Loading…</div>
    )
  }

  if (user) {
    return <Dashboard user={user} onSignOut={handleSignOut} />
  }

  return <Login onAuthed={setUser} />
}

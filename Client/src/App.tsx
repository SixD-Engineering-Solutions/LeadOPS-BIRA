import { useEffect, useState } from 'react'
import Login from './pages/login'
import Dashboard from './pages/dashboard'
import { api, getToken, clearToken } from './lib/api'
import type { AuthUser } from './lib/api'
import { SkeletonScreen } from './components/Skeleton'

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [restoring, setRestoring] = useState(true)

  // On load, restore the session — /auth/me also re-reads the role, so a
  // promotion/demotion shows up in the menus on the next page load.
  useEffect(() => {
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
    setUser(null)
  }

  if (restoring) {
    return (
      <SkeletonScreen />
    )
  }

  if (user) {
    return <Dashboard user={user} onSignOut={handleSignOut} />
  }

  return <Login onAuthed={setUser} />
}

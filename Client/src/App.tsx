import { lazy, Suspense, useEffect, useState } from 'react'
import { api, getToken, clearToken } from './lib/api'
import type { AuthUser } from './lib/api'
import { SkeletonScreen } from './components/Skeleton'

// Each screen is its own download: someone already signed in never loads the
// sign-in page (and Microsoft's sign-in library), and the sign-in page doesn't
// wait for the whole app.
const Login = lazy(() => import('./pages/login'))
const Dashboard = lazy(() => import('./pages/dashboard'))

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [restoring, setRestoring] = useState(() => !!getToken())

  // On load, restore the session — /auth/me also re-reads the role, so a
  // promotion/demotion shows up in the menus on the next page load.
  useEffect(() => {
    if (!getToken()) return
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
    return <Suspense fallback={<SkeletonScreen />}><Dashboard user={user} onSignOut={handleSignOut} /></Suspense>
  }

  return <Suspense fallback={<div className="h-screen bg-white dark:bg-gray-950" />}><Login onAuthed={setUser} /></Suspense>
}

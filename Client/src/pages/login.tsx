import { useEffect, useState } from 'react'
import Input from '../components/Input'
import Button from '../components/Button'
import { api, setToken } from '../lib/api'
import type { AuthUser, AuthResponse } from '../lib/api'
import ThemeToggle from '../components/ThemeToggle'
import { microsoftRedirectIdToken, startMicrosoftSignIn } from '../lib/microsoft'
import type { MicrosoftConfig } from '../lib/microsoft'

// ─── icons ────────────────────────────────────────────────────────────────────

function MailIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  )
}


function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ) : (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  )
}

// ─── shared image panel ───────────────────────────────────────────────────────

function ImagePanel() {
  return (
    <div className="hidden md:flex relative w-[45%] flex-col overflow-hidden rounded-[1.4rem]">
      <img src="/login_side.png" alt="" className="absolute inset-0 w-full h-full object-cover z-0" />
      <div className="absolute bottom-0 left-0 right-0 h-28 bg-gradient-to-t from-black/55 to-transparent z-10 pointer-events-none rounded-b-[1.4rem]" />
      <div className="relative z-20 mt-auto p-10">
        <h3 className="text-white text-xl font-bold leading-snug drop-shadow-md">LeadOps Control Center</h3>
        <p className="mt-2 text-white/80 text-sm leading-relaxed drop-shadow-sm">
          Turn incoming opportunities into visible execution.
        </p>
      </div>
    </div>
  )
}

// ─── shared card classes ──────────────────────────────────────────────────────

const cardCls = `absolute inset-0 flex gap-3 p-3
  bg-white/60 dark:bg-gray-900/60 backdrop-blur-2xl rounded-4xl
  border border-white/60 dark:border-gray-700/60
  [backface-visibility:hidden]
  shadow-[0_32px_80px_rgba(0,0,0,0.35),0_8px_24px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.8),inset_0_-1px_0_rgba(0,0,0,0.05)]`

const panelCls = 'flex-1 bg-white dark:bg-gray-900 px-8 sm:px-10 py-6 flex flex-col overflow-y-auto rounded-[1.4rem]'

// ─── forgot password ──────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type ResetStep = 'email' | 'otp' | 'password'

const RESET_COPY: Record<ResetStep, { title: string; subtitle: string }> = {
  email: { title: 'Forgot Password?', subtitle: "Enter your account email and we'll send you a reset code" },
  otp: { title: 'Check Your Email', subtitle: 'Enter the 6-digit code we sent you' },
  password: { title: 'Set New Password', subtitle: 'Choose a new password for your account' },
}

function ForgotPassword({ initialEmail, onBack, onDone }: {
  initialEmail: string
  onBack: () => void
  onDone: (email: string) => void
}) {
  const [step, setStep] = useState<ResetStep>('email')
  const [email, setEmail] = useState(initialEmail)
  const [otp, setOtp] = useState('')
  const [resetToken, setResetToken] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)
  const [errors, setErrors] = useState<{ email?: string; otp?: string; password?: string; confirmPassword?: string }>({})
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function sendCode() {
    if (!EMAIL_RE.test(email)) {
      setErrors({ email: 'Enter a valid email.' })
      return
    }
    setErrors({})
    setError(null)
    setLoading(true)
    try {
      await api('/auth/forgot-password', { method: 'POST', body: { email } })
      setOtp('')
      setNotice(`Code sent to ${email}.`)
      setStep('otp')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the reset code.')
    } finally {
      setLoading(false)
    }
  }

  async function verifyCode() {
    if (otp.length < 6) {
      setErrors({ otp: 'Enter the 6-digit code.' })
      return
    }
    setErrors({})
    setError(null)
    setLoading(true)
    try {
      const res = await api<{ resetToken: string }>('/auth/verify-otp', {
        method: 'POST',
        body: { email, otp },
      })
      setResetToken(res.resetToken)
      setNotice(null)
      setStep('password')
    } catch (err) {
      setErrors({ otp: err instanceof Error ? err.message : 'Invalid code. Please try again.' })
    } finally {
      setLoading(false)
    }
  }

  async function resetPassword() {
    const next: typeof errors = {}
    if (!password) next.password = 'Password is required.'
    else if (password.length < 6) next.password = 'Must be at least 6 characters.'
    if (!confirmPassword) next.confirmPassword = 'Please confirm your password.'
    else if (password !== confirmPassword) next.confirmPassword = 'Passwords do not match.'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setError(null)
    setLoading(true)
    try {
      await api('/auth/reset-password', { method: 'POST', body: { resetToken, password } })
      onDone(email)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset your password.')
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault()
    if (step === 'email') void sendCode()
    else if (step === 'otp') void verifyCode()
    else void resetPassword()
  }

  const { title, subtitle } = RESET_COPY[step]

  return (
    <>
      <div className="mb-5 text-center">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{title}</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
        {step === 'email' && (
          <Input
            id="reset-email"
            label="Email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            value={email}
            onChange={e => { setEmail(e.target.value); setErrors({}) }}
            error={errors.email}
            leftIcon={<MailIcon />}
            autoFocus
          />
        )}

        {step === 'otp' && (
          <div className="flex flex-col gap-1.5">
            {notice && <p className="text-xs text-gray-500 dark:text-gray-400 break-all">{notice}</p>}
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={otp}
              onChange={e => { setOtp(e.target.value.replace(/\D/g, '')); setErrors({}) }}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 text-center text-xl tracking-[0.4em] text-gray-900 outline-none transition focus:border-transparent focus:ring-2 focus:ring-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              autoFocus
            />
            {errors.otp && <p className="text-xs text-red-500 dark:text-red-400">{errors.otp}</p>}
            <div className="flex items-center justify-between text-xs">
              <button type="button" onClick={() => { setStep('email'); setErrors({}); setError(null) }}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 transition cursor-pointer">
                Change email
              </button>
              <button type="button" onClick={() => void sendCode()} disabled={loading}
                className="font-medium text-rose-500 hover:text-rose-600 transition cursor-pointer disabled:opacity-50">
                Resend code
              </button>
            </div>
          </div>
        )}

        {step === 'password' && (
          <>
            <Input
              id="reset-password"
              label="New Password"
              type={showPw ? 'text' : 'password'}
              placeholder="••••••••"
              autoComplete="new-password"
              value={password}
              onChange={e => { setPassword(e.target.value); setErrors(prev => ({ ...prev, password: undefined })) }}
              error={errors.password}
              leftIcon={<LockIcon />}
              autoFocus
              rightIcon={
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="cursor-pointer text-gray-400 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300 transition"
                  aria-label={showPw ? 'Hide password' : 'Show password'}>
                  <EyeIcon open={showPw} />
                </button>
              }
            />
            <Input
              id="reset-confirm-password"
              label="Confirm Password"
              type={showConfirmPw ? 'text' : 'password'}
              placeholder="••••••••"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={e => { setConfirmPassword(e.target.value); setErrors(prev => ({ ...prev, confirmPassword: undefined })) }}
              error={errors.confirmPassword}
              leftIcon={<LockIcon />}
              rightIcon={
                <button type="button" onClick={() => setShowConfirmPw(v => !v)}
                  className="cursor-pointer text-gray-400 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300 transition"
                  aria-label={showConfirmPw ? 'Hide password' : 'Show password'}>
                  <EyeIcon open={showConfirmPw} />
                </button>
              }
            />
          </>
        )}

        {error && (
          <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600 dark:bg-red-950/40 dark:border-red-800 dark:text-red-400">{error}</p>
        )}

        <Button type="submit" variant="gradient" loading={loading} className="mt-0.5 py-2.5">
          {step === 'email' ? 'Send Reset Code' : step === 'otp' ? 'Verify Code' : 'Reset Password'}
        </Button>
      </form>

      <p className="mt-4 text-center text-sm text-gray-500 dark:text-gray-400">
        Remembered it?{' '}
        <button type="button" onClick={onBack}
          className="font-semibold text-rose-500 hover:text-rose-600 transition cursor-pointer">
          Back to sign in
        </button>
      </p>
    </>
  )
}

// ─── types ────────────────────────────────────────────────────────────────────

type Credentials = { email: string; password: string }
type LoginErrors = Partial<Record<keyof Credentials, string>>
type PasswordLogin = 'everyone' | 'admins' | 'off'

function MicrosoftLogo() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 23 23" aria-hidden="true">
      <path fill="#f25022" d="M1 1h10v10H1z" />
      <path fill="#7fba00" d="M12 1h10v10H12z" />
      <path fill="#00a4ef" d="M1 12h10v10H1z" />
      <path fill="#ffb900" d="M12 12h10v10H12z" />
    </svg>
  )
}

// ─── component ────────────────────────────────────────────────────────────────

// There's no self sign-up: an admin adds people on the Team page. Once
// Microsoft sign-in is configured on the server, that's the main way in and
// the password form is the admins' backup; until then it's password only.
export default function Login({ onAuthed }: { onAuthed: (user: AuthUser) => void }) {
  const [credentials, setCredentials] = useState<Credentials>({ email: '', password: '' })
  const [rememberMe, setRememberMe] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [loginErrors, setLoginErrors] = useState<LoginErrors>({})
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginLoading, setLoginLoading] = useState(false)
  const [forgotOpen, setForgotOpen] = useState(false)
  const [loginNotice, setLoginNotice] = useState<string | null>(null)

  // ── Microsoft sign-in ──
  const [msConfig, setMsConfig] = useState<MicrosoftConfig | null>(null)
  const [msLoading, setMsLoading] = useState(false)
  // Which password sign-in the server allows; null until it answers, so a
  // Microsoft-only login page never flashes the password form first.
  const [passwordLogin, setPasswordLogin] = useState<PasswordLogin | null>(null)

  // Ask the server whether Microsoft sign-in is on, and if this page load is
  // the return trip from Microsoft's account picker, finish signing in.
  useEffect(() => {
    let cancelled = false
    api<{ microsoft: MicrosoftConfig | null; passwordLogin?: PasswordLogin }>('/auth/config')
      .then(async ({ microsoft, passwordLogin: mode }) => {
        if (!cancelled) setPasswordLogin(mode ?? 'everyone')
        if (cancelled || !microsoft) return
        setMsConfig(microsoft)
        const idToken = await microsoftRedirectIdToken(microsoft)
        if (!idToken || cancelled) return
        setMsLoading(true)
        const res = await api<AuthResponse>('/auth/microsoft', { method: 'POST', body: { idToken } })
        setToken(res.accessToken)
        onAuthed(res.user)
      })
      .catch(err => {
        if (cancelled) return
        setPasswordLogin(prev => prev ?? 'everyone')
        setLoginError(err instanceof Error ? err.message : 'Microsoft sign-in failed.')
        setMsLoading(false)
      })
    return () => { cancelled = true }
  }, [onAuthed])

  async function handleMicrosoft() {
    if (!msConfig) return
    setLoginError(null)
    setMsLoading(true)
    try {
      await startMicrosoftSignIn(msConfig)
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Could not open Microsoft sign-in.')
      setMsLoading(false)
    }
  }

  // ── password sign-in ──
  function updateLogin(field: keyof Credentials) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setCredentials(prev => ({ ...prev, [field]: e.target.value }))
      if (loginErrors[field]) setLoginErrors(prev => ({ ...prev, [field]: undefined }))
    }
  }

  function validateLogin(): boolean {
    const next: LoginErrors = {}
    if (!credentials.email) next.email = 'Email is required.'
    else if (!EMAIL_RE.test(credentials.email)) next.email = 'Enter a valid email.'
    if (!credentials.password) next.password = 'Password is required.'
    else if (credentials.password.length < 6) next.password = 'Must be at least 6 characters.'
    setLoginErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleLogin(e: { preventDefault(): void }) {
    e.preventDefault()
    setLoginError(null)
    if (!validateLogin()) return

    setLoginLoading(true)
    try {
      const res = await api<AuthResponse>('/auth/login', {
        method: 'POST',
        body: { email: credentials.email, password: credentials.password },
      })
      setToken(res.accessToken)
      onAuthed(res.user)
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Sign in failed.')
    } finally {
      setLoginLoading(false)
    }
  }

  // ── render ────────────────────────────────────────────────────────────────────

  return (
    <div
      className="relative h-screen flex items-center justify-center px-4 py-4 bg-cover bg-center bg-no-repeat overflow-hidden"
      style={{ backgroundImage: "url('/login_cover3.png')" }}
    >
      <div className="absolute right-5 top-5 z-30">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-5xl">
        <div className="relative h-[calc(100vh-2rem)]">
          <div className={cardCls}>
            <ImagePanel />

            <div className={panelCls}>
              <div className="flex-1 flex flex-col justify-center">
                {forgotOpen ? (
                  <ForgotPassword
                    initialEmail={credentials.email}
                    onBack={() => setForgotOpen(false)}
                    onDone={email => {
                      setCredentials({ email, password: '' })
                      setLoginErrors({})
                      setLoginError(null)
                      setLoginNotice('Password updated. Sign in with your new password.')
                      setForgotOpen(false)
                    }}
                  />
                ) : (<>
                <div className="mb-5 text-center">
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Welcome Back</h1>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Sign in to access your LeadOps dashboard</p>
                </div>

                {msConfig && (
                  <Button variant={passwordLogin === 'off' ? 'gradient' : 'outline'} type="button" onClick={handleMicrosoft} loading={msLoading} className="py-2.5">
                    <span className="flex items-center justify-center gap-2">
                      <MicrosoftLogo />
                      Sign in with Microsoft
                    </span>
                  </Button>
                )}

                {msConfig && passwordLogin === 'admins' && (
                  <div className="my-4 flex items-center gap-3">
                    <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                    <span className="text-xs text-gray-400 dark:text-gray-400 font-medium">Admins: sign in with password</span>
                    <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                  </div>
                )}

                {/* Microsoft-only: no password form, so errors show under the button. */}
                {(passwordLogin === 'off' || passwordLogin === null) && loginError && (
                  <p className="mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600 dark:bg-red-950/40 dark:border-red-800 dark:text-red-400">{loginError}</p>
                )}

                {(passwordLogin === 'everyone' || passwordLogin === 'admins') && (
                <form onSubmit={handleLogin} noValidate className="flex flex-col gap-3">
                  <Input
                    id="email"
                    label="Email"
                    type="email"
                    placeholder="you@example.com"
                    autoComplete="email"
                    value={credentials.email}
                    onChange={updateLogin('email')}
                    error={loginErrors.email}
                    leftIcon={<MailIcon />}
                  />

                  <Input
                    id="password"
                    label="Password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    value={credentials.password}
                    onChange={updateLogin('password')}
                    error={loginErrors.password}
                    leftIcon={<LockIcon />}
                    rightIcon={
                      <button type="button" onClick={() => setShowPassword(v => !v)}
                        className="cursor-pointer text-gray-400 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300 transition"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}>
                        <EyeIcon open={showPassword} />
                      </button>
                    }
                  />

                  <div className="flex items-center justify-between text-sm">
                    <label className="flex cursor-pointer items-center gap-2 text-gray-600 dark:text-gray-400 select-none">
                      <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 accent-rose-400" />
                      Remember me
                    </label>
                    <button type="button" onClick={() => { setLoginNotice(null); setForgotOpen(true) }}
                      className="font-medium text-rose-500 hover:text-rose-600 transition cursor-pointer">
                      Forgot Password?
                    </button>
                  </div>

                  {loginNotice && (
                    <p className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-700 dark:bg-green-950/40 dark:border-green-800 dark:text-green-400">{loginNotice}</p>
                  )}

                  {loginError && (
                    <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600 dark:bg-red-950/40 dark:border-red-800 dark:text-red-400">{loginError}</p>
                  )}

                  <Button type="submit" variant={msConfig ? 'outline' : 'gradient'} loading={loginLoading} className="mt-0.5 py-2.5">
                    Sign In
                  </Button>
                </form>
                )}

                <p className="mt-4 text-center text-sm text-gray-500 dark:text-gray-400">
                  Need access? Ask an admin to add you on the Team page.
                </p>
                </>)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

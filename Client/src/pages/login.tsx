import { useState } from 'react'
import Input from '../components/Input'
import Button from '../components/Button'
import { api, setToken } from '../lib/api'
import type { AuthUser, AuthResponse } from '../lib/api'
import { isDevBypass, startDevSession, DEV_USER } from '../lib/devAuth'
import ThemeToggle from '../components/ThemeToggle'

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

// ─── types ────────────────────────────────────────────────────────────────────

type Credentials = { email: string; password: string }
type LoginErrors = Partial<Record<keyof Credentials, string>>

type SignupForm = { email: string; otp: string; password: string; confirmPassword: string }
type SignupErrors = Partial<Record<keyof SignupForm, string>>

// ─── component ────────────────────────────────────────────────────────────────

export default function Login({ onAuthed }: { onAuthed: (user: AuthUser) => void }) {

  // ── flip ──
  const [isFlipped, setIsFlipped] = useState(false)

  // ── login state ──
  const [credentials, setCredentials] = useState<Credentials>({ email: '', password: '' })
  const [rememberMe, setRememberMe] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [loginErrors, setLoginErrors] = useState<LoginErrors>({})
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginLoading, setLoginLoading] = useState(false)

  function updateLogin(field: keyof Credentials) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setCredentials(prev => ({ ...prev, [field]: e.target.value }))
      if (loginErrors[field]) setLoginErrors(prev => ({ ...prev, [field]: undefined }))
    }
  }

  function validateLogin(): boolean {
    const next: LoginErrors = {}
    if (!credentials.email) next.email = 'Email is required.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(credentials.email)) next.email = 'Enter a valid email.'
    if (!credentials.password) next.password = 'Password is required.'
    else if (credentials.password.length < 6) next.password = 'Must be at least 6 characters.'
    setLoginErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleLogin(e: { preventDefault(): void }) {
    e.preventDefault()
    setLoginError(null)
    if (!validateLogin()) return

    // DEV-ONLY bypass — lets development continue while real auth/DB is unavailable.
    // Compiled out of production builds (see lib/devAuth.ts).
    if (isDevBypass(credentials.email, credentials.password)) {
      startDevSession()
      // Try to obtain a real access token so authenticated calls (e.g. /leads)
      // work. If the backend/DB is down, still enter the app (offline dashboard).
      try {
        const res = await api<AuthResponse>('/auth/dev-login', { method: 'POST' })
        setToken(res.accessToken)
      } catch {
        /* backend/DB unavailable — dashboard works, data features will show errors */
      }
      onAuthed(DEV_USER)
      return
    }

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

  // ── signup state ──
  const [signupForm, setSignupForm] = useState<SignupForm>({ email: '', otp: '', password: '', confirmPassword: '' })
  const [otpVerified, setOtpVerified] = useState(false)
  const [emailVerifiedToken, setEmailVerifiedToken] = useState<string | null>(null)
  const [showOtpPopover, setShowOtpPopover] = useState(false)
  const [otpLoading, setOtpLoading] = useState(false)
  const [showSignupPw, setShowSignupPw] = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)
  const [signupErrors, setSignupErrors] = useState<SignupErrors>({})
  const [signupError, setSignupError] = useState<string | null>(null)
  const [signupLoading, setSignupLoading] = useState(false)

  function updateSignup(field: keyof SignupForm) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setSignupForm(prev => ({ ...prev, [field]: e.target.value }))
      if (signupErrors[field]) setSignupErrors(prev => ({ ...prev, [field]: undefined }))
    }
  }

  async function handleSendOtp() {
    if (!signupForm.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signupForm.email)) {
      setSignupErrors(prev => ({ ...prev, email: 'Enter a valid email first.' }))
      return
    }
    setOtpLoading(true)
    try {
      await api('/auth/send-otp', { method: 'POST', body: { email: signupForm.email } })
      setSignupErrors(prev => ({ ...prev, email: undefined }))
      setShowOtpPopover(true)
    } catch (err) {
      setSignupErrors(prev => ({ ...prev, email: err instanceof Error ? err.message : 'Could not send OTP.' }))
    } finally {
      setOtpLoading(false)
    }
  }

  async function handleVerifyOtp() {
    if (signupForm.otp.length < 6) {
      setSignupErrors(prev => ({ ...prev, otp: 'Enter the 6-digit OTP.' }))
      return
    }
    setOtpLoading(true)
    try {
      const res = await api<{ emailVerifiedToken: string }>('/auth/verify-otp', {
        method: 'POST',
        body: { email: signupForm.email, otp: signupForm.otp },
      })
      setEmailVerifiedToken(res.emailVerifiedToken)
      setOtpVerified(true)
      setShowOtpPopover(false)
      setSignupErrors(prev => ({ ...prev, otp: undefined }))
    } catch (err) {
      setSignupErrors(prev => ({ ...prev, otp: err instanceof Error ? err.message : 'Invalid OTP. Please try again.' }))
    } finally {
      setOtpLoading(false)
    }
  }

  function validateSignup(): boolean {
    const next: SignupErrors = {}
    if (!signupForm.email) next.email = 'Email is required.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signupForm.email)) next.email = 'Enter a valid email.'
    if (!otpVerified) next.email = next.email ?? 'Please verify your email with OTP first.'
    if (!signupForm.password) next.password = 'Password is required.'
    else if (signupForm.password.length < 6) next.password = 'Must be at least 6 characters.'
    if (!signupForm.confirmPassword) next.confirmPassword = 'Please confirm your password.'
    else if (signupForm.password !== signupForm.confirmPassword) next.confirmPassword = 'Passwords do not match.'
    setSignupErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSignup(e: { preventDefault(): void }) {
    e.preventDefault()
    setSignupError(null)
    if (!validateSignup()) return
    if (!emailVerifiedToken) {
      setSignupError('Your email verification expired. Please verify your email again.')
      return
    }
    setSignupLoading(true)
    try {
      const res = await api<AuthResponse>('/auth/signup', {
        method: 'POST',
        body: { emailVerifiedToken, password: signupForm.password },
      })
      setToken(res.accessToken)
      onAuthed(res.user)
    } catch (err) {
      setSignupError(err instanceof Error ? err.message : 'Account creation failed.')
    } finally {
      setSignupLoading(false)
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
      <div className="w-full max-w-5xl" style={{ perspective: '1400px' }}>
        <div
          className={`relative h-[calc(100vh-2rem)] [transform-style:preserve-3d] transition-[transform] duration-700 ease-in-out
            ${isFlipped ? '[transform:rotateY(180deg)]' : ''}`}
        >

          {/* ══ FRONT — Login ══════════════════════════════════════════════════ */}
          <div className={cardCls}>
            <ImagePanel />

            <div className={panelCls}>
              <div className="flex-1 flex flex-col justify-center">
                <div className="mb-5 text-center">
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Welcome Back</h1>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Sign in to access your LeadOps dashboard</p>
                </div>

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
                        className="cursor-pointer text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition"
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
                    <a href="#" className="font-medium text-rose-500 hover:text-rose-600 transition">Forgot Password?</a>
                  </div>

                  {loginError && (
                    <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600 dark:bg-red-950/40 dark:border-red-800 dark:text-red-400">{loginError}</p>
                  )}

                  <Button type="submit" variant="gradient" loading={loginLoading} className="mt-0.5 py-2.5">
                    Sign In
                  </Button>
                </form>

                <div className="my-3 flex items-center gap-3">
                  <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                  <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">Or Continue With</span>
                  <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                </div>

                <Button variant="outline" type="button">
                  <span className="flex items-center justify-center gap-2">
                    <svg className="h-4 w-4" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                    Google
                  </span>
                </Button>

                <p className="mt-4 text-center text-sm text-gray-500 dark:text-gray-400">
                  Don't have an account?{' '}
                  <button type="button" onClick={() => setIsFlipped(true)}
                    className="font-semibold text-rose-500 hover:text-rose-600 transition cursor-pointer">
                    Sign up
                  </button>
                </p>
              </div>
            </div>
          </div>

          {/* ══ BACK — Signup ══════════════════════════════════════════════════ */}
          <div className={`${cardCls} [transform:rotateY(180deg)]`}>

            <div className={panelCls}>
              <div className="flex-1 flex flex-col justify-center">
                <div className="mb-5 text-center">
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Create Account</h1>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Start your journey with LeadOps</p>
                </div>

                <form onSubmit={handleSignup} noValidate className="flex flex-col gap-3">

                  {/* Email + Send OTP */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-gray-600 dark:text-gray-400">Email</label>
                    <div className="relative flex gap-2 items-start">
                      <div className="flex-1">
                        <Input
                          id="signup-email"
                          label=""
                          type="email"
                          placeholder="you@example.com"
                          autoComplete="email"
                          value={signupForm.email}
                          onChange={updateSignup('email')}
                          error={signupErrors.email}
                          leftIcon={<MailIcon />}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={otpVerified ? undefined : handleSendOtp}
                        disabled={otpLoading || otpVerified}
                        className={`mt-0 h-[42px] px-3.5 rounded-xl text-xs font-semibold border transition whitespace-nowrap
                          ${otpVerified
                            ? 'bg-green-50 text-green-600 border-green-200 cursor-default dark:bg-green-950/40 dark:text-green-400 dark:border-green-800'
                            : 'bg-orange-50 text-orange-500 border-orange-200 hover:bg-orange-100 disabled:opacity-50 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-800 dark:hover:bg-orange-900/40'}`}
                      >
                        {otpLoading ? '…' : otpVerified ? '✓ Verified' : 'Send OTP'}
                      </button>

                      {/* OTP Popover */}
                      {showOtpPopover && (
                        <div className="absolute right-0 top-full mt-2 z-50 w-64 rounded-2xl border border-gray-100 bg-white p-4 shadow-2xl dark:border-gray-700 dark:bg-gray-800">
                          {/* caret */}
                          <div className="absolute -top-1.75 right-10 h-3.5 w-3.5 rotate-45 border-l border-t border-gray-100 bg-white dark:border-gray-700 dark:bg-gray-800" />

                          <div className="mb-1 flex items-center justify-between">
                            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Enter OTP</p>
                            <button
                              type="button"
                              onClick={() => setShowOtpPopover(false)}
                              className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition text-base leading-none"
                              aria-label="Close"
                            >✕</button>
                          </div>
                          <p className="mb-3 text-xs text-gray-400 dark:text-gray-500 truncate">Code sent to {signupForm.email}</p>

                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            placeholder="000000"
                            value={signupForm.otp}
                            onChange={e => {
                              const v = e.target.value.replace(/\D/g, '')
                              setSignupForm(prev => ({ ...prev, otp: v }))
                              if (signupErrors.otp) setSignupErrors(prev => ({ ...prev, otp: undefined }))
                            }}
                            className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 text-center text-xl tracking-[0.4em] text-gray-900 outline-none transition focus:border-transparent focus:ring-2 focus:ring-orange-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                            autoFocus
                          />
                          {signupErrors.otp && (
                            <p className="mt-1 text-xs text-red-500 dark:text-red-400">{signupErrors.otp}</p>
                          )}
                          <button
                            type="button"
                            onClick={handleVerifyOtp}
                            disabled={otpLoading || signupForm.otp.length < 6}
                            className="mt-3 w-full rounded-xl bg-linear-to-r from-rose-400 to-orange-400 py-2 text-sm font-semibold text-white transition hover:from-rose-500 hover:to-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {otpLoading ? 'Verifying…' : 'Verify OTP'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Password */}
                  <Input
                    id="signup-password"
                    label="Password"
                    type={showSignupPw ? 'text' : 'password'}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    value={signupForm.password}
                    onChange={updateSignup('password')}
                    error={signupErrors.password}
                    leftIcon={<LockIcon />}
                    rightIcon={
                      <button type="button" onClick={() => setShowSignupPw(v => !v)}
                        className="cursor-pointer text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition">
                        <EyeIcon open={showSignupPw} />
                      </button>
                    }
                  />

                  {/* Confirm password */}
                  <Input
                    id="confirm-password"
                    label="Confirm Password"
                    type={showConfirmPw ? 'text' : 'password'}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    value={signupForm.confirmPassword}
                    onChange={updateSignup('confirmPassword')}
                    error={signupErrors.confirmPassword}
                    leftIcon={<LockIcon />}
                    rightIcon={
                      <button type="button" onClick={() => setShowConfirmPw(v => !v)}
                        className="cursor-pointer text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition">
                        <EyeIcon open={showConfirmPw} />
                      </button>
                    }
                  />

                  {signupError && (
                    <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600 dark:bg-red-950/40 dark:border-red-800 dark:text-red-400">{signupError}</p>
                  )}

                  <Button type="submit" variant="gradient" loading={signupLoading} className="mt-0.5 py-2.5">
                    Create Account
                  </Button>
                </form>

                <p className="mt-4 text-center text-sm text-gray-500 dark:text-gray-400">
                  Already have an account?{' '}
                  <button type="button" onClick={() => setIsFlipped(false)}
                    className="font-semibold text-rose-500 hover:text-rose-600 transition cursor-pointer">
                    Sign in
                  </button>
                </p>
              </div>
            </div>

            <ImagePanel />
          </div>

        </div>
      </div>
    </div>
  )
}

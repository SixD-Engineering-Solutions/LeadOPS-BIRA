import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { z } from 'zod'
import { prisma } from '../prisma'
import { signAccessToken, signResetToken, verifyResetToken } from '../utils/jwt'
import { sendOtpEmail } from '../services/email'
import { authenticate, AuthRequest } from '../middleware/authenticate'
import { sendError } from '../utils/errors'
import { loginLimiter, microsoftLoginLimiter, verifyOtpLimiter, sendOtpPerEmailLimiter, sendOtpPerIpLimiter, resetPasswordLimiter } from '../utils/rateLimits'
import { microsoftConfig, microsoftEnabled, verifyMicrosoftIdToken } from '../utils/microsoft'

const router = Router()

// There's no self sign-up: an admin adds every person on the Team page first.
// Once Microsoft sign-in is configured it's the only way in. ADMIN_PASSWORD_LOGIN
// ="true" is the emergency switch: it brings back password sign-in (and
// password reset) for admins only, e.g. if Microsoft sign-in is misconfigured.
const MICROSOFT_ONLY = 'Please use "Sign in with Microsoft".'
const adminPasswordLogin = process.env.ADMIN_PASSWORD_LOGIN === 'true'
const passwordLogin: 'everyone' | 'admins' | 'off' = !microsoftEnabled ? 'everyone' : adminPasswordLogin ? 'admins' : 'off'
const passwordAllowed = (role: string) => passwordLogin === 'everyone' || (passwordLogin === 'admins' && role === 'admin')

const authResponse = (user: { id: string; email: string; role: string }) => ({
  accessToken: signAccessToken(user.id),
  user: { id: user.id, email: user.email, role: user.role },
})

// GET /auth/config — what the login page should offer. The Microsoft ids are
// public (they're visible in every sign-in URL), so serving them here keeps
// them in one place instead of baking them into the client build.
router.get('/config', (_req: Request, res: Response): void => {
  res.json({ microsoft: microsoftConfig, passwordLogin })
})

// POST /auth/microsoft — exchanges a Microsoft ID token for a LeadOps session.
router.post('/microsoft', microsoftLoginLimiter, async (req: Request, res: Response): Promise<void> => {
  if (!microsoftEnabled) {
    sendError(res, 404, 'Microsoft sign-in is not set up yet.')
    return
  }
  const parse = z.object({ idToken: z.string().min(1) }).safeParse(req.body)
  if (!parse.success) {
    sendError(res, 400, 'idToken is required.')
    return
  }

  let identity
  try {
    identity = await verifyMicrosoftIdToken(parse.data.idToken)
  } catch (err) {
    console.error('Microsoft sign-in rejected:', err instanceof Error ? err.message : err)
    sendError(res, 401, 'Microsoft sign-in could not be verified. Please try again.')
    return
  }

  // Linked before → match on the permanent Microsoft id. First time → find the
  // person an admin added by email, and link them.
  let user = await prisma.user.findUnique({ where: { microsoftOid: identity.oid } })
  if (!user && identity.email) {
    const byEmail = await prisma.user.findFirst({ where: { email: { equals: identity.email, mode: 'insensitive' } } })
    if (byEmail?.microsoftOid) {
      // Their LeadOps account is tied to a different Microsoft account (e.g. it
      // was deleted and recreated in Microsoft 365). Re-saving the email on the
      // Team page clears the old link.
      sendError(res, 403, `The LeadOps account for ${identity.email} is linked to a different Microsoft account. Ask an admin to re-save your email on the Team page.`)
      return
    }
    if (byEmail) {
      user = await prisma.user.update({ where: { id: byEmail.id }, data: { microsoftOid: identity.oid } })
    }
  }

  if (!user) {
    sendError(res, 403, `${identity.email ?? 'This Microsoft account'} doesn't have LeadOps access yet. Ask an admin to add you on the Team page.`)
    return
  }
  if (!user.isActive) {
    sendError(res, 403, 'This account has been removed.')
    return
  }

  res.json(authResponse(user))
})

// Invalidates any outstanding code for the email, stores a fresh hashed one
// (10 min life) and emails it. Throws if the email can't be sent.
async function issueOtp(email: string): Promise<void> {
  const otp = crypto.randomInt(100000, 999999).toString()
  const otpHash = await bcrypt.hash(otp, 10)

  await prisma.otpToken.updateMany({ where: { email, used: false }, data: { used: true } })
  await prisma.otpToken.create({
    data: { email, otpHash, expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
  })

  await sendOtpEmail(email, otp)
}

// POST /auth/forgot-password — emails a reset code to a registered, active
// account that's allowed to use a password.
router.post('/forgot-password', sendOtpPerIpLimiter, sendOtpPerEmailLimiter, async (req: Request, res: Response): Promise<void> => {
  const parse = z.object({ email: z.string().email() }).safeParse(req.body)
  if (!parse.success) {
    sendError(res, 400, 'Invalid email address.')
    return
  }
  const { email } = parse.data

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user || !user.isActive) {
    sendError(res, 404, 'No account found with this email.')
    return
  }
  if (!passwordAllowed(user.role)) {
    sendError(res, 403, MICROSOFT_ONLY)
    return
  }

  try {
    await issueOtp(email)
  } catch (err) {
    console.error('Failed to send password reset email:', err)
    sendError(res, 502, 'Could not send the reset email. Please try again later.')
    return
  }

  res.json({ message: 'Reset code sent to your email.' })
})

// POST /auth/verify-otp — checks a reset code and returns a short-lived reset token.
router.post('/verify-otp', verifyOtpLimiter, async (req: Request, res: Response): Promise<void> => {
  const parse = z.object({ email: z.string().email(), otp: z.string().length(6) }).safeParse(req.body)
  if (!parse.success) {
    sendError(res, 400, 'Email and 6-digit OTP are required.')
    return
  }
  const { email, otp } = parse.data

  const record = await prisma.otpToken.findFirst({
    where: { email, used: false },
    orderBy: { createdAt: 'desc' },
  })

  if (!record || record.expiresAt < new Date()) {
    sendError(res, 400, 'OTP expired or not found. Please request a new one.')
    return
  }

  const valid = await bcrypt.compare(otp, record.otpHash)
  if (!valid) {
    sendError(res, 400, 'Incorrect OTP.')
    return
  }

  await prisma.otpToken.update({ where: { id: record.id }, data: { used: true } })

  res.json({ resetToken: signResetToken(email) })
})

// POST /auth/reset-password
router.post('/reset-password', resetPasswordLimiter, async (req: Request, res: Response): Promise<void> => {
  const parse = z.object({
    resetToken: z.string(),
    password: z.string().min(6),
  }).safeParse(req.body)
  if (!parse.success) {
    sendError(res, 400, 'resetToken and password (min 6 chars) are required.')
    return
  }

  let email: string
  try {
    email = verifyResetToken(parse.data.resetToken).email
  } catch {
    sendError(res, 400, 'Your reset session expired. Please request a new code.')
    return
  }

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user || !user.isActive) {
    sendError(res, 400, 'Your reset session expired. Please request a new code.')
    return
  }
  if (!passwordAllowed(user.role)) {
    sendError(res, 403, MICROSOFT_ONLY)
    return
  }

  const passwordHash = await bcrypt.hash(parse.data.password, 12)
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } })

  res.json({ message: 'Password updated. You can now sign in.' })
})

// POST /auth/login — email + password.
router.post('/login', loginLimiter, async (req: Request, res: Response): Promise<void> => {
  if (passwordLogin === 'off') {
    sendError(res, 403, MICROSOFT_ONLY)
    return
  }
  const parse = z.object({ email: z.string().email(), password: z.string() }).safeParse(req.body)
  if (!parse.success) {
    sendError(res, 400, 'Email and password are required.')
    return
  }
  const { email, password } = parse.data

  const user = await prisma.user.findUnique({ where: { email } })
  // passwordHash is nullable (admins can add employees before they set a password).
  const match = user?.passwordHash ? await bcrypt.compare(password, user.passwordHash) : false

  if (!user || !match) {
    sendError(res, 401, 'Invalid email or password.')
    return
  }
  if (!user.isActive) {
    sendError(res, 403, 'This account has been removed.')
    return
  }
  if (!passwordAllowed(user.role)) {
    sendError(res, 403, MICROSOFT_ONLY)
    return
  }

  res.json(authResponse(user))
})

// GET /auth/me
router.get('/me', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, email: true, role: true, createdAt: true },
  })
  if (!user) {
    sendError(res, 404, 'User not found.')
    return
  }
  res.json({ user })
})

export default router

import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { z } from 'zod'
import { prisma } from '../prisma'
import { signAccessToken, signEmailVerifiedToken, verifyEmailVerifiedToken } from '../utils/jwt'
import { sendOtpEmail } from '../services/email'
import { authenticate, AuthRequest } from '../middleware/authenticate'
import { sendError } from '../utils/errors'
import { loginLimiter, verifyOtpLimiter, sendOtpPerEmailLimiter, sendOtpPerIpLimiter, signupLimiter } from '../utils/rateLimits'

const router = Router()

// POST /auth/send-otp
router.post('/send-otp', sendOtpPerIpLimiter, sendOtpPerEmailLimiter, async (req: Request, res: Response): Promise<void> => {
  const parse = z.object({ email: z.string().email() }).safeParse(req.body)
  if (!parse.success) {
    sendError(res, 400, 'Invalid email address.')
    return
  }
  const { email } = parse.data

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing && existing.isActive) {
    sendError(res, 409, 'An account with this email already exists.')
    return
  }

  const otp = crypto.randomInt(100000, 999999).toString()
  const otpHash = await bcrypt.hash(otp, 10)

  await prisma.otpToken.updateMany({ where: { email, used: false }, data: { used: true } })
  await prisma.otpToken.create({
    data: { email, otpHash, expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
  })

  try {
    await sendOtpEmail(email, otp)
  } catch (err) {
    console.error('Failed to send OTP email:', err)
    sendError(res, 502, 'Could not send the verification email. Please try again later.')
    return
  }

  res.json({ message: 'OTP sent to your email.' })
})

// POST /auth/verify-otp
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

  const emailVerifiedToken = signEmailVerifiedToken(email)
  res.json({ emailVerifiedToken })
})

// POST /auth/signup
router.post('/signup', signupLimiter, async (req: Request, res: Response): Promise<void> => {
  const parse = z.object({
    emailVerifiedToken: z.string(),
    password: z.string().min(6),
  }).safeParse(req.body)
  if (!parse.success) {
    sendError(res, 400, 'emailVerifiedToken and password (min 6 chars) are required.')
    return
  }

  let email: string
  try {
    email = verifyEmailVerifiedToken(parse.data.emailVerifiedToken).email
  } catch {
    sendError(res, 400, 'Email verification expired. Please start the signup again.')
    return
  }

  const passwordHash = await bcrypt.hash(parse.data.password, 12)

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing && existing.isActive) {
    sendError(res, 409, 'An account with this email already exists.')
    return
  }

  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: { passwordHash, isActive: true } })
    : await prisma.user.create({ data: { email, passwordHash } })

  const accessToken = signAccessToken(user.id)
  res.status(201).json({ accessToken, user: { id: user.id, email: user.email, role: user.role } })
})

// POST /auth/login
router.post('/login', loginLimiter, async (req: Request, res: Response): Promise<void> => {
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

  const accessToken = signAccessToken(user.id)
  res.json({ accessToken, user: { id: user.id, email: user.email, role: user.role } })
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

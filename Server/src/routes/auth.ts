import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { z } from 'zod'
import { prisma } from '../prisma'
import { signAccessToken, signEmailVerifiedToken, verifyEmailVerifiedToken } from '../utils/jwt'
import { sendOtpEmail } from '../services/email'
import { authenticate, AuthRequest } from '../middleware/authenticate'

const router = Router()

// POST /auth/send-otp
router.post('/send-otp', async (req: Request, res: Response): Promise<void> => {
  const parse = z.object({ email: z.string().email() }).safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid email address.' })
    return
  }
  const { email } = parse.data

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists.' })
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
    res.status(502).json({ error: 'Could not send the verification email. Please try again later.' })
    return
  }

  res.json({ message: 'OTP sent to your email.' })
})

// POST /auth/verify-otp
router.post('/verify-otp', async (req: Request, res: Response): Promise<void> => {
  const parse = z.object({ email: z.string().email(), otp: z.string().length(6) }).safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'Email and 6-digit OTP are required.' })
    return
  }
  const { email, otp } = parse.data

  const record = await prisma.otpToken.findFirst({
    where: { email, used: false },
    orderBy: { createdAt: 'desc' },
  })

  if (!record || record.expiresAt < new Date()) {
    res.status(400).json({ error: 'OTP expired or not found. Please request a new one.' })
    return
  }

  const valid = await bcrypt.compare(otp, record.otpHash)
  if (!valid) {
    res.status(400).json({ error: 'Incorrect OTP.' })
    return
  }

  await prisma.otpToken.update({ where: { id: record.id }, data: { used: true } })

  const emailVerifiedToken = signEmailVerifiedToken(email)
  res.json({ emailVerifiedToken })
})

// POST /auth/signup
router.post('/signup', async (req: Request, res: Response): Promise<void> => {
  const parse = z.object({
    emailVerifiedToken: z.string(),
    password: z.string().min(6),
  }).safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'emailVerifiedToken and password (min 6 chars) are required.' })
    return
  }

  let email: string
  try {
    email = verifyEmailVerifiedToken(parse.data.emailVerifiedToken).email
  } catch {
    res.status(400).json({ error: 'Email verification expired. Please start the signup again.' })
    return
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists.' })
    return
  }

  const passwordHash = await bcrypt.hash(parse.data.password, 12)
  const user = await prisma.user.create({ data: { email, passwordHash } })

  const accessToken = signAccessToken(user.id)
  res.status(201).json({ accessToken, user: { id: user.id, email: user.email, role: user.role } })
})

// POST /auth/login
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const parse = z.object({ email: z.string().email(), password: z.string() }).safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'Email and password are required.' })
    return
  }
  const { email, password } = parse.data

  const user = await prisma.user.findUnique({ where: { email } })
  // passwordHash is nullable (admins can add employees before they set a password).
  const match = user?.passwordHash ? await bcrypt.compare(password, user.passwordHash) : false

  if (!user || !match) {
    res.status(401).json({ error: 'Invalid email or password.' })
    return
  }
  if (!user.isActive) {
    res.status(403).json({ error: 'This account has been removed.' })
    return
  }

  const accessToken = signAccessToken(user.id)
  res.json({ accessToken, user: { id: user.id, email: user.email, role: user.role } })
})

// POST /auth/dev-login
// DEV-ONLY: upserts a fixed dev user and returns a real access token so the
// frontend dev bypass can call authenticated endpoints (e.g. /leads). Disabled
// in production. Remove alongside the frontend dev bypass once real auth is used.
router.post('/dev-login', async (_req: Request, res: Response): Promise<void> => {
  if (process.env.NODE_ENV === 'production') {
    res.status(404).json({ error: 'Not found.' })
    return
  }
  const email = 'dev@leadops.local'
  try {
    const passwordHash = await bcrypt.hash('devmode123', 12)
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, passwordHash, userName: 'Dev Admin', role: 'admin' },
    })
    const accessToken = signAccessToken(user.id)
    res.json({ accessToken, user: { id: user.id, email: user.email } })
  } catch (err) {
    console.error('dev-login failed:', err)
    res.status(503).json({ error: 'Database unavailable — cannot issue a dev token yet.' })
  }
})

// GET /auth/me
router.get('/me', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, email: true, role: true, createdAt: true },
  })
  if (!user) {
    res.status(404).json({ error: 'User not found.' })
    return
  }
  res.json({ user })
})

export default router

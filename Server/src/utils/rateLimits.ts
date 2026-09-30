import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit'
import type { Request, Response } from 'express'
import { sendError } from './errors'

// Brute-force / abuse limits for the unauthenticated auth endpoints. In-memory
// counters — fine for the single API instance this app runs as (see
// DEPLOYMENT_CHECKLIST.md). Behind nginx, `trust proxy` (index.ts) makes req.ip
// the real client address rather than the proxy's.

const MIN = 60 * 1000

// Same JSON error shape as every other error in the API.
const tooMany = (message: string): Partial<Options> => ({
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => sendError(res, 429, message),
})

const ipKey = (req: Request) => ipKeyGenerator(req.ip ?? '')
// Per email where the body has one (normalised), else per IP.
const emailKey = (req: Request) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  return email ? `email:${email}` : ipKey(req)
}

/** Password guessing: 10 failed logins per 15 minutes per IP (successes don't count). */
export const loginLimiter = rateLimit({
  windowMs: 15 * MIN,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: ipKey,
  ...tooMany('Too many failed login attempts. Please wait 15 minutes and try again.'),
})

/** Code guessing: 5 wrong guesses per email per 10 minutes — the life of one
 *  code — so no single code can be brute-forced. */
export const verifyOtpLimiter = rateLimit({
  windowMs: 10 * MIN,
  limit: 5,
  skipSuccessfulRequests: true,
  keyGenerator: emailKey,
  ...tooMany('Too many incorrect codes. Please wait 10 minutes and request a new one.'),
})

/** Inbox flooding / email quota: 5 codes per email per hour… */
export const sendOtpPerEmailLimiter = rateLimit({
  windowMs: 60 * MIN,
  limit: 5,
  keyGenerator: emailKey,
  ...tooMany('Too many codes requested for this email. Please try again in an hour.'),
})
/** …and 20 per IP per hour (stops one client cycling through addresses). */
export const sendOtpPerIpLimiter = rateLimit({
  windowMs: 60 * MIN,
  limit: 20,
  keyGenerator: ipKey,
  ...tooMany('Too many verification requests. Please try again in an hour.'),
})

/** Account creation: 10 per IP per hour. */
export const signupLimiter = rateLimit({
  windowMs: 60 * MIN,
  limit: 10,
  keyGenerator: ipKey,
  ...tooMany('Too many sign-up attempts. Please try again in an hour.'),
})

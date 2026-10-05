import jwt from 'jsonwebtoken'

const ACCESS_SECRET = process.env.JWT_SECRET!
const VERIFY_SECRET = process.env.JWT_SECRET! + '_otp_verify'

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, ACCESS_SECRET, {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? '24h') as jwt.SignOptions['expiresIn'],
  })
}

export function verifyAccessToken(token: string): { sub: string } {
  return jwt.verify(token, ACCESS_SECRET) as { sub: string }
}

// Proof that the holder just entered the emailed reset code — good for one
// password change within 15 minutes. The purpose claim keeps any older
// email-verification token (from the removed sign-up flow) from being used.
export function signResetToken(email: string): string {
  return jwt.sign({ email, purpose: 'reset' }, VERIFY_SECRET, { expiresIn: '15m' })
}

export function verifyResetToken(token: string): { email: string } {
  const payload = jwt.verify(token, VERIFY_SECRET) as { email: string; purpose?: string }
  if (payload.purpose !== 'reset') throw new Error('Not a reset token.')
  return { email: payload.email }
}

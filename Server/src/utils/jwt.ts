import jwt from 'jsonwebtoken'

const ACCESS_SECRET = process.env.JWT_SECRET!
const VERIFY_SECRET = process.env.JWT_SECRET! + '_otp_verify'

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, ACCESS_SECRET, {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? '7d') as jwt.SignOptions['expiresIn'],
  })
}

export function verifyAccessToken(token: string): { sub: string } {
  return jwt.verify(token, ACCESS_SECRET) as { sub: string }
}

export function signEmailVerifiedToken(email: string): string {
  return jwt.sign({ email }, VERIFY_SECRET, { expiresIn: '15m' })
}

export function verifyEmailVerifiedToken(token: string): { email: string } {
  return jwt.verify(token, VERIFY_SECRET) as { email: string }
}

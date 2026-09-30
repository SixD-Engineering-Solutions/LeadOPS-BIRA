// Startup check for required configuration. Without this, a missing
// JWT_SECRET didn't stop the server: logins failed at runtime and the
// email-verification secret silently became the guessable "undefined_otp_verify".
// Fails fast instead — the container exits with a clear message and restarts
// until the configuration is fixed.
export function assertRequiredEnv(): void {
  const production = process.env.NODE_ENV === 'production'
  const problems: string[] = []

  if (!process.env.DATABASE_URL) problems.push('DATABASE_URL is not set.')
  const secret = process.env.JWT_SECRET ?? ''
  if (!secret) problems.push('JWT_SECRET is not set.')
  else if (secret.length < 32) problems.push('JWT_SECRET must be at least 32 characters.')
  if (production && !process.env.FRONTEND_URL) problems.push('FRONTEND_URL is not set (the public https:// URL, used for CORS).')

  if (problems.length) {
    console.error(`[config] Refusing to start:\n  - ${problems.join('\n  - ')}`)
    process.exit(1)
  }
}

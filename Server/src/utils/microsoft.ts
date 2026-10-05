import { createRemoteJWKSet, jwtVerify } from 'jose'

// "Sign in with Microsoft" (Microsoft Entra ID, single tenant). Off until
// MS_CLIENT_ID and MS_TENANT_ID are set — until then the app keeps its
// password-only login, so it can be deployed before the Azure app exists.

const CLIENT_ID = process.env.MS_CLIENT_ID?.trim() || ''
const TENANT_ID = process.env.MS_TENANT_ID?.trim() || ''

export const microsoftConfig = CLIENT_ID && TENANT_ID ? { clientId: CLIENT_ID, tenantId: TENANT_ID } : null
export const microsoftEnabled = microsoftConfig !== null

// Microsoft's signing keys, fetched once and cached (jose refreshes them when
// Microsoft rotates keys).
const jwks = microsoftConfig
  ? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`))
  : null

export type MicrosoftIdentity = { oid: string; email: string | null; name: string | null }

/**
 * Verifies an ID token from the browser's Microsoft sign-in: signed by
 * Microsoft, issued to this app, by our own tenant (so only company accounts
 * get through). Throws on anything else.
 */
export async function verifyMicrosoftIdToken(idToken: string): Promise<MicrosoftIdentity> {
  if (!microsoftConfig || !jwks) throw new Error('Microsoft sign-in is not configured.')
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: `https://login.microsoftonline.com/${microsoftConfig.tenantId}/v2.0`,
    audience: microsoftConfig.clientId,
    // Allow for this server's clock drifting from Microsoft's (same 5-minute
    // allowance Microsoft's own libraries use) — otherwise a token can look
    // "not yet valid" or "expired" by a few seconds.
    clockTolerance: '5 minutes',
  })
  if (payload.tid !== microsoftConfig.tenantId) throw new Error('Token is from another organisation.')
  if (typeof payload.oid !== 'string' || !payload.oid) throw new Error('Token has no user id.')

  // `email` is the optional claim added in the app registration; for work
  // accounts `preferred_username` is the sign-in address and usually the same.
  const raw = typeof payload.email === 'string' ? payload.email
    : typeof payload.preferred_username === 'string' ? payload.preferred_username
      : null
  const email = raw && /\S+@\S+\.\S+/.test(raw) ? raw.trim().toLowerCase() : null
  return { oid: payload.oid, email, name: typeof payload.name === 'string' ? payload.name : null }
}

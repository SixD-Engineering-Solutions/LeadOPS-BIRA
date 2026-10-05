import { createRemoteJWKSet, jwtVerify } from 'jose'

// "Sign in with Microsoft" (Microsoft Entra ID). Off until MS_CLIENT_ID and
// MS_TENANT_ID are set — until then the app keeps its password-only login, so
// it can be deployed before the Azure app exists.
//
// MS_TENANT_ID is the organisation the app is registered in. To also let in
// people from other organisations of the same company (e.g. a second email
// domain with its own Microsoft 365), list every allowed organisation in
// MS_ALLOWED_TENANT_IDS (comma-separated, including MS_TENANT_ID); the Azure
// app must then accept "Accounts in any organizational directory". Accounts
// from any organisation not listed are always refused.

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CLIENT_ID = process.env.MS_CLIENT_ID?.trim() || ''
const TENANT_ID = process.env.MS_TENANT_ID?.trim().toLowerCase() || ''
const ALLOWED_TENANTS = [...new Set([
  TENANT_ID,
  ...(process.env.MS_ALLOWED_TENANT_IDS ?? '').split(',').map(t => t.trim().toLowerCase()),
])].filter(t => GUID.test(t))

const enabled = Boolean(CLIENT_ID && TENANT_ID)
const multiTenant = ALLOWED_TENANTS.length > 1

/** What the browser needs to start a Microsoft sign-in. One organisation →
 *  its own sign-in page; several → Microsoft's "work or school account" page
 *  (`organizations`), with the server then enforcing the allowed list. */
export const microsoftConfig = enabled
  ? { clientId: CLIENT_ID, tenantId: multiTenant ? 'organizations' : TENANT_ID }
  : null
export const microsoftEnabled = enabled

// Microsoft's signing keys, fetched once and cached (jose refreshes them when
// Microsoft rotates keys). The `common` set covers tokens from every
// organisation; a single-organisation setup uses that organisation's set.
const jwks = enabled
  ? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${multiTenant ? 'common' : TENANT_ID}/discovery/v2.0/keys`))
  : null

export type MicrosoftIdentity = { oid: string; email: string | null; name: string | null }

/** Thrown for a genuine Microsoft account from an organisation that isn't allowed. */
export class OrganisationNotAllowed extends Error {}

/**
 * Verifies an ID token from the browser's Microsoft sign-in: signed by
 * Microsoft, issued to this app, still valid, and from one of the allowed
 * organisations (issuer and `tid` must both match it). Throws on anything else.
 */
export async function verifyMicrosoftIdToken(idToken: string): Promise<MicrosoftIdentity> {
  if (!enabled || !jwks) throw new Error('Microsoft sign-in is not configured.')
  const { payload } = await jwtVerify(idToken, jwks, {
    audience: CLIENT_ID,
    // Allow for this server's clock drifting from Microsoft's (same 5-minute
    // allowance Microsoft's own libraries use) — otherwise a token can look
    // "not yet valid" or "expired" by a few seconds.
    clockTolerance: '5 minutes',
  })

  const tid = typeof payload.tid === 'string' ? payload.tid.toLowerCase() : ''
  if (payload.iss !== `https://login.microsoftonline.com/${tid}/v2.0`) throw new Error('Token issuer does not match its organisation.')
  if (!ALLOWED_TENANTS.includes(tid)) throw new OrganisationNotAllowed(`Organisation ${tid} is not allowed.`)
  if (typeof payload.oid !== 'string' || !payload.oid) throw new Error('Token has no user id.')

  // `email` is the optional claim added in the app registration; for work
  // accounts `preferred_username` is the sign-in address and usually the same.
  const raw = typeof payload.email === 'string' ? payload.email
    : typeof payload.preferred_username === 'string' ? payload.preferred_username
      : null
  const email = raw && /\S+@\S+\.\S+/.test(raw) ? raw.trim().toLowerCase() : null
  return { oid: payload.oid, email, name: typeof payload.name === 'string' ? payload.name : null }
}

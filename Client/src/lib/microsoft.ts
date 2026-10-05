import { createStandardPublicClientApplication } from '@azure/msal-browser'
import type { IPublicClientApplication } from '@azure/msal-browser'

// "Sign in with Microsoft" — full-page redirect to Microsoft's account picker
// and back to this app's root URL, where the result is picked up. Redirect
// rather than a popup: nothing for a popup blocker to stop, and the root URL
// is exactly the redirect URI registered in Azure.

export type MicrosoftConfig = { clientId: string; tenantId: string }

let instance: Promise<IPublicClientApplication> | null = null
let redirectIdToken: Promise<string | null> | null = null

function msal(config: MicrosoftConfig): Promise<IPublicClientApplication> {
  instance ??= createStandardPublicClientApplication({
    auth: {
      clientId: config.clientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`,
      redirectUri: window.location.origin,
    },
    cache: { cacheLocation: 'sessionStorage' },
  })
  return instance
}

/**
 * The Microsoft ID token if this page load is the return from a Microsoft
 * sign-in, else null. Memoised, so React's double-run of effects in
 * development doesn't process the same response twice.
 */
export function microsoftRedirectIdToken(config: MicrosoftConfig): Promise<string | null> {
  redirectIdToken ??= msal(config)
    .then(app => app.handleRedirectPromise())
    .then(result => result?.idToken || null)
  return redirectIdToken
}

/** Sends the browser to Microsoft's account picker. Doesn't return. */
export async function startMicrosoftSignIn(config: MicrosoftConfig): Promise<void> {
  const app = await msal(config)
  await app.loginRedirect({ scopes: ['openid', 'profile', 'email'], prompt: 'select_account' })
}

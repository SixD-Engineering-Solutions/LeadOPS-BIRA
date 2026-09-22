// These are integration tests, not unit tests: they make real HTTP requests
// against a real running server (see helpers.ts's BASE_URL) backed by the
// real database, exactly like every manual verification pass this project's
// hardening work went through. `index.ts` calls `app.listen()` directly with
// no exported `app`, so there's no in-process way to hit the routes — the dev
// server (`npm run dev`) needs to already be running before `npm test`.
//
// This fails fast with a clear message instead of letting every test time out
// on a connection refused.
export default async function globalSetup() {
  const baseUrl = process.env.TEST_BASE_URL ?? 'http://localhost:3000'
  try {
    const res = await fetch(`${baseUrl}/health`)
    if (!res.ok) throw new Error(`unexpected status ${res.status}`)
  } catch {
    throw new Error(
      `\n\nCannot reach ${baseUrl}/health — these are integration tests that need the dev server running.\n` +
      `Start it first (npm run dev), then run the tests again.\n`
    )
  }
}

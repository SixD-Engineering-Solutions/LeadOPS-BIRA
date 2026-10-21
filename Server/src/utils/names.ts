// The key two names share when they're the same thing written differently:
// "Oil & Gas", "oil and gas", " OIL  AND GAS " → "oilandgas". The client
// uses the same rule (Client/src/lib/names.ts) to suggest existing values;
// the server uses it so a lead can never create a second copy of one.
export const sameNameKey = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '')

/** The active row whose name is `name` written any way, if there is one. */
export function findSameName<T>(rows: T[], nameOf: (row: T) => string, name: string): T | undefined {
  const key = sameNameKey(name)
  return key ? rows.find(r => sameNameKey(nameOf(r)) === key) : undefined
}

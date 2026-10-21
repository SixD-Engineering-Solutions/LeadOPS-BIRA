// The key two names share when they're the same thing written differently:
// "Oil & Gas", "oil and gas", " OIL  AND GAS " → "oilandgas". Used to stop
// a form creating a second copy of an existing sector / vertical / source.
export const sameNameKey = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '')

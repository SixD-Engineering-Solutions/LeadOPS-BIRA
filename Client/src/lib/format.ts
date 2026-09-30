// Number formatting shared across the app — always Indian digit grouping
// (5,00,000) regardless of the browser's locale. Display only: stored values
// and form inputs are untouched.

const IN = 'en-IN'

/** Plain count, e.g. 1,23,456. */
export const formatCount = (n: number) => n.toLocaleString(IN)

/** Full rupee amount, e.g. ₹5,00,000 or ₹12,345.5. */
export const formatINR = (v: number) => `₹${v.toLocaleString(IN, { maximumFractionDigits: 2 })}`

/** Short rupee amount for tiles, e.g. ₹5.25 L / ₹2.8 Cr — pair with a
 *  `title={formatINR(v)}` so the exact figure is still available on hover. */
export function formatINRCompact(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1e7) return `₹${(v / 1e7).toLocaleString(IN, { maximumFractionDigits: 2 })} Cr`
  if (abs >= 1e5) return `₹${(v / 1e5).toLocaleString(IN, { maximumFractionDigits: 2 })} L`
  return formatINR(v)
}

/** A value already stored in lakhs (the tracker sheet's unit), e.g. ₹12.5L. */
export const formatLakhs = (v: number) => `₹${v.toLocaleString(IN, { maximumFractionDigits: 2 })}L`

const isInr = (currency: string | null | undefined) => !currency?.trim() || currency.trim().toUpperCase() === 'INR'

/** A tracker sheet value: lakhs for INR rows, but a plain amount for
 *  foreign-currency rows (e.g. USD 277,800) — the sheet stores both in the
 *  same column. */
export function formatSheetValue(v: number, currency: string | null | undefined): string {
  return isInr(currency) ? formatLakhs(v) : `${currency!.trim().toUpperCase()} ${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}
export { isInr as isInrCurrency }

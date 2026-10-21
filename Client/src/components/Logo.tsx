import { useId } from 'react'

// The LeadOps mark: an "L" whose foot turns into a rising arrow — a lead
// carried through to a result — on the brand gradient. Same drawing as
// public/favicon.svg.
export function LogoMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  const id = `logo-${useId().replace(/:/g, '')}`
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={`shrink-0 ${className}`} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fb7185" />
          <stop offset="1" stopColor="#fb923c" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${id})`} />
      <path d="M19 14h8v28h7v8H19z" fill="#fff" />
      <path d="M33 42l12-12" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
      <path d="M37 25h11v11" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

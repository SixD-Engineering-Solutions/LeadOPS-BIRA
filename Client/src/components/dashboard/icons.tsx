// Inline, stroke-based icon set shared across the dashboard shell (sidebar,
// header, module cards) — kept together since they're all drawn the same way.

type IconProps = { className?: string }
export const Icon = ({ d, className = 'h-5 w-5' }: { d: string } & IconProps) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
)



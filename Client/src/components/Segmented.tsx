// The app's one switch between a few options — Tracker sections, Overview /
// Comparisons, Quarters / Months, Grouped / Exact. `lg` is a page's own
// sections (the Tracker tabs), `md` sits above a section, `sm` inside a card.
const SIZES = {
  sm: { frame: 'rounded-lg p-0.5', item: 'rounded-md px-2.5 py-1 text-[11px]', on: 'bg-orange-500 text-white' },
  md: { frame: 'rounded-lg p-0.5', item: 'rounded-md px-3.5 py-1.5 text-xs', on: 'bg-orange-500 text-white' },
  lg: { frame: 'rounded-xl p-1', item: 'rounded-lg px-4 py-1.5 text-sm', on: 'bg-gradient-to-r from-rose-400 to-orange-400 text-white' },
} as const

export default function Segmented<T extends string>({ options, value, onChange, label, size = 'sm' }: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  label: string // accessible name for the group
  size?: keyof typeof SIZES
}) {
  const s = SIZES[size]
  return (
    <div className={`inline-flex max-w-full shrink-0 overflow-x-auto border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-gray-200 bg-white font-semibold dark:border-gray-700 dark:bg-gray-900 ${s.frame}`} role="group" aria-label={label}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`shrink-0 whitespace-nowrap outline-none transition focus-visible:ring-2 focus-visible:ring-orange-300 ${s.item} ${value === o.value
            ? s.on
            : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

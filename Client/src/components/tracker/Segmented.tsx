// A small pill-style toggle between a few options, styled like the Reports
// tab's Grouped / Exact switch.
export default function Segmented<T extends string>({ options, value, onChange, label, size = 'sm' }: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  label: string // accessible name for the group
  size?: 'sm' | 'md'
}) {
  const pad = size === 'md' ? 'px-3.5 py-1.5 text-xs' : 'px-2.5 py-1 text-[11px]'
  return (
    <div className="flex shrink-0 rounded-lg border border-gray-200 bg-white p-0.5 font-semibold dark:border-gray-700 dark:bg-gray-900" role="group" aria-label={label}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`rounded-md transition ${pad} ${value === o.value
            ? 'bg-orange-500 text-white'
            : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

type Variant = 'gradient' | 'outline' | 'default'

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean
  variant?: Variant
}

const variantClasses: Record<Variant, string> = {
  gradient:
    'bg-gradient-to-r from-rose-400 to-orange-400 text-white hover:from-rose-500 hover:to-orange-500 shadow-md shadow-orange-200',
  outline:
    'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 shadow-sm dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700',
  default:
    'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm',
}

export default function Button({
  children,
  loading,
  disabled,
  variant = 'default',
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={`w-full rounded-xl px-4 py-2.5 text-sm font-semibold
        transition active:scale-[0.98]
        disabled:cursor-not-allowed disabled:opacity-60
        focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-300
        ${variantClasses[variant]}
        ${className}`}
      {...props}
    >
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          Signing in…
        </span>
      ) : children}
    </button>
  )
}

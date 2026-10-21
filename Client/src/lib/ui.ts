// The app's one set of buttons. Every button picks a variant and a size from
// here, so the same kind of action looks the same on every page:
//   primary   — the one main action in a place (save, add)
//   secondary — the alternative beside it (cancel, back)
//   ghost     — quiet actions in toolbars and menus
//   danger    — delete / remove / void, and only after a confirmation

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

const BASE = 'inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold outline-none transition disabled:cursor-not-allowed disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-orange-300 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-gradient-to-r from-rose-400 to-orange-400 text-white hover:from-rose-500 hover:to-orange-500',
  secondary: 'border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800',
  ghost: 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100',
  danger: 'bg-rose-600 text-white hover:bg-rose-700',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'px-4 py-1.5 text-xs',
  md: 'px-5 py-2 text-sm',
  lg: 'px-5 py-2.5 text-sm',
}

/** Class names for a button: `className={btn('primary')}`. */
export const btn = (variant: ButtonVariant = 'primary', size: ButtonSize = 'md') => `${BASE} ${VARIANTS[variant]} ${SIZES[size]}`

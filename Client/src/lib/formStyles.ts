// The look of every form control — the same field style the forms already
// use, and the same red the sign-in page uses for a field with a problem.

export const INPUT_CLS = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'

/** Added to a control whose value has a problem (see <Field error>). */
export const INVALID_CLS = '!border-red-400 !bg-red-50 dark:!border-red-700 dark:!bg-red-950/40'

export const inputCls = (invalid = false) => `${INPUT_CLS} ${invalid ? INVALID_CLS : ''}`

export type FieldErrors<K extends string = string> = Partial<Record<K, string>>

/** Focuses (and scrolls to) the first control marked invalid inside `root`. */
export function focusFirstInvalid(root: ParentNode | null = document) {
  requestAnimationFrame(() => {
    const el = root?.querySelector<HTMLElement>('[aria-invalid="true"]')
    el?.focus({ preventScroll: false })
  })
}

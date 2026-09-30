/** For an empty list's "Create …" action: scrolls the page's create form (it
 *  sits above the list on every page) into view and focuses its first field. */
export function focusCreateForm() {
  const form = document.querySelector('main form')
  if (!form) return
  form.scrollIntoView({ behavior: 'smooth', block: 'start' })
  form.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea')?.focus({ preventScroll: true })
}

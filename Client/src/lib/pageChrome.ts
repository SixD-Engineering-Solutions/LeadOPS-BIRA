import { createContext, useContext } from 'react'

// The app's top bar is drawn by the dashboard shell, but what it says belongs
// to the page on screen: its title (and breadcrumb), and its main action (e.g.
// "+ New lead"). The shell exposes two empty slots in the bar through this
// context; a page fills them with <PageHeader> (components/PageHeader).
export type PageChrome = { titleSlot: HTMLElement | null; actionSlot: HTMLElement | null }

export const PageChromeContext = createContext<PageChrome>({ titleSlot: null, actionSlot: null })

export const usePageChrome = () => useContext(PageChromeContext)

/** Every page's outer container — one width rule for the whole app. */
export const PAGE_CLASS = 'mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6'

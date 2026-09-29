// Badge colors for each record type's status, shared by its own page and by
// the Tracker's live-synced Pipeline rows ("<stage>: <status>") so a status
// looks the same wherever it appears.

const GRAY = 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'
const SKY = 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-900/40 dark:text-sky-300 dark:border-sky-800'
const AMBER = 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800'
const ORANGE = 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-800'
const VIOLET = 'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/40 dark:text-violet-300 dark:border-violet-800'
const EMERALD = 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800'
const ROSE = 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/40 dark:text-rose-300 dark:border-rose-800'

export const DEFAULT_STATUS_STYLE = GRAY

export const LEAD_STATUS_STYLES: Record<string, string> = {
  Submitted: SKY,
  'In Process': AMBER,
  Dead: ROSE,
}

export const PROPOSAL_STATUS_STYLES: Record<string, string> = {
  Draft: GRAY,
  Submitted: SKY,
  'Follow-up': AMBER,
  Negotiation: VIOLET,
  Won: EMERALD,
  Lost: ROSE,
  Hold: ORANGE,
}

export const PROJECT_STATUS_STYLES: Record<string, string> = {
  'Not Started': GRAY,
  'In Progress': AMBER,
  'On Hold': ORANGE,
  Completed: EMERALD,
}

export const INVOICE_STATUS_STYLES: Record<string, string> = {
  Draft: GRAY,
  Sent: SKY,
  'Partially Paid': AMBER,
  Paid: EMERALD,
  Overdue: ROSE,
}

const STAGE_STYLES: Record<string, Record<string, string>> = {
  Lead: LEAD_STATUS_STYLES,
  Proposal: PROPOSAL_STATUS_STYLES,
  Project: PROJECT_STATUS_STYLES,
  Invoice: INVOICE_STATUS_STYLES,
}

// "Proposal: Negotiation" → the Proposals page's Negotiation color.
export function stageStatusStyle(value: string | null | undefined): string {
  const [stage, ...rest] = (value ?? '').split(':')
  return STAGE_STYLES[stage.trim()]?.[rest.join(':').trim()] ?? DEFAULT_STATUS_STYLE
}

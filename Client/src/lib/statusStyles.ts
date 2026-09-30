// Badge colors for each record type's status, shared by its own page and by
// the Tracker's live-synced Pipeline rows ("<stage>: <status>") so a status
// looks the same wherever it appears.

const GRAY = 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600'
const SKY = 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-500/20 dark:text-sky-200 dark:border-sky-500/50'
const AMBER = 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/20 dark:text-amber-200 dark:border-amber-500/50'
const ORANGE = 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-500/20 dark:text-orange-200 dark:border-orange-500/50'
const VIOLET = 'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-500/20 dark:text-violet-200 dark:border-violet-500/50'
const EMERALD = 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-200 dark:border-emerald-500/50'
const ROSE = 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/20 dark:text-rose-200 dark:border-rose-500/50'

export const DEFAULT_STATUS_STYLE = GRAY

// The raw palette, for badges that aren't a record status (e.g. a follow-up's
// "Overdue" / "Today", an invoice's "₹… due") but should match the same look.
export const BADGE_TONES = { gray: GRAY, sky: SKY, amber: AMBER, orange: ORANGE, violet: VIOLET, emerald: EMERALD, rose: ROSE } as const

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

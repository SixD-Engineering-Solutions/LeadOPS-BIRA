import type { LeadStatus, ProposalStatus, ProjectStatus, InvoiceStatus } from './api'

// The one place that works out which sales stage a Pipeline tracker row is
// at, from its status text. Sorting (pipelineSort.ts) and the Reports charts
// (trackerReports.ts) both read it, so they always agree.
//
// Two kinds of status text arrive:
//  - rows synced from the app: "<record>: <its status>" (see
//    syncLeadToPipeline on the server) — read from the app's own status lists,
//    and for leads from each status's category, which admins set when they
//    add a status;
//  - rows imported from the sheet: freehand ("✅ PO Received", "🔵 Quoted",
//    "Tender Floated") — read from the wording, best effort.

export type PipelineStage =
  | 'enquiry' | 'tenderFloated' | 'tendering' | 'quoted' | 'negotiation'
  | 'won' | 'executing' | 'invoiced' | 'paid'
  | 'onHold' | 'lost' | 'unknown'

// Typed against the app's status lists, so adding a status there without
// placing it here is a type error rather than a silently mis-sorted row.
const PROPOSAL_STAGE: Record<ProposalStatus, PipelineStage> = {
  Draft: 'quoted', Submitted: 'quoted', 'Follow-up': 'negotiation', Negotiation: 'negotiation',
  Won: 'won', Lost: 'lost', Hold: 'onHold',
}
const PROJECT_STAGE: Record<ProjectStatus, PipelineStage> = {
  'Not Started': 'executing', 'In Progress': 'executing', 'On Hold': 'onHold', Completed: 'invoiced',
}
const INVOICE_STAGE: Record<InvoiceStatus, PipelineStage> = {
  Draft: 'invoiced', Sent: 'invoiced', 'Partially Paid': 'invoiced', Overdue: 'invoiced', Paid: 'paid',
}

// A lead status, by the category admins give it ("Closed Won" / "Closed
// Lost" / anything open). Falls back to the name if the status isn't in the
// list (e.g. it was since deactivated).
function leadStage(name: string, leadStatuses: LeadStatus[]): PipelineStage {
  const status = leadStatuses.find(s => s.statusName.trim().toLowerCase() === name.trim().toLowerCase())
  const text = (status?.statusCategory ?? name).toLowerCase()
  if (/\blost\b|\bdead\b/.test(text)) return 'lost'
  if (/\bwon\b/.test(text)) return 'won'
  if (/\bhold\b/.test(text)) return 'onHold'
  return 'enquiry'
}

function lookup<K extends string>(map: Record<K, PipelineStage>, value: string): PipelineStage | null {
  const key = (Object.keys(map) as K[]).find(k => k.toLowerCase() === value.trim().toLowerCase())
  return key ? map[key] : null
}

function sheetStage(s: string): PipelineStage {
  if (/\blost\b|\bdead\b|^x\s/.test(s)) return 'lost'
  if (/\bhold\b/.test(s)) return 'onHold'
  if (/executing/.test(s)) return 'executing'
  if (s.includes('✅') || /order received|po received/.test(s)) return 'won'
  if (/negotiation|follow-up|po is in|under process|awaiting|value case/.test(s)) return 'negotiation'
  if (/tender floated/.test(s)) return 'tenderFloated' // only just released — nothing quoted yet
  if (/tender|budgetary/.test(s)) return 'tendering' // before "quot", so a budgetary quotation isn't a real quote
  if (/quot|offer|bid/.test(s)) return 'quoted'
  return 'enquiry' // discussion, enquiry, awaiting the client…
}

export function pipelineStageOf(status: string | null, leadStatuses: LeadStatus[] = []): PipelineStage {
  const raw = (status ?? '').trim()
  if (!raw) return 'unknown'
  const app = raw.match(/^(lead|proposal|project|invoice)(?::\s*(.*))?$/i)
  if (app) {
    const value = app[2] ?? ''
    switch (app[1].toLowerCase()) {
      case 'lead': return value ? leadStage(value, leadStatuses) : 'enquiry'
      case 'proposal': return lookup(PROPOSAL_STAGE, value) ?? 'quoted'
      case 'project': return lookup(PROJECT_STAGE, value) ?? 'executing'
      case 'invoice': return lookup(INVOICE_STAGE, value) ?? 'invoiced'
    }
  }
  return sheetStage(raw.toLowerCase())
}

// How far along a stage is, for sorting: 0 (enquiry) → 7 (paid). On hold,
// lost and unknown get ranks that always sort after every active stage.
export const STAGE_ON_HOLD = 100
export const STAGE_LOST = 101
export const STAGE_UNKNOWN = 102
export const STAGE_RANK: Record<PipelineStage, number> = {
  enquiry: 0, tenderFloated: 1, tendering: 1, quoted: 2, negotiation: 3,
  won: 4, executing: 5, invoiced: 6, paid: 7,
  onHold: STAGE_ON_HOLD, lost: STAGE_LOST, unknown: STAGE_UNKNOWN,
}

// The Reports' grouped view: a handful of sales stages, in pipeline order.
export const STATUS_GROUPS = ['Enquiry / Discussion', 'Quoted / Offer Sent', 'Negotiation / Follow-up', 'On Hold', 'Won', 'Lost'] as const
export type StatusGroup = (typeof STATUS_GROUPS)[number]
export const STAGE_GROUP: Record<PipelineStage, StatusGroup> = {
  enquiry: 'Enquiry / Discussion', tenderFloated: 'Enquiry / Discussion', unknown: 'Enquiry / Discussion',
  tendering: 'Quoted / Offer Sent', quoted: 'Quoted / Offer Sent',
  negotiation: 'Negotiation / Follow-up',
  onHold: 'On Hold',
  won: 'Won', executing: 'Won', invoiced: 'Won', paid: 'Won',
  lost: 'Lost',
}

// Pipeline health: won, lost, or still active.
export type Outcome = 'Won' | 'Lost' | 'Active'
export const outcomeOf = (stage: PipelineStage): Outcome =>
  STAGE_GROUP[stage] === 'Won' ? 'Won' : stage === 'lost' ? 'Lost' : 'Active'

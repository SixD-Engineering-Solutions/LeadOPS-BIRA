import { describe, it, expect } from 'vitest'
import { mapSheetStatus, sheetRowKeys, matchUser, projectStatusFor } from '../src/services/sheetLeads'

const users = [
  { id: 'u1', userName: 'Yash Patel', email: 'yash.patel@x.com', role: 'employee' },
  { id: 'u2', userName: 'Vaibhav Tyagi', email: 'vaibhav.tyagi@x.com', role: 'admin' },
  { id: 'u3', userName: 'Suraj Pandey', email: 'suraj.pandey@x.com', role: 'employee' },
  { id: 'u4', userName: 'Nidhi Bharti', email: 'nidhi.bharti@x.com', role: 'employee' },
]

describe('sheet status wording → app statuses', () => {
  it.each([
    ['🔵 Quoted', { lead: 'Qualified', proposal: 'Submitted' }],
    ['🔵 Quoted By this week', { lead: 'Hot', proposal: 'Draft' }],
    ['✅ PO Received', { lead: 'Qualified', proposal: 'Won' }],
    ['Bid Submited', { lead: 'Qualified', proposal: 'Tender submitted' }],
    ['Budgetary Submited', { lead: 'Qualified', proposal: 'Proposal submitted' }],
    ['LOST', { lead: 'Lost', proposal: 'Lost' }],
  ])('%s', (raw, expected) => expect(mapSheetStatus(raw, true)).toEqual(expected))

  it('unknown wording: a cold call, with a draft proposal only when there is a value', () => {
    expect(mapSheetStatus('???', false)).toEqual({ lead: 'Cold call', proposal: null })
    expect(mapSheetStatus(null, true)).toEqual({ lead: 'Cold call', proposal: 'Draft' })
  })
})

describe('sheet row keys', () => {
  it('ignores case and punctuation, and numbers identical rows', () => {
    const row = { client: 'JSPL', location: 'Raigarh', description: 'SOP To VR' }
    expect(sheetRowKeys([row, { ...row, client: 'jspl ', description: 'sop to vr.' }, { ...row, description: 'Other' }]))
      .toEqual(['jspl|raigarh|sop to vr', 'jspl|raigarh|sop to vr#2', 'jspl|raigarh|other'])
  })
})

describe('matching the sheet’s people to users', () => {
  it('uses the first matching name, case-insensitively', () => {
    expect(matchUser('YASH', users)?.id).toBe('u1')
    expect(matchUser('Suraj+Yash', users)?.id).toBe('u3')
    expect(matchUser('Yash/Nidhi/Suraj', users)?.id).toBe('u1')
  })
  it('skips a person who is not allowed (an admin) and falls through to the next', () => {
    const employeesOnly = (u: { role: string }) => u.role !== 'admin'
    expect(matchUser('Vaibhav', users, employeesOnly)).toBeNull()
    expect(matchUser('Yash/Vaibhav', users, employeesOnly)?.id).toBe('u1')
    expect(matchUser('Vaibhav/Nidhi', users, employeesOnly)?.id).toBe('u4')
  })
  it('returns null for blanks and strangers', () => {
    expect(matchUser('', users)).toBeNull()
    expect(matchUser('Someone Else', users)).toBeNull()
  })
})

describe('project status for a won row', () => {
  it('is In Progress unless the sheet says it has not started', () => {
    expect(projectStatusFor('Execute')).toBe('In Progress')
    expect(projectStatusFor('WORKING NOT START')).toBe('Not Started')
  })
})

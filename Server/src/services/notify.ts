import { Response } from 'express'
import { prisma } from '../prisma'

// In-memory SSE registry: one Node process, so a plain Map is enough. A user
// can have multiple open tabs, hence a Set of responses per userId.
const clients = new Map<string, Set<Response>>()

export function subscribe(userId: string, res: Response): void {
  if (!clients.has(userId)) clients.set(userId, new Set())
  clients.get(userId)!.add(res)
}

export function unsubscribe(userId: string, res: Response): void {
  clients.get(userId)?.delete(res)
  if (clients.get(userId)?.size === 0) clients.delete(userId)
}

/** Persist a notification for `userId` and push it live to any open SSE streams. */
export async function notifyUser(userId: string, message: string, leadId?: string | null) {
  const notification = await prisma.notification.create({
    data: { userId, message, leadId: leadId ?? null },
  })
  const sockets = clients.get(userId)
  if (sockets) {
    const payload = `data: ${JSON.stringify(notification)}\n\n`
    for (const res of sockets) res.write(payload)
  }
  return notification
}

/**
 * Ping every connected client (any user, not just one recipient) that a lead
 * changed. Unlike notifyUser this isn't persisted — it's not a personal
 * inbox entry, just a live signal so every open leads list can resync that
 * one lead (create, update, or delete) without the viewer refreshing.
 */
export function broadcastLeadUpdate(leadId: string): void {
  const payload = `event: lead-update\ndata: ${JSON.stringify({ leadId })}\n\n`
  for (const sockets of clients.values()) {
    for (const res of sockets) res.write(payload)
  }
}

/** Same idea as broadcastLeadUpdate, for tasks — lets any open Tasks list resync live. */
export function broadcastTaskUpdate(taskId: string): void {
  const payload = `event: task-update\ndata: ${JSON.stringify({ taskId })}\n\n`
  for (const sockets of clients.values()) {
    for (const res of sockets) res.write(payload)
  }
}

/** Same idea as broadcastLeadUpdate, for activities — lets an open lead's timeline/follow-ups resync live. */
export function broadcastActivityUpdate(leadId: string): void {
  const payload = `event: activity-update\ndata: ${JSON.stringify({ leadId })}\n\n`
  for (const sockets of clients.values()) {
    for (const res of sockets) res.write(payload)
  }
}

/** Same idea as broadcastLeadUpdate, for proposals — lets any open Proposals list/lead modal resync live. */
export function broadcastProposalUpdate(proposalId: string): void {
  const payload = `event: proposal-update\ndata: ${JSON.stringify({ proposalId })}\n\n`
  for (const sockets of clients.values()) {
    for (const res of sockets) res.write(payload)
  }
}

/** Same idea as broadcastLeadUpdate, for projects — lets any open Projects list resync live. */
export function broadcastProjectUpdate(projectId: string): void {
  const payload = `event: project-update\ndata: ${JSON.stringify({ projectId })}\n\n`
  for (const sockets of clients.values()) {
    for (const res of sockets) res.write(payload)
  }
}

/** Same idea as broadcastLeadUpdate, for invoices — lets any open Invoices list resync live. */
export function broadcastInvoiceUpdate(invoiceId: string): void {
  const payload = `event: invoice-update\ndata: ${JSON.stringify({ invoiceId })}\n\n`
  for (const sockets of clients.values()) {
    for (const res of sockets) res.write(payload)
  }
}

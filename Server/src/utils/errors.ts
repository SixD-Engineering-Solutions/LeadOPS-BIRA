import { Response } from 'express'

// One stable, machine-readable code per HTTP status used for error responses
// in this app — lets the client branch on `code` instead of parsing the
// human-readable `error` message, without needing a distinct code per
// endpoint (100+ call sites across the routes only ever use these 7 statuses).
const CODES: Record<number, string> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  500: 'INTERNAL_ERROR',
  502: 'UPSTREAM_ERROR',
  503: 'SERVICE_UNAVAILABLE',
}

export function codeForStatus(status: number): string {
  return CODES[status] ?? 'ERROR'
}

export function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message, code: codeForStatus(status) })
}

import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import authRoutes from './routes/auth'
import leadRoutes from './routes/leads'
import taskRoutes from './routes/tasks'
import activityRoutes from './routes/activities'
import proposalRoutes from './routes/proposals'
import projectRoutes from './routes/projects'
import documentRoutes from './routes/documents'
import invoiceRoutes from './routes/invoices'
import eventRoutes from './routes/events'
import referenceRoutes from './routes/reference'
import notificationRoutes from './routes/notifications'
import trackerRoutes from './routes/tracker'
import { startFollowUpReminderJob } from './services/reminders'
import { sendError } from './utils/errors'
import { resyncAllLeadsToPipeline } from './utils/pipelineSync'
import { assertRequiredEnv } from './utils/env'

assertRequiredEnv()

// Safety nets: keep the server alive through transient failures (e.g. the DB
// briefly dropping) instead of the process dying and restarting repeatedly.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason instanceof Error ? reason.message : reason)
})
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message)
})

const app = express()
const PORT = process.env.PORT ?? 3000
// In production the API sits behind one proxy hop (the web container's nginx),
// so req.ip — used by the login/sign-up rate limits — must come from
// X-Forwarded-For, or every client would share nginx's address. Not trusted
// in development, where there's no proxy and the header could be spoofed.
app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false)

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173'
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true) // non-browser clients (curl, server-to-server)
    if (origin === FRONTEND_URL) return cb(null, true)
    // In development, allow any localhost port (Vite may pick 5174/5175 if 5173 is busy).
    if (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true)
    return cb(new Error('Not allowed by CORS'))
  },
  credentials: true,
}))
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/auth', authRoutes)
app.use('/leads', leadRoutes)
app.use('/tasks', taskRoutes)
app.use('/activities', activityRoutes)
app.use('/proposals', proposalRoutes)
app.use('/projects', projectRoutes)
app.use('/documents', documentRoutes)
app.use('/invoices', invoiceRoutes)
app.use('/events', eventRoutes)
app.use('/notifications', notificationRoutes)
app.use('/tracker', trackerRoutes)
app.use('/', referenceRoutes)

// Unmatched route — same JSON error shape as every other 404 in the app,
// instead of Express's default HTML page.
app.use((_req, res) => {
  sendError(res, 404, 'Not found.')
})

// Last-resort handler: catches anything a route didn't handle itself,
// including Express 5's auto-forwarded async rejections. Without this,
// an uncaught error would fall through to Express's default handler and
// leak a stack trace as an HTML response instead of this app's JSON shape.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // A browser request from a site other than FRONTEND_URL — an expected
  // refusal, not a server fault: answer 403 without a stack trace in the logs.
  if (err instanceof Error && err.message === 'Not allowed by CORS') {
    if (!res.headersSent) sendError(res, 403, 'Requests from this origin are not allowed.')
    return
  }
  console.error('[unhandled route error]', err instanceof Error ? err.stack ?? err.message : err)
  if (res.headersSent) {
    return
  }
  sendError(res, 500, 'Something went wrong. Please try again.')
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  startFollowUpReminderJob()
  resyncAllLeadsToPipeline()
    .then(n => console.log(`Pipeline tracker: re-synced ${n} lead(s)`))
    .catch(err => console.error('Pipeline tracker resync failed:', err instanceof Error ? err.message : err))
})

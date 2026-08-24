import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import authRoutes from './routes/auth'
import leadRoutes from './routes/leads'
import taskRoutes from './routes/tasks'
import referenceRoutes from './routes/reference'
import notificationRoutes from './routes/notifications'

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
app.use('/notifications', notificationRoutes)
app.use('/', referenceRoutes)

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})

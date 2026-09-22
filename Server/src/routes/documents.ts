import fs from 'fs'
import path from 'path'
import { Router, Response } from 'express'
import multer from 'multer'
import bcrypt from 'bcryptjs'
import { prisma } from '../prisma'
import { authenticate, requireAdmin, AuthRequest } from '../middleware/authenticate'

const router = Router()
router.use(authenticate)

// PDF, Excel, and CSV only, capped at 10MB — this runs on a local disk with no
// CDN in front of it, so a small ceiling keeps a bad upload from eating disk/RAM.
const MAX_FILE_SIZE = 10 * 1024 * 1024

// Browsers/OSes report inconsistent mimetypes for Excel/CSV (e.g. a .csv can
// arrive as text/csv, application/vnd.ms-excel, or even text/plain), so the
// extension on the original filename is the reliable signal — mimetype is
// only used as a fallback when the extension is missing.
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.xlsx', '.xls', '.csv'])
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls, and how some browsers report .csv
  'text/csv',
  'application/csv',
  'text/plain', // some browsers report .csv this way
])

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'documents')
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

// Storage name is derived from a bcrypt hash of a per-upload random value, so
// it can't be predicted or guessed from the download URL — never the
// original filename, which is kept separately (in the DB) for display only.
// The real extension is preserved so a later download gets the right
// Content-Type (res.download infers it from the file on disk).
function storedNameFor(ext: string): string {
  const raw = `${Date.now()}-${Math.random()}`
  const hash = bcrypt.hashSync(raw, bcrypt.genSaltSync(10))
  return `${hash.replace(/[^a-zA-Z0-9]/g, '')}${ext}`
}

function allowedExtension(originalname: string): string | null {
  const ext = path.extname(originalname).toLowerCase()
  return ALLOWED_EXTENSIONS.has(ext) ? ext : null
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, storedNameFor(allowedExtension(file.originalname) ?? '')),
})

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const extOk = allowedExtension(file.originalname) !== null
    if (!extOk && !ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new Error('Only PDF, Excel (.xlsx/.xls), or CSV files are accepted.'))
      return
    }
    cb(null, true)
  },
})

const documentSelect = {
  id: true,
  leadId: true,
  fileName: true,
  fileSize: true,
  createdAt: true,
  uploadedByUser: { select: { id: true, userName: true, email: true } },
} as const

async function isAdmin(userId: string | undefined): Promise<boolean> {
  if (!userId) return false
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  return user?.role === 'admin'
}
async function canAccessLead(leadId: string, userId: string | undefined, admin: boolean) {
  return prisma.lead.findFirst({ where: { id: leadId, deletedAt: null, ...(admin ? {} : { assignedToUserId: userId }) } })
}

// GET /documents?leadId=xxx — metadata list for one lead (not the file itself).
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const leadId = req.query.leadId ? String(req.query.leadId) : undefined
  if (!leadId) {
    res.status(400).json({ error: 'leadId is required.' })
    return
  }
  const admin = await isAdmin(req.userId)
  const lead = await canAccessLead(leadId, req.userId, admin)
  if (!lead) {
    res.status(404).json({ error: 'Lead not found.' })
    return
  }
  const documents = await prisma.document.findMany({ where: { leadId, deletedAt: null }, select: documentSelect, orderBy: { createdAt: 'desc' } })
  res.json({ documents })
})

// POST /documents — multipart/form-data: leadId + file (PDF/Excel/CSV, <=10MB).
router.post('/', (req: AuthRequest, res: Response) => {
  upload.single('file')(req, res, async (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'File exceeds the 10MB limit.' })
      return
    }
    if (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Could not upload file.' })
      return
    }
    const leadId = String(req.body.leadId ?? '')
    if (!leadId) {
      res.status(400).json({ error: 'leadId is required.' })
      return
    }
    if (!req.file) {
      res.status(400).json({ error: 'A file is required.' })
      return
    }
    const admin = await isAdmin(req.userId)
    const lead = await canAccessLead(leadId, req.userId, admin)
    if (!lead) {
      fs.unlink(req.file.path, () => {})
      res.status(404).json({ error: 'Lead not found.' })
      return
    }
    try {
      const document = await prisma.document.create({
        data: {
          leadId,
          fileName: req.file.originalname,
          storedFileName: req.file.filename,
          fileSize: req.file.size,
          uploadedByUserId: req.userId!,
        },
        select: documentSelect,
      })
      res.status(201).json({ document })
    } catch {
      fs.unlink(req.file.path, () => {})
      res.status(400).json({ error: 'Could not save document.' })
    }
  })
})

// GET /documents/:id/download — streams the PDF back with its original filename.
router.get('/:id/download', async (req: AuthRequest, res: Response): Promise<void> => {
  const admin = await isAdmin(req.userId)
  const document = await prisma.document.findFirst({
    where: { id: String(req.params.id), deletedAt: null, ...(admin ? {} : { lead: { assignedToUserId: req.userId } }) },
  })
  if (!document) {
    res.status(404).json({ error: 'Document not found.' })
    return
  }
  const filePath = path.join(UPLOAD_DIR, document.storedFileName)
  res.download(filePath, document.fileName, err => {
    if (err && !res.headersSent) res.status(404).json({ error: 'File is missing from storage.' })
  })
})

// DELETE /documents/:id — admin-only soft delete (row kept for audit, same
// pattern as leads/tasks/proposals/projects; the file on disk is left alone).
router.delete('/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await prisma.document.findFirst({ where: { id: String(req.params.id), deletedAt: null } })
  if (!existing) {
    res.status(404).json({ error: 'Document not found.' })
    return
  }
  await prisma.document.update({ where: { id: existing.id }, data: { deletedAt: new Date() } })
  res.json({ message: 'Document deleted.' })
})

export default router

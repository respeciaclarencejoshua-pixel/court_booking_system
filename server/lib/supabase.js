import { createClient } from '@supabase/supabase-js'

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for API routes.')
}

export const admin = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null

export async function requireUser(req, res, next) {
  if (!admin) return res.status(503).json({ error: 'The Supabase server is not configured.' })
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: 'Sign in to continue.' })
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return res.status(401).json({ error: 'Your session is invalid. Sign in again.' })
  req.user = data.user
  req.accessToken = token
  next()
}

export async function requireStaff(req, res, next) {
  const { data, error } = await admin.from('profiles').select('role').eq('id', req.user.id).single()
  if (error || !['STAFF', 'ADMIN'].includes(data.role)) return res.status(403).json({ error: 'Staff access is required.' })
  req.role = data.role
  next()
}

export async function requireAdmin(req, res, next) {
  const { data, error } = await admin.from('profiles').select('role').eq('id', req.user.id).single()
  if (error || data.role !== 'ADMIN') return res.status(403).json({ error: 'Admin access is required.' })
  req.role = data.role
  next()
}

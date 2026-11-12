import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { z } from 'zod'
import { admin, requireAdmin, requireStaff, requireUser } from './lib/supabase.js'

const app = express()
const port = Number(process.env.API_PORT || 3001)
const frontendOrigin = process.env.WEB_ORIGIN || 'http://localhost:5173'
app.use(cors({ origin: frontendOrigin, credentials: true }))
app.use(express.json({ limit: '100kb' }))

const fail = (res, error, status = 400) => res.status(status).json({ error: error?.message || 'The request could not be completed.' })
const profileSchema = z.object({ fullName: z.string().min(2).max(100).optional(), phone: z.string().min(7).max(30).optional() })
const holdSchema = z.object({ courtId: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), startTime: z.string().regex(/^\d{2}:\d{2}$/), durationHours: z.number().int().min(1).max(4) })
const requestSchema = z.object({ bookingId: z.string().uuid(), type: z.enum(['CANCELLATION', 'RESCHEDULING']), message: z.string().min(3).max(2000) })
const supportSchema = z.object({ message: z.string().min(8).max(4000) })
const adjustmentSchema = z.object({ bookingId: z.string().uuid().optional(), paymentId: z.string().uuid().optional(), type: z.enum(['APPLIED_TO_BOOKING', 'REFUND_ARRANGED']), amount: z.number().positive(), reference: z.string().max(255).optional(), staffNote: z.string().min(3).max(2000) })

app.get('/api/health', (_req, res) => res.json({ status: 'ok', configured: Boolean(admin) }))

app.use('/api/profile', requireUser)
app.get('/api/profile', async (req, res) => {
  const { data, error } = await admin.from('profiles').select('id,full_name,phone,email_verified_at,phone_verified_at,role').eq('id', req.user.id).single()
  if (error) return fail(res, error, 404)
  res.json({ ...data, email: req.user.email, emailVerifiedAt: data.email_verified_at || (req.user.email_confirmed_at ? req.user.email_confirmed_at : null), phoneVerifiedAt: data.phone_verified_at })
})
app.patch('/api/profile', async (req, res) => {
  const result = profileSchema.safeParse(req.body)
  if (!result.success) return res.status(400).json({ error: result.error.issues[0].message })
  const patch = {}
  if (result.data.fullName) patch.full_name = result.data.fullName
  if (result.data.phone) patch.phone = result.data.phone
  const { data, error } = await admin.from('profiles').update(patch).eq('id', req.user.id).select().single()
  if (error) return fail(res, error)
  await admin.from('audit_log').insert({ actor_id: req.user.id, action: 'PROFILE_UPDATED', entity_type: 'profile', entity_id: req.user.id })
  res.json(data)
})

app.use('/api/bookings', requireUser)
app.get('/api/bookings/mine', async (req, res) => {
  const { data, error } = await admin.from('bookings').select('*,courts(name,description)').eq('player_id', req.user.id).order('created_at', { ascending: false })
  if (error) return fail(res, error)
  res.json(data)
})
app.post('/api/bookings/hold', async (req, res) => {
  const parsed = holdSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message })
  const { data: profile, error: profileError } = await admin.from('profiles').select('phone_verified_at').eq('id', req.user.id).single()
  if (profileError) return fail(res, profileError)
  if (!req.user.email_confirmed_at && !profile.phone_verified_at) return res.status(403).json({ error: 'Verify your email or phone number before booking.' })
  const { data, error } = await admin.rpc('create_booking_hold', { p_player_id: req.user.id, p_court_id: parsed.data.courtId, p_booking_date: parsed.data.date, p_start_time: parsed.data.startTime, p_duration_hours: parsed.data.durationHours })
  if (error) return fail(res, error, error.message.includes('not available') ? 409 : 400)
  res.status(201).json(data)
})

app.post('/api/booking-requests', requireUser, async (req, res) => {
  const parsed = requestSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message })
  const { data: booking, error: bookingError } = await admin.from('bookings').select('id').eq('id', parsed.data.bookingId).eq('player_id', req.user.id).eq('status', 'CONFIRMED').single()
  if (bookingError || !booking) return res.status(404).json({ error: 'Confirmed booking not found.' })
  const { data, error } = await admin.from('booking_requests').insert({ booking_id: parsed.data.bookingId, type: parsed.data.type, message: parsed.data.message, player_id: req.user.id, status: 'PENDING' }).select().single()
  if (error) return fail(res, error)
  await admin.from('audit_log').insert({ actor_id: req.user.id, action: `BOOKING_${parsed.data.type}_REQUESTED`, entity_type: 'booking_request', entity_id: data.id })
  res.status(201).json(data)
})

app.get('/api/booking-requests/mine', requireUser, async (req, res) => {
  const { data, error } = await admin.from('booking_requests').select('*,bookings(booking_date,start_time,status)').eq('player_id', req.user.id).order('created_at', { ascending: false })
  if (error) return fail(res, error)
  res.json(data)
})

app.post('/api/support-messages', requireUser, async (req, res) => {
  const parsed = supportSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message })
  const { data, error } = await admin.from('support_messages').insert({ player_id: req.user.id, message: parsed.data.message, contact_email: req.user.email, status: 'OPEN' }).select().single()
  if (error) return fail(res, error)
  await admin.from('audit_log').insert({ actor_id: req.user.id, action: 'SUPPORT_MESSAGE_CREATED', entity_type: 'support_message', entity_id: data.id })
  res.status(201).json(data)
})

app.post('/api/payments/checkout', requireUser, async (req, res) => {
  const bookingId = z.string().uuid().safeParse(req.body.bookingId)
  if (!bookingId.success) return res.status(400).json({ error: 'A valid booking ID is required.' })
  const { data, error } = await admin.rpc('prepare_payment_checkout', { p_player_id: req.user.id, p_booking_id: bookingId.data })
  if (error) return fail(res, error, 409)
  if (!process.env.XENDIT_SECRET_KEY && !process.env.PAYMONGO_SECRET_KEY) return res.json({ checkoutUrl: null, booking: data, message: 'Payment provider credentials are not configured.' })
  return res.status(501).json({ error: 'The payment provider is selected but checkout is not configured. Add provider credentials and webhook secrets before accepting payments.' })
})

app.post('/api/webhooks/:provider', async (req, res) => {
  const { provider } = req.params
  const expected = process.env[`${provider.toUpperCase()}_WEBHOOK_SECRET`]
  const actual = provider === 'xendit' ? req.headers['x-callback-token'] : req.headers['paymongo-signature']
  if (!expected || actual !== expected) return res.status(401).json({ error: 'Webhook signature is invalid.' })
  return res.status(501).json({ error: 'Webhook payload verification must be configured for this provider before accepting events.' })
})

app.get('/api/staff/bookings', requireUser, requireStaff, async (req, res) => {
  const { data, error } = await admin.from('bookings').select('*,profiles(full_name,email),courts(name)').order('booking_date', { ascending: false })
  if (error) return fail(res, error)
  res.json(data)
})
app.get('/api/staff/payments', requireUser, requireStaff, async (_req, res) => {
  const { data, error } = await admin.from('payments').select('*,bookings(id,status,payment_status,booking_date,start_time,total_price,profiles(full_name),courts(name))').in('status', ['REVIEW_REQUIRED','CONFIRMED']).order('created_at', { ascending: false })
  if (error) return fail(res, error)
  res.json(data)
})
app.get('/api/staff/payments', requireUser, requireStaff, async (_req, res) => {
  const { data, error } = await admin.from('payments').select('*,bookings(id,status,payment_status,booking_date,start_time,total_price,profiles(full_name),courts(name))').in('status', ['REVIEW_REQUIRED','CONFIRMED']).order('created_at', { ascending: false })
  if (error) return fail(res, error)
  res.json(data)
})
app.get('/api/staff/requests', requireUser, requireStaff, async (_req, res) => {
  const { data, error } = await admin.from('booking_requests').select('*,bookings(*),profiles(full_name)').order('created_at', { ascending: false })
  if (error) return fail(res, error)
  res.json(data)
})
app.patch('/api/staff/requests/:id', requireUser, requireStaff, async (req, res) => {
  const parsed = z.object({ decision: z.enum(['APPROVED', 'REJECTED']), staffNote: z.string().min(2).max(2000) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message })
  const { data, error } = await admin.rpc('review_booking_request', { p_request_id: req.params.id, p_staff_id: req.user.id, p_decision: parsed.data.decision, p_staff_note: parsed.data.staffNote })
  if (error) return fail(res, error, 409)
  res.json(data)
})
app.get('/api/staff/support-messages', requireUser, requireStaff, async (_req, res) => {
  const { data, error } = await admin.from('support_messages').select('*,profiles(full_name,email)').order('created_at', { ascending: false })
  if (error) return fail(res, error)
  res.json(data)
})
app.post('/api/staff/payment-adjustments', requireUser, requireStaff, async (req, res) => {
  const parsed = adjustmentSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message })
  const { data, error } = await admin.from('payment_adjustments').insert({ ...parsed.data, staff_id: req.user.id }).select().single()
  if (error) return fail(res, error)
  await admin.from('audit_log').insert({ actor_id: req.user.id, action: 'PAYMENT_ADJUSTMENT_RECORDED', entity_type: 'payment_adjustment', entity_id: data.id, metadata: { type: data.type, amount: data.amount, reference: data.reference } })
  res.status(201).json(data)
})

app.get('/api/admin/settings', requireUser, requireAdmin, async (_req, res) => {
  const { data, error } = await admin.from('venue_settings').select('*').single()
  if (error) return fail(res, error)
  res.json(data)
})
app.get('/api/admin/courts', requireUser, requireAdmin, async (_req, res) => {
  const { data, error } = await admin.from('courts').select('*').order('name')
  if (error) return fail(res, error)
  res.json(data)
})
app.get('/api/admin/staff', requireUser, requireAdmin, async (_req, res) => {
  const { data, error } = await admin.from('profiles').select('id,full_name,role,created_at').in('role', ['STAFF','ADMIN']).order('created_at')
  if (error) return fail(res, error)
  res.json(data)
})
app.patch('/api/admin/staff/:id', requireUser, requireAdmin, async (req, res) => {
  const parsed = z.object({ role: z.enum(['PLAYER','STAFF','ADMIN']) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message })
  if (req.params.id === req.user.id && parsed.data.role !== 'ADMIN') return res.status(400).json({ error: 'You cannot revoke your own admin role.' })
  const { data, error } = await admin.from('profiles').update({ role: parsed.data.role }).eq('id', req.params.id).select('id,full_name,role').single()
  if (error) return fail(res, error)
  await admin.from('audit_log').insert({ actor_id: req.user.id, action: 'STAFF_ROLE_UPDATED', entity_type: 'profile', entity_id: data.id, metadata: { role: data.role } })
  res.json(data)
})
app.get('/api/admin/courts', requireUser, requireAdmin, async (_req, res) => {
  const { data, error } = await admin.from('courts').select('*').order('name')
  if (error) return fail(res, error)
  res.json(data)
})
app.get('/api/admin/staff', requireUser, requireAdmin, async (_req, res) => {
  const { data, error } = await admin.from('profiles').select('id,full_name,role,created_at').in('role', ['STAFF','ADMIN']).order('created_at')
  if (error) return fail(res, error)
  res.json(data)
})
app.patch('/api/admin/staff/:id', requireUser, requireAdmin, async (req, res) => {
  const parsed = z.object({ role: z.enum(['PLAYER','STAFF','ADMIN']) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message })
  if (req.params.id === req.user.id && parsed.data.role !== 'ADMIN') return res.status(400).json({ error: 'You cannot revoke your own admin role.' })
  const { data, error } = await admin.from('profiles').update({ role: parsed.data.role }).eq('id', req.params.id).select('id,full_name,role').single()
  if (error) return fail(res, error)
  await admin.from('audit_log').insert({ actor_id: req.user.id, action: 'STAFF_ROLE_UPDATED', entity_type: 'profile', entity_id: data.id, metadata: { role: data.role } })
  res.json(data)
})
app.patch('/api/admin/settings', requireUser, requireAdmin, async (req, res) => {
  const parsed = z.object({ venueName: z.string().min(2).optional(), advanceBookingDays: z.number().int().min(1).max(365).optional(), cancellationHours: z.number().int().min(0).max(720).optional(), reminderHours: z.number().int().min(0).max(168).optional(), reminderEnabled: z.boolean().optional(), policies: z.record(z.string(), z.unknown()).optional() }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message })
  const update = Object.fromEntries(Object.entries(parsed.data).map(([key, value]) => [key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`), value]))
  const { data, error } = await admin.from('venue_settings').update({ ...update, updated_by: req.user.id }).eq('id', 1).select().single()
  if (error) return fail(res, error)
  await admin.from('audit_log').insert({ actor_id: req.user.id, action: 'VENUE_SETTINGS_UPDATED', entity_type: 'venue_settings', entity_id: String(data.id), metadata: update })
  res.json(data)
})
app.patch('/api/admin/courts/:id', requireUser, requireAdmin, async (req, res) => {
  const parsed = z.object({ name: z.string().min(2).optional(), description: z.string().max(500).optional(), pricePerHour: z.number().positive().optional(), active: z.boolean().optional() }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message })
  const update = Object.fromEntries(Object.entries(parsed.data).map(([key, value]) => [key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`), value]))
  const { data, error } = await admin.from('courts').update(update).eq('id', req.params.id).select().single()
  if (error) return fail(res, error)
  await admin.from('audit_log').insert({ actor_id: req.user.id, action: 'COURT_UPDATED', entity_type: 'court', entity_id: data.id, metadata: update })
  res.json(data)
})
app.get('/api/admin/revenue', requireUser, requireAdmin, async (req, res) => {
  const { data, error } = await admin.from('payments').select('amount,currency,status,created_at').eq('status', 'CONFIRMED').order('created_at', { ascending: false })
  if (error) return fail(res, error)
  res.json(data)
})

app.listen(port, '0.0.0.0', () => console.log(`Dink Club API listening on ${port}`))

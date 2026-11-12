import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Bell, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock3, CreditCard, HelpCircle, LogIn, LogOut, Menu, Minus, Plus, Search, Settings2, ShieldCheck, Sparkles, User, X } from 'lucide-react'
import { supabase } from './lib/supabase.js'

const dayOptions = [
  { weekday: 'Today', date: 'Oct 28', number: 28, month: 'October' },
  { weekday: 'Wed', date: 'Oct 29', number: 29, month: 'October' },
  { weekday: 'Thu', date: 'Oct 30', number: 30, month: 'October' },
  { weekday: 'Fri', date: 'Oct 31', number: 31, month: 'October' },
  { weekday: 'Sat', date: 'Nov 01', number: 1, month: 'November' },
  { weekday: 'Sun', date: 'Nov 02', number: 2, month: 'November' },
  { weekday: 'Mon', date: 'Nov 03', number: 3, month: 'November' },
]

const courts = [
  { id: 'court-1', name: 'Court 01', type: 'Indoor · Pro surface', price: 450, accent: '#a7db49', icon: '01' },
  { id: 'court-2', name: 'Court 02', type: 'Indoor · Pro surface', price: 450, accent: '#e6bb67', icon: '02' },
  { id: 'court-3', name: 'Court 03', type: 'Outdoor · Sunset side', price: 350, accent: '#84bfe6', icon: '03' },
  { id: 'court-4', name: 'Court 04', type: 'Outdoor · Sunset side', price: 350, accent: '#b6a0f0', icon: '04' },
]

const allTimes = ['07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00']
const unavailable = { 'court-1': ['09:00', '11:00', '16:00'], 'court-2': ['08:00', '12:00', '18:00'], 'court-3': ['07:00', '10:00', '14:00', '19:00'], 'court-4': ['09:00', '13:00', '17:00', '20:00'] }
const currency = amount => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(amount)
const formatTime = value => { const hour = Number(value.split(':')[0]); return `${hour % 12 || 12}:00 ${hour < 12 ? 'AM' : 'PM'}` }

export default function App() {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [authModal, setAuthModal] = useState(false)
  const [authMode, setAuthMode] = useState('signin')
  const [authMessage, setAuthMessage] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [verify, setVerify] = useState(false)
  const [dateIndex, setDateIndex] = useState(0)
  const [duration, setDuration] = useState(1)
  const [selectedCourt, setSelectedCourt] = useState('court-1')
  const [selectedTime, setSelectedTime] = useState('')
  const [reservations, setReservations] = useState([])
  const [panel, setPanel] = useState('booking')
  const [toast, setToast] = useState('')
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const [processing, setProcessing] = useState(false)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null))
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (user) loadBookings()
    else { setReservations([]); setProfile(null) }
  }, [user])

  async function loadBookings() {
    const headers = await apiHeaders()
    try {
      const [bookingsResponse, profileResponse] = await Promise.all([fetch('/api/bookings/mine', { headers }), fetch('/api/profile', { headers })])
      if (bookingsResponse.ok) { const rows = await bookingsResponse.json(); setReservations(rows.map(row => ({ id: row.id, courtId: row.court_id, date: row.booking_date, time: row.start_time.slice(0, 5), status: row.status, holdExpiresAt: row.hold_expires_at, paymentStatus: row.payment_status, receipt: row.receipt_reference, duration: row.duration_hours, amount: row.total_price, courts: row.courts }))) }
      if (profileResponse.ok) setProfile(await profileResponse.json())
    } catch (error) { console.error('Could not load bookings', error) }
  }

  async function apiHeaders(json = false) {
    const session = supabase ? (await supabase.auth.getSession()).data.session : null
    return { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) }
  }

  const court = courts.find(item => item.id === selectedCourt)
  const price = court.price * duration
  const date = dayOptions[dateIndex]
  const availableTimes = useMemo(() => allTimes.filter(time => {
    if (unavailable[selectedCourt]?.includes(time)) return false
    for (let i = 0; i < duration; i++) {
      const hour = Number(time.split(':')[0]) + i
      if (hour > 21 || allTimes.some(t => Number(t.slice(0, 2)) === hour && unavailable[selectedCourt]?.includes(t))) return false
    }
    return true
  }), [selectedCourt, duration])

  const currentBookings = reservations.filter(item => ['HOLD', 'CONFIRMED'].includes(item.status) && item.date === dateKey(date) && item.courtId === selectedCourt)
  const isReserved = time => currentBookings.some(item => {
    const start = Number(item.time.slice(0, 2)), end = start + (item.duration || 1), current = Number(time.slice(0, 2))
    return current >= start && current < end
  })

  useEffect(() => {
    const timer = window.setInterval(() => {
      setReservations(old => {
        let expired = false
        const next = old.map(item => {
          if (item.status === 'HOLD' && item.holdExpiresAt && Date.now() >= new Date(item.holdExpiresAt).getTime()) { expired = true; return { ...item, status: 'CANCELLED', paymentStatus: item.paymentStatus === 'PENDING' ? 'REVIEW_REQUIRED' : item.paymentStatus } }
          return item
        })
        if (expired && user) { setToast('Your hold ended. Save your payment receipt and contact support if your payment went through.'); loadBookings() }
        return next
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [user])

  useEffect(() => { if (toast) { const timer = window.setTimeout(() => setToast(''), 5500); return () => window.clearTimeout(timer) } }, [toast])
  useEffect(() => { setSelectedTime('') }, [dateIndex, selectedCourt, duration])

  async function authenticate(event) {
    event.preventDefault()
    if (!supabase) { setAuthMessage('Add Supabase credentials in .env to enable account access.'); return }
    setAuthLoading(true); setAuthMessage('')
    try {
      if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } })
        if (error) throw error
        if (data.session) {
          const headers = await apiHeaders(true)
          await fetch('/api/profile', { method: 'PATCH', headers, body: JSON.stringify({ fullName: name }) })
          setAuthModal(false); setToast('Welcome to Dink Club. You can make a booking now.')
        } else { setAuthMessage('Check your email to verify your account before booking.'); setVerify(true) }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        setAuthModal(false); setToast('Welcome back. Let’s find your court.')
      }
    } catch (error) { setAuthMessage(error.message || 'Something went wrong. Please try again.') }
    finally { setAuthLoading(false) }
  }

  async function signOut() { if (supabase) await supabase.auth.signOut(); setPanel('booking'); setToast('You have signed out.') }

  async function createBooking() {
    if (!user) { setAuthMode('signin'); setAuthMessage('Sign in before you start your reservation.'); setAuthModal(true); return }
    const session = (await supabase.auth.getSession()).data.session
    if (user.email && !user.email_confirmed_at) { setToast('Verify your email before making your first booking.'); return }
    if (!profile?.phone_verified_at && !user.email_confirmed_at) { setToast('Verify at least one contact method before booking.'); return }
    setProcessing(true)
    try {
      const dbCourtId = courts.findIndex(item => item.id === selectedCourt) + 1
      const response = await fetch('/api/bookings/hold', { method: 'POST', headers: { ...(await apiHeaders(true)), Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ courtId: dbCourtId, date: dateKey(date), startTime: selectedTime, durationHours: duration }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not hold that court. Please choose another time.')
      await loadBookings()
      setPanel('booking'); setSelectedTime('')
      setToast('Court held for 5 minutes. Complete payment on the reservation card below.')
    } catch (error) { setToast(error.message) }
    finally { setProcessing(false) }
  }

  async function startPayment(booking) {
    if (!user) return
    setProcessing(true)
    try {
      const response = await fetch('/api/payments/checkout', { method: 'POST', headers: await apiHeaders(true), body: JSON.stringify({ bookingId: booking.id }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Payment could not be started.')
      if (body.checkoutUrl) { window.location.assign(body.checkoutUrl); return }
      setToast('Payment gateway is being configured. Contact staff to finish this payment.')
    } catch (error) { setToast(error.message) }
    finally { setProcessing(false) }
  }

  async function openAuth(mode = 'signin') { setAuthMode(mode); setAuthMessage(''); setAuthModal(true) }
  async function showPage(nextPanel) { setShowMobileMenu(false); if (!user && ['my-bookings', 'requests', 'staff', 'admin', 'cancelled'].includes(nextPanel)) { setAuthMode('signin'); setAuthModal(true); return }; if (['staff', 'admin'].includes(nextPanel) && !['STAFF', 'ADMIN'].includes(profile?.role)) { setToast('This area is limited to authorized staff.'); return }; if (nextPanel === 'admin' && profile?.role !== 'ADMIN') { setToast('Admin access is required.'); return }; setPanel(nextPanel) }
  const activeHold = reservations.filter(item => item.status === 'HOLD')
  const upcoming = reservations.filter(item => ['HOLD', 'CONFIRMED'].includes(item.status))
  const cancelled = reservations.filter(item => item.status === 'CANCELLED')
  const adminMode = ['ADMIN', 'STAFF'].includes(profile?.role)
  const navItems = [{ key: 'booking', label: 'Book a court', icon: CalendarDays }, { key: 'my-bookings', label: 'My bookings', icon: Clock3 }, { key: 'requests', label: 'Support', icon: HelpCircle }]

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-symbol"><span /><span /><span /><span /></div><div className="brand-name">dink<span>club</span></div><button className="sidebar-toggle" aria-label="Collapse sidebar"><ArrowLeft size={15}/></button></div>
      <div className="venue-chip"><div className="venue-photo"/><div><strong>Greenfield Pickleball</strong><span>Metro Manila, PH <ChevronDown size={12}/></span></div></div>
      <div className="side-caption">YOUR SPACE</div>
      <nav className="sidebar-nav">{navItems.map(item => { const Icon = item.icon; return <button key={item.key} className={`side-link ${panel === item.key ? 'active' : ''}`} onClick={() => showPage(item.key)}><Icon size={17}/><span>{item.label}</span>{item.key === 'my-bookings' && activeHold.length > 0 && <i>{activeHold.length}</i>}</button> })}</nav>
      {adminMode && <div className="side-caption side-caption-secondary">OPERATIONS</div>}
      {adminMode && <nav className="sidebar-nav sidebar-nav-secondary"><button className={`side-link ${panel === 'staff' ? 'active' : ''}`} onClick={() => showPage('staff')}><ShieldCheck size={17}/><span>Staff workspace</span></button></nav>}
      {profile?.role === 'ADMIN' && <nav className="sidebar-nav sidebar-nav-secondary"><button className={`side-link ${panel === 'admin' ? 'active' : ''}`} onClick={() => showPage('admin')}><Settings2 size={17}/><span>Venue settings</span></button></nav>}
      {user && <div className="side-caption side-caption-secondary">YOUR ACTIVITY</div>}
      {user && <nav className="sidebar-nav sidebar-nav-secondary"><button className={`side-link ${panel === 'cancelled' ? 'active' : ''}`} onClick={() => showPage('cancelled')}><X size={17}/><span>Cancelled bookings</span>{cancelled.length > 0 && <i>{cancelled.length}</i>}</button></nav>}
      <div className="sidebar-bottom"><div className="help-card"><div className="help-icon"><HelpCircle size={16}/></div><div><strong>Need a hand?</strong><span>We’re just a message away.</span></div><button aria-label="Contact support" onClick={() => showPage('requests')}><ArrowUpRight size={15}/></button></div>{user ? <button className="profile-row" onClick={signOut}><div className="avatar">{(user.user_metadata?.full_name || user.email || 'D').slice(0, 1).toUpperCase()}</div><div className="profile-info"><strong>{user.user_metadata?.full_name || user.email.split('@')[0]}</strong><span>{user.email}</span></div><LogOut size={16} className="profile-menu"/></button> : <button className="profile-row" onClick={() => openAuth()}><div className="avatar guest-avatar"><User size={17}/></div><div className="profile-info"><strong>Player account</strong><span>Sign in to get started</span></div><LogIn size={16} className="profile-menu"/></button>}<div className="sidebar-footer"><span>Built for the love of the game.</span><span>●&nbsp; All systems normal</span></div></div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="breadcrumb"><span>Greenfield Pickleball</span><ChevronRight size={14}/><strong>{panel === 'booking' ? 'Reservations' : panel === 'my-bookings' ? 'My bookings' : panel === 'cancelled' ? 'Cancelled bookings' : panel === 'staff' ? 'Staff workspace' : panel === 'admin' ? 'Venue settings' : 'Support'}</strong></div><div className="topbar-actions"><div className="live-pill"><span/> Courts open today</div><button className="icon-button search-button" aria-label="Search"><Search size={18}/></button><button className="icon-button" aria-label="Notifications"><Bell size={18}/></button>{user ? <button className="top-avatar" onClick={signOut}>{(user.user_metadata?.full_name || user.email || 'D').slice(0, 1).toUpperCase()}</button> : <button className="top-signin" onClick={() => openAuth()}>Sign in</button>}<button className="mobile-menu" aria-label="Open menu" onClick={() => setShowMobileMenu(!showMobileMenu)}><Menu size={19}/></button></div></header>
      {showMobileMenu && <div className="mobile-nav">{navItems.map(item => <button key={item.key} onClick={() => showPage(item.key)}>{item.label}</button>)}{adminMode && <button onClick={() => showPage('staff')}>Staff workspace</button>}{profile?.role === 'ADMIN' && <button onClick={() => showPage('admin')}>Venue settings</button>}</div>}
      <section className="content-wrap">
        {panel === 'booking' ? <><div className="welcome-row"><div><div className="eyebrow"><Sparkles size={13}/> A BETTER WAY TO PLAY</div><h1>Your court awaits<span>.</span></h1><p>Great games start with a great court. Let’s get you on one.</p></div><div className="weather-chip"><span className="weather-sun">☀</span><span><strong>28°</strong><small>Perfect court weather</small></span></div></div>
        <section className="hero-card"><div className="hero-image"><div className="hero-gradient"/><div className="hero-court-lines"><span/><span/><span/><span/><span/></div><div className="hero-grain"/><div className="hero-content"><div className="hero-location"><span className="location-dot"/> GREENFIELD, METRO MANILA</div><h2>Find your<br/><em>next rally.</em></h2><p>Four courts. One good time.<br/>Your game starts right here.</p><a href="#booking" className="hero-cta" onClick={event => { event.preventDefault(); document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth' }) }}>Find a court <ArrowDown size={15}/></a></div><div className="hero-note"><span className="note-dot"/> WALK-INS WELCOME<br/><small>Reservation recommended</small></div><div className="hero-court-badge"><span>🏓</span><strong>4</strong><small>TOURNAMENT-READY<br/>COURTS</small></div></div><div className="hero-stats"><div><span>01 — 04</span><strong>Premium courts</strong></div><div><span>07:00 — 22:00</span><strong>Open every day</strong></div><div><span>FROM ₱350</span><strong>Per hour, per court</strong></div><div className="stats-link"><span>A little more than just a court</span><ArrowUpRight size={16}/></div></div></section>
        <section className="booking-section" id="booking"><div className="section-head"><div><div className="eyebrow muted-eyebrow">MAKE IT A DATE</div><h2>Book your court</h2><p>Pick your day, find your time, and you’re in.</p></div><button className="outline-button" onClick={() => showPage('my-bookings')}><CalendarDays size={15}/> My bookings <ArrowRight size={14}/></button></div>
        <div className="booking-layout"><div className="booking-main"><div className="date-strip"><div className="strip-label"><span>SELECT A DAY</span><button aria-label="Previous week" onClick={() => setDateIndex(Math.max(0, dateIndex - 1))}><ChevronLeft size={15}/></button></div><div className="date-options">{dayOptions.map((item, index) => <button key={item.date} className={`date-option ${dateIndex === index ? 'selected' : ''}`} onClick={() => setDateIndex(index)}><span>{item.weekday}</span><strong>{item.number.toString().padStart(2, '0')}</strong><i>{item.month.slice(0, 3).toUpperCase()}</i></button>)}</div><button className="calendar-button" aria-label="Next week" onClick={() => setDateIndex(Math.min(dayOptions.length - 1, dateIndex + 1))}><ChevronRight size={16}/></button></div>
        <div className="court-select-head"><div><span className="booking-label">CHOOSE YOUR COURT</span><span className="court-availability"><i/> 4 courts available</span></div><button className="filter-button"><Settings2 size={14}/> Filters</button></div>
        <div className="court-list">{courts.map(item => <button key={item.id} className={`court-option ${selectedCourt === item.id ? 'selected' : ''}`} onClick={() => setSelectedCourt(item.id)}><div className="court-thumb" style={{ '--court-accent': item.accent }}><span className="court-thumb-number">{item.icon}</span><span className="court-thumb-lines"/><span className="court-thumb-ball"/></div><div className="court-info"><strong>{item.name}</strong><span><i className="surface-dot"/> {item.type}</span></div><div className="court-rate"><strong>{currency(item.price)}</strong><span>/ hour</span></div><div className={`radio-dot ${selectedCourt === item.id ? 'chosen' : ''}`}>{selectedCourt === item.id && <Check size={11}/>}</div></button>)}</div>
        <div className="slot-head"><div><span className="booking-label">AVAILABLE TIMES</span><span className="slot-day"><CalendarDays size={12}/> {date.weekday}, {date.month} {date.number}</span></div><div className="slot-legend"><span><i/> Available</span><span><i/> Booked</span></div></div>
        <div className="time-grid">{allTimes.map(time => { const available = availableTimes.includes(time), reserved = isReserved(time); return <button key={time} disabled={!available || reserved} className={`time-slot ${selectedTime === time ? 'selected' : ''} ${!available || reserved ? 'unavailable' : ''}`} onClick={() => setSelectedTime(time)}><span>{formatTime(time)}</span>{selectedTime === time && <Check size={12}/>}</button> })}</div>
        <div className="slot-foot"><span><i/> Real-time availability</span><span>All prices in Philippine pesos</span></div>
        </div><aside className="booking-summary"><div className="summary-top"><div className="summary-icon"><CalendarDays size={16}/></div><div><span>YOUR RESERVATION</span><small>{selectedTime ? 'Looking good.' : 'Almost game time.'}</small></div><span className="summary-step">01 <i>/ 02</i></span></div><div className="summary-court-image"><span>THE DINK CLUB</span><div className="mini-court-lines"><i/><i/><i/></div><span className="summary-court-number">{court.icon}</span></div><div className="summary-court-title"><div><strong>{court.name}</strong><span>{court.type}</span></div><span className="available-tag"><i/> AVAILABLE</span></div><div className="summary-divider"/><div className="summary-row"><span><CalendarDays size={14}/> Date</span><strong>{date.weekday}, {date.month} {date.number}</strong></div><div className="summary-row"><span><Clock3 size={14}/> Time</span><strong>{selectedTime ? `${formatTime(selectedTime)}${duration > 1 ? ` – ${formatTime(`${String(Number(selectedTime.slice(0, 2) + duration).padStart(2, '0'))}:00`)}` : ''}` : 'Select a time'}</strong></div><div className="summary-row duration-row"><span><Clock3 size={14}/> Duration</span><div className="duration-control"><button aria-label="Reduce duration" disabled={duration <= 1} onClick={() => setDuration(Math.max(1, duration - 1))}><Minus size={12}/></button><strong>{duration} hr</strong><button aria-label="Add duration" disabled={duration >= 4} onClick={() => setDuration(Math.min(4, duration + 1))}><Plus size={12}/></button></div></div><div className="summary-divider summary-divider-small"/><div className="summary-row price-row"><span>Court rental <small>({duration} × {currency(court.price)})</small></span><strong>{currency(price)}</strong></div><div className="summary-row total-row"><span>Total <small>PHP</small></span><strong>{currency(price)}</strong></div><button className="checkout-button" disabled={!selectedTime || processing} onClick={createBooking}>{processing ? 'Checking availability…' : <>Continue to payment <ArrowRight size={16}/></>}</button><div className="secure-note"><ShieldCheck size={14}/> <span>Secure checkout <i>·</i> Free cancellation up to 24h before</span></div><div className="hold-note"><Clock3 size={13}/> <span>5-minute hold starts at checkout.</span></div></aside></div>
        <div className="booking-bottom-note"><span><span className="bottom-icon"><ShieldCheck size={14}/></span><strong>Your game, your rules.</strong> Policies shown before payment are saved with your booking.</span><button onClick={() => setPanel('requests')}>Read our booking policy <ArrowUpRight size={14}/></button></div>
        </section></> : panel === 'my-bookings' ? <BookingsPage bookings={upcoming} setPanel={setPanel} signIn={() => openAuth()} cancelRequest={async booking => { const headers = await apiHeaders(true); const response = await fetch('/api/booking-requests', { method: 'POST', headers, body: JSON.stringify({ bookingId: booking.id, type: 'CANCELLATION', message: 'Cancellation requested by player' }) }); const body = await response.json(); setToast(response.ok ? 'Cancellation request sent to our team.' : body.error || 'Request could not be submitted.'); }} startPayment={startPayment} processing={processing} toast={setToast}/> : panel === 'cancelled' ? <CancelledPage bookings={cancelled} setPanel={setPanel}/> : panel === 'staff' ? <StaffPage getHeaders={apiHeaders} setToast={setToast}/> : panel === 'admin' ? <AdminPage getHeaders={apiHeaders} setToast={setToast}/> : <SupportPage user={user} setToast={setToast} />}
      </section>
      <footer className="main-footer"><span>© 2025 Dink Club. Made for the love of the game.</span><div><a href="#help" onClick={event => { event.preventDefault(); setPanel('requests') }}>Help & support</a><a href="#privacy">Privacy</a><a href="#terms">Terms</a><span className="footer-status"><i/> All courts operational</span></div></footer>
    </main>
    {authModal && <div className="modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setAuthModal(false) }}><div className="auth-modal"><button className="modal-close" aria-label="Close" onClick={() => setAuthModal(false)}><X size={17}/></button><div className="modal-brand"><div className="brand-symbol"><span/><span/><span/><span/></div><div className="brand-name">dink<span>club</span></div></div><div className="eyebrow muted-eyebrow">YOUR NEXT GAME STARTS HERE</div><h2>{verify ? 'Check your inbox.' : authMode === 'signup' ? 'Create your account.' : 'Welcome back.'}</h2><p>{verify ? `We sent a verification link to ${email}. Verify your email before booking.` : authMode === 'signup' ? 'Sign up to reserve your court and keep all your bookings in one place.' : 'Sign in to reserve your court and manage your bookings.'}</p>{!verify && <form onSubmit={authenticate}>{authMode === 'signup' && <label>Full name<input value={name} onChange={event => setName(event.target.value)} placeholder="Your name" required minLength={2}/></label>}<label>Email address<input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" required/></label><label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 8 characters" required minLength={8}/></label>{authMessage && <div className="auth-message">{authMessage}</div>}<button className="checkout-button auth-submit" disabled={authLoading}>{authLoading ? 'Please wait…' : authMode === 'signup' ? 'Create account' : 'Sign in'} <ArrowRight size={15}/></button></form>}{verify && <button className="checkout-button auth-submit" onClick={() => { setVerify(false); setAuthMode('signin') }}>Back to sign in <ArrowRight size={15}/></button>}<div className="auth-switch">{authMode === 'signup' ? 'Already have an account?' : 'New to Dink Club?'} <button onClick={() => { setAuthMode(authMode === 'signup' ? 'signin' : 'signup'); setAuthMessage(''); setVerify(false) }}>{authMode === 'signup' ? 'Sign in' : 'Create an account'}</button></div><div className="modal-verified"><ShieldCheck size={14}/> Verified email required before first booking.</div></div></div>}
    {toast && <div className="toast"><CheckCircle2 size={17}/><span>{toast}</span><button aria-label="Dismiss" onClick={() => setToast('')}><X size={15}/></button></div>}
  </div>
}

function dateKey(day) { const year = new Date().getFullYear(); return `${year}-${String(day.month === 'October' ? 10 : 11).padStart(2, '0')}-${String(day.number).padStart(2, '0')}` }

function BookingCard({ booking, onPay, onCancel, processing }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const remaining = booking.status === 'HOLD' && booking.holdExpiresAt ? Math.max(0, Math.ceil((new Date(booking.holdExpiresAt).getTime() - now) / 1000)) : 0
  const mins = String(Math.floor(remaining / 60)).padStart(2, '0'), secs = String(remaining % 60).padStart(2, '0')
  const courtName = booking.courts?.name || courts.find((court, index) => court.id === booking.courtId || String(index + 1) === String(booking.courtId))?.name || 'Court'
  return <article className="booking-card"><div className="booking-card-icon"><CalendarDays size={17}/></div><div className="booking-card-details"><div className="booking-card-title"><strong>{courtName}</strong><span className={`status-chip ${booking.status.toLowerCase()}`}>{booking.status === 'HOLD' ? 'PAYMENT HOLD' : booking.status}</span></div><span>{booking.date} · {formatTime(booking.time)} · {booking.duration || 1} hr</span><span>{booking.amount ? currency(booking.amount) : ''}{booking.receipt ? ` · Receipt ${booking.receipt}` : ''}</span>{booking.status === 'HOLD' && <div className="hold-countdown"><Clock3 size={13}/><span>Time remaining</span><strong>{mins}:{secs}</strong></div>}{booking.paymentStatus === 'REVIEW_REQUIRED' && <div className="late-payment-notice">The hold ended and your booking was cancelled. Save your receipt and contact support to request a review.</div>}</div>{booking.status === 'HOLD' ? <button className="small-action" disabled={remaining <= 0 || processing} onClick={() => onPay(booking)}><CreditCard size={14}/> Pay now</button> : booking.status === 'CONFIRMED' && <button className="small-action secondary-action" onClick={() => onCancel(booking)}>Request cancellation</button>}</article>
}

function BookingsPage({ bookings, setPanel, cancelRequest, startPayment, processing, toast }) {
  const [activeTab, setActiveTab] = useState('upcoming')
  const [requests, setRequests] = useState([])
  useEffect(() => { (async () => { const session = (await supabase?.auth.getSession())?.data?.session; if (!session) return; const response = await fetch('/api/booking-requests/mine', { headers: { Authorization: `Bearer ${session.access_token}` } }); if (response.ok) setRequests(await response.json()) })() }, [])
  return <><PageHeading eyebrow="YOUR TIME ON COURT" title="My bookings." description="Everything you need for game day, all in one place." action={<button className="outline-button" onClick={() => setPanel('booking')}><Plus size={15}/> Book a court</button>}/><div className="page-tabs"><button className={activeTab === 'upcoming' ? 'active' : ''} onClick={() => setActiveTab('upcoming')}>Upcoming <span>{bookings.length}</span></button><button className={activeTab === 'requests' ? 'active' : ''} onClick={() => setActiveTab('requests')}>Support requests <span>{requests.length}</span></button></div>{activeTab === 'upcoming' ? bookings.length ? <div className="booking-card-list">{bookings.map(booking => <BookingCard key={booking.id} booking={booking} processing={processing} onPay={startPayment} onCancel={cancelRequest}/>)}</div> : <EmptyState icon={<CalendarDays size={22}/>} title="No upcoming bookings." copy="Your next great game is just a few clicks away." action={<button className="checkout-button empty-cta" onClick={() => setPanel('booking')}>Find a court <ArrowRight size={15}/></button>}/> : requests.length ? <div className="booking-card-list">{requests.map(request => <article className="booking-card" key={request.id}><div className="booking-card-icon"><HelpCircle size={17}/></div><div className="booking-card-details"><div className="booking-card-title"><strong>{request.type === 'CANCELLATION' ? 'Cancellation request' : 'Rescheduling request'}</strong><span className={`status-chip ${request.status.toLowerCase()}`}>{request.status.replace('_', ' ')}</span></div><span>{request.message || 'Awaiting staff review.'}</span>{request.staff_note && <div className="staff-note">Staff note: {request.staff_note}</div>}</div></article>)}</div> : <EmptyState icon={<HelpCircle size={22}/>} title="No support requests." copy="Cancellation and rescheduling requests will appear here." action={null}/>}</>
}

function CancelledPage({ bookings, setPanel }) { return <><PageHeading eyebrow="BOOKING HISTORY" title="Cancelled bookings." description="Cancelled reservations and late payment updates are saved here." action={<button className="outline-button" onClick={() => setPanel('booking')}><Plus size={15}/> Book a court</button>}/>{bookings.length ? <div className="booking-card-list">{bookings.map(booking => <BookingCard key={booking.id} booking={booking} onPay={() => {}} onCancel={() => {}}/>)}</div> : <EmptyState icon={<CheckCircle2 size={22}/>} title="No cancelled bookings." copy="You’re all set. If a hold ends, its status and payment review instructions will appear here." action={null}/>}</> }

function SupportPage({ user, setToast }) { const [message, setMessage] = useState(''); const [sending, setSending] = useState(false); const [email, setEmail] = useState(user?.email || ''); async function submit(event) { event.preventDefault(); if (!user) { setToast('Sign in so our team can reply using your verified contact details.'); return }; setSending(true); const session = (await supabase.auth.getSession()).data.session; const response = await fetch('/api/support-messages', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ message }) }); const body = await response.json(); setSending(false); if (!response.ok) { setToast(body.error || 'Your message could not be sent.'); return }; setMessage(''); setToast('Your support message has been sent.') }; return <><PageHeading eyebrow="WE’RE HERE TO HELP" title="Good games, good support." description="Questions about a booking, payment, cancellation, or a late receipt? Send our team a message."/><div className="support-grid"><div className="support-card"><div className="support-card-icon"><HelpCircle size={18}/></div><div className="eyebrow muted-eyebrow">PLAYER SUPPORT</div><h3>We’ve got your back.</h3><p>If a payment arrived after your five-minute hold, save your receipt and send us the receipt reference. Staff can review it and apply it to another open booking or arrange a refund.</p><div className="support-contact"><span>REPLY TO</span><strong>{user?.email || email || 'Your verified email'}</strong></div></div><form className="support-form card-panel" onSubmit={submit}><div className="booking-label">SEND A MESSAGE</div><label>Contact email<input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" required disabled={!!user?.email}/></label><label>How can we help?<textarea value={message} onChange={event => setMessage(event.target.value)} placeholder="Tell us what happened, and include your booking or receipt reference if you have it." required minLength={8} rows={6}/></label><button className="checkout-button" disabled={sending}>{sending ? 'Sending…' : <>Send to support <ArrowRight size={15}/></>}</button></form></div><div className="support-faq-grid"><div className="faq-card"><Clock3 size={16}/><strong>Hold expired?</strong><p>Your booking is cancelled and the court may be rebooked. Save your receipt and contact our staff.</p></div><div className="faq-card"><CreditCard size={16}/><strong>Need to change a booking?</strong><p>Send a cancellation or rescheduling request. Staff will review it and leave a note with their decision.</p></div><div className="faq-card"><ShieldCheck size={16}/><strong>Payment security</strong><p>Payments are confirmed by a provider notification, not a browser success message alone.</p></div></div></> }

function PageHeading({ eyebrow, title, description, action }) { return <div className="page-heading"><div><div className="eyebrow muted-eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div> }
function EmptyState({ icon, title, copy, action }) { return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{copy}</p>{action}</div> }

# Dink Club

A single-venue pickleball booking starter: React and Vite frontend, Node.js API, and Supabase Auth/Postgres. The interface is ready to connect to a Supabase project; checkout stays unavailable until a payment provider and verified webhook are configured.

## Run locally

1. Use Node.js 22 or newer and create a Supabase project.
2. Copy `.env.example` to `.env`. Set the Supabase URL and **public anon key** in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; set the same URL and the **service-role key** in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Never expose the service-role key as a `VITE_` variable.
3. In Supabase SQL Editor, run `supabase/migrations/0001_booking_system.sql`. Enable email confirmation in Supabase Auth.
4. Install and start: `npm install`, then `npm run dev`. Open `http://localhost:5173` (API: `http://localhost:3001/api/health`).

Without Supabase credentials the marketing and booking screens load, but account, booking, and API actions are intentionally disabled.

## Docker development

After creating `.env`, run `docker compose up --build` and open `http://localhost:5173`. The container runs Vite and the watched Node API together. Stop with `docker compose down`.

## Booking and payments

Players must verify email or phone before a booking hold. `create_booking_hold` checks venue hours, booking limits, maintenance windows, current holds, and overlapping confirmed reservations in a database transaction. A hold lasts five minutes by default; expired holds are cancelled and the court is released. Schedule the migration's `expire-booking-holds` pg_cron job (every minute) for release when the app is idle. Late payments keep their booking cancelled and are marked `REVIEW_REQUIRED`; staff can record an applied payment or arranged refund without creating player credit.

Compare Xendit and PayMongo for merchant eligibility, GCash/bank/QR coverage, checkout, current fees, settlement, and refunds before selecting a provider. Add provider secrets only on the server. Implement and verify that provider's signed webhook, idempotency and event mapping before enabling checkout; a browser redirect is not payment confirmation. The API deliberately does not accept client-reported payment success.

The migration includes staff/admin data structures, audit log, support and booking requests, saved policy snapshots, an optional reminder scheduler, and role-protected API routes. Create the first owner by updating that user's `profiles.role` to `ADMIN` in Supabase SQL Editor. Add staff the same way with `STAFF`; staff cannot access admin settings or revenue endpoints. The owner can manage court prices, active courts, policies, reminder timing, and team roles from Venue settings. Staff can review cancellation requests and see booking/payment review items. Schedule the migration's reminder job if pg_cron is enabled, then connect an email sender to unsent `notification_log` entries. Phone verification and provider-specific checkout still need deployment configuration before production use. Rescheduling approval records its decision and note; staff should create and link the replacement booking as part of that workflow.

## Useful commands

- `npm run dev` — Vite and Node API with reload
- `npm run build` — production frontend build
- `npm start` — API server
- `npm run check` — Node syntax checks

Do not deploy until RLS is reviewed against your operational workflow, provider webhooks are fully implemented, Supabase Auth redirects are configured, and live booking/payment flows are verified.

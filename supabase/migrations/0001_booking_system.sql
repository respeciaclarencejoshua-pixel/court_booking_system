create extension if not exists pgcrypto;

do $$ begin
  create type public.user_role as enum ('PLAYER', 'STAFF', 'ADMIN');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.booking_status as enum ('HOLD', 'CONFIRMED', 'CANCELLED');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.payment_status as enum ('PENDING', 'CONFIRMED', 'FAILED', 'REVIEW_REQUIRED', 'REFUND_ARRANGED');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.request_status as enum ('PENDING', 'APPROVED', 'REJECTED');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  phone_verified_at timestamptz,
  email_verified_at timestamptz,
  role public.user_role not null default 'PLAYER',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.venue_settings (
  id integer primary key default 1 check (id = 1),
  venue_name text not null default 'Dink Club',
  timezone text not null default 'Asia/Manila',
  advance_booking_days integer not null default 30 check (advance_booking_days between 1 and 365),
  hold_minutes integer not null default 5 check (hold_minutes between 1 and 15),
  minimum_duration_hours integer not null default 1 check (minimum_duration_hours > 0),
  maximum_duration_hours integer not null default 4 check (maximum_duration_hours >= minimum_duration_hours),
  cancellation_hours integer not null default 24 check (cancellation_hours between 0 and 720),
  reminder_enabled boolean not null default true,
  reminder_hours integer not null default 24 check (reminder_hours between 0 and 168),
  policies jsonb not null default '{"cancellation":"Cancellation or rescheduling requests are reviewed by staff. Requests inside the venue cancellation window may not qualify for a refund.","refund":"Approved refunds are arranged manually; player account credit is not issued by the system.","no_show":"No-show bookings are not automatically refunded."}'::jsonb,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
insert into public.venue_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.courts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  price_per_hour numeric(10,2) not null check (price_per_hour >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.courts (name, description, price_per_hour) values
  ('Court 01', 'Indoor · Pro surface', 450),
  ('Court 02', 'Indoor · Pro surface', 450),
  ('Court 03', 'Outdoor · Sunset side', 350),
  ('Court 04', 'Outdoor · Sunset side', 350)
on conflict (name) do nothing;

create table if not exists public.operating_hours (
  id uuid primary key default gen_random_uuid(),
  weekday smallint not null check (weekday between 0 and 6),
  open_time time not null,
  close_time time not null,
  closed boolean not null default false,
  unique (weekday),
  check (close_time > open_time)
);
insert into public.operating_hours (weekday, open_time, close_time) select d, '07:00', '22:00' from generate_series(0,6) d on conflict (weekday) do nothing;

create table if not exists public.unavailable_periods (
  id uuid primary key default gen_random_uuid(),
  court_id uuid references public.courts(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles(id),
  court_id uuid not null references public.courts(id),
  booking_date date not null,
  start_time time not null,
  duration_hours smallint not null check (duration_hours between 1 and 4),
  total_price numeric(10,2) not null check (total_price >= 0),
  status public.booking_status not null default 'HOLD',
  hold_expires_at timestamptz,
  payment_status public.payment_status not null default 'PENDING',
  original_booking_id uuid references public.bookings(id),
  policy_snapshot jsonb not null default '{}'::jsonb,
  cancellation_note text,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bookings_player_created_idx on public.bookings (player_id, created_at desc);
create index if not exists bookings_court_date_idx on public.bookings (court_id, booking_date, start_time);
create index if not exists bookings_live_hold_idx on public.bookings (hold_expires_at) where status = 'HOLD';

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id),
  provider text not null,
  provider_payment_id text unique,
  amount numeric(10,2) not null check (amount >= 0),
  currency text not null default 'PHP',
  status public.payment_status not null default 'PENDING',
  receipt_reference text,
  checkout_url text,
  verified_notification jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payments_booking_created_idx on public.payments (booking_id, created_at desc);

create table if not exists public.booking_requests (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id),
  player_id uuid not null references public.profiles(id),
  type text not null check (type in ('CANCELLATION', 'RESCHEDULING')),
  message text not null,
  status public.request_status not null default 'PENDING',
  staff_note text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  replacement_booking_id uuid references public.bookings(id),
  created_at timestamptz not null default now()
);
create index if not exists booking_requests_player_idx on public.booking_requests (player_id, created_at desc);

create table if not exists public.payment_adjustments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id),
  payment_id uuid references public.payments(id),
  staff_id uuid not null references public.profiles(id),
  type text not null check (type in ('APPLIED_TO_BOOKING', 'REFUND_ARRANGED')),
  amount numeric(10,2) not null check (amount > 0),
  reference text,
  staff_note text not null,
  created_at timestamptz not null default now(),
  check (booking_id is not null or payment_id is not null)
);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles(id),
  contact_email text,
  message text not null,
  status text not null default 'OPEN' check (status in ('OPEN', 'IN_PROGRESS', 'RESOLVED')),
  staff_note text,
  handled_by uuid references public.profiles(id),
  handled_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_entity_idx on public.audit_log (entity_type, entity_id, created_at desc);

create table if not exists public.notification_log (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles(id),
  booking_id uuid references public.bookings(id),
  channel text not null check (channel in ('WEBSITE', 'EMAIL', 'SMS')),
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.create_player_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email_verified_at)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), new.email_confirmed_at)
  on conflict (id) do update set email_verified_at = excluded.email_verified_at;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert or update of email_confirmed_at on auth.users for each row execute function public.create_player_profile();

create or replace function public.expire_booking_holds()
returns integer language plpgsql security definer set search_path = public as $$
declare changed integer;
begin
  update public.bookings set status = 'CANCELLED', payment_status = case when payment_status = 'PENDING' then 'REVIEW_REQUIRED' else payment_status end,
    cancellation_note = 'Payment hold ended before provider confirmation.', cancelled_at = now(), updated_at = now()
  where status = 'HOLD' and hold_expires_at <= now();
  get diagnostics changed = row_count;
  insert into public.notification_log (player_id, booking_id, channel, type, payload)
  select b.player_id, b.id, 'WEBSITE', 'HOLD_EXPIRED', jsonb_build_object('message','Your hold ended and booking was cancelled. Save your payment receipt and contact support if payment went through.')
  from public.bookings b where b.status = 'CANCELLED' and b.cancelled_at >= now() - interval '2 seconds'
    and b.cancellation_note = 'Payment hold ended before provider confirmation.';
  return changed;
end;
$$;

create or replace function public.create_booking_hold(p_player_id uuid, p_court_id uuid, p_booking_date date, p_start_time time, p_duration_hours integer)
returns public.bookings language plpgsql security definer set search_path = public as $$
declare court_row public.courts; settings_row public.venue_settings; new_booking public.bookings; slot_start timestamptz; slot_end timestamptz;
begin
  perform public.expire_booking_holds();
  select * into court_row from public.courts where id = p_court_id and active for update;
  if not found then raise exception 'Court is unavailable.'; end if;
  select * into settings_row from public.venue_settings where id = 1;
  if p_booking_date < current_date or p_booking_date > current_date + settings_row.advance_booking_days then raise exception 'This date is outside the booking window.'; end if;
  if p_duration_hours < settings_row.minimum_duration_hours or p_duration_hours > settings_row.maximum_duration_hours then raise exception 'This rental duration is unavailable.'; end if;
  if p_start_time + make_interval(hours => p_duration_hours) > time '22:00' or p_start_time < time '07:00' then raise exception 'This time is outside venue operating hours.'; end if;
  slot_start := (p_booking_date + p_start_time) at time zone settings_row.timezone;
  slot_end := slot_start + make_interval(hours => p_duration_hours);
  if exists (select 1 from public.operating_hours oh where oh.weekday = extract(dow from p_booking_date)::smallint and (oh.closed or p_start_time < oh.open_time or p_start_time + make_interval(hours => p_duration_hours) > oh.close_time)) then raise exception 'Venue is closed or outside operating hours.'; end if;
  if exists (select 1 from public.unavailable_periods up where (up.court_id is null or up.court_id = p_court_id) and tstzrange(up.starts_at, up.ends_at, '[)') && tstzrange(slot_start, slot_end, '[)')) then raise exception 'This court is unavailable during maintenance.'; end if;
  if exists (select 1 from public.bookings b where b.court_id = p_court_id and b.booking_date = p_booking_date and b.status in ('HOLD','CONFIRMED') and (b.status <> 'HOLD' or b.hold_expires_at > now()) and tstzrange((b.booking_date + b.start_time) at time zone settings_row.timezone, ((b.booking_date + b.start_time) at time zone settings_row.timezone) + make_interval(hours => b.duration_hours), '[)') && tstzrange(slot_start, slot_end, '[)')) then raise exception 'This court and time is no longer available.'; end if;
  insert into public.bookings (player_id, court_id, booking_date, start_time, duration_hours, total_price, status, hold_expires_at, policy_snapshot)
  values (p_player_id, p_court_id, p_booking_date, p_start_time, p_duration_hours, court_row.price_per_hour * p_duration_hours, 'HOLD', now() + make_interval(mins => settings_row.hold_minutes), settings_row.policies)
  returning * into new_booking;
  insert into public.payments (booking_id, provider, amount, currency, status) values (new_booking.id, 'PENDING_PROVIDER', new_booking.total_price, 'PHP', 'PENDING');
  insert into public.notification_log (player_id, booking_id, channel, type, payload) values (p_player_id, new_booking.id, 'WEBSITE', 'BOOKING_HOLD_STARTED', jsonb_build_object('hold_expires_at', new_booking.hold_expires_at, 'total_price', new_booking.total_price));
  insert into public.audit_log (actor_id, action, entity_type, entity_id, metadata) values (p_player_id, 'BOOKING_HOLD_CREATED', 'booking', new_booking.id::text, jsonb_build_object('court_id',p_court_id,'date',p_booking_date,'start_time',p_start_time,'duration_hours',p_duration_hours,'total_price',new_booking.total_price));
  return new_booking;
end;
$$;

create or replace function public.prepare_payment_checkout(p_player_id uuid, p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare row_booking public.bookings;
begin
  perform public.expire_booking_holds();
  select * into row_booking from public.bookings where id = p_booking_id and player_id = p_player_id for update;
  if not found or row_booking.status <> 'HOLD' or row_booking.hold_expires_at <= now() then raise exception 'Booking hold has ended. Make a new booking or contact staff if payment was received.'; end if;
  return jsonb_build_object('id',row_booking.id,'amount',row_booking.total_price,'hold_expires_at',row_booking.hold_expires_at);
end;
$$;

create or replace function public.confirm_provider_payment(p_provider text, p_provider_payment_id text, p_receipt_reference text, p_payload jsonb)
returns public.bookings language plpgsql security definer set search_path = public as $$
declare payment_row public.payments; booking_row public.bookings;
begin
  select * into payment_row from public.payments where provider_payment_id = p_provider_payment_id for update;
  if not found or payment_row.provider <> p_provider then raise exception 'Payment reference is unknown.'; end if;
  update public.payments set status = 'CONFIRMED', receipt_reference = p_receipt_reference, verified_notification = p_payload, updated_at = now() where id = payment_row.id;
  select * into booking_row from public.bookings where id = payment_row.booking_id for update;
  if booking_row.status = 'HOLD' and booking_row.hold_expires_at > now() then
    update public.bookings set status = 'CONFIRMED', payment_status = 'CONFIRMED', updated_at = now() where id = booking_row.id returning * into booking_row;
    insert into public.notification_log (player_id, booking_id, channel, type, payload) values (booking_row.player_id, booking_row.id, 'WEBSITE', 'BOOKING_CONFIRMED', jsonb_build_object('receipt_reference',p_receipt_reference,'amount',payment_row.amount));
    insert into public.audit_log (actor_id, action, entity_type, entity_id, metadata) values (null, 'PROVIDER_PAYMENT_CONFIRMED', 'booking', booking_row.id::text, jsonb_build_object('provider',p_provider,'payment_id',p_provider_payment_id));
  else
    update public.bookings set status = 'CANCELLED', payment_status = 'REVIEW_REQUIRED', cancellation_note = 'Payment received after hold ended; staff review required.', cancelled_at = coalesce(cancelled_at,now()), updated_at = now() where id = booking_row.id returning * into booking_row;
    insert into public.notification_log (player_id, booking_id, channel, type, payload) values (booking_row.player_id, booking_row.id, 'WEBSITE', 'LATE_PAYMENT_REVIEW_REQUIRED', jsonb_build_object('receipt_reference',p_receipt_reference,'message','Your hold ended and booking was cancelled. Save your payment receipt and contact staff.'));
  end if;
  return booking_row;
end;
$$;

create or replace function public.review_booking_request(p_request_id uuid, p_staff_id uuid, p_decision public.request_status, p_staff_note text)
returns public.booking_requests language plpgsql security definer set search_path = public as $$
declare request_row public.booking_requests;
begin
  if p_decision = 'PENDING' then raise exception 'Choose approve or reject.'; end if;
  update public.booking_requests set status = p_decision, staff_note = p_staff_note, reviewed_by = p_staff_id, reviewed_at = now() where id = p_request_id and status = 'PENDING' returning * into request_row;
  if not found then raise exception 'Request not found or already reviewed.'; end if;
  if p_decision = 'APPROVED' and request_row.type = 'CANCELLATION' then
    update public.bookings set status = 'CANCELLED', cancellation_note = p_staff_note, cancelled_at = now(), cancelled_by = p_staff_id, updated_at = now() where id = request_row.booking_id and status = 'CONFIRMED';
  end if;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, metadata) values (p_staff_id, 'BOOKING_REQUEST_REVIEWED', 'booking_request', request_row.id::text, jsonb_build_object('decision',p_decision,'note',p_staff_note));
  insert into public.notification_log (player_id, booking_id, channel, type, payload) values (request_row.player_id, request_row.booking_id, 'WEBSITE', 'BOOKING_REQUEST_REVIEWED', jsonb_build_object('status',p_decision,'staff_note',p_staff_note));
  return request_row;
end;
$$;

create or replace function public.create_24h_booking_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare settings_row public.venue_settings; made integer;
begin
  select * into settings_row from public.venue_settings where id = 1;
  if not settings_row.reminder_enabled then return 0; end if;
  insert into public.notification_log (player_id, booking_id, channel, type, payload)
  select b.player_id, b.id, 'EMAIL', 'BOOKING_REMINDER', jsonb_build_object('booking_id',b.id,'date',b.booking_date,'time',b.start_time,'court_id',b.court_id)
  from public.bookings b where b.status = 'CONFIRMED' and (b.booking_date + b.start_time) between (now() at time zone settings_row.timezone) + make_interval(hours => settings_row.reminder_hours - 1) and (now() at time zone settings_row.timezone) + make_interval(hours => settings_row.reminder_hours + 1)
    and not exists (select 1 from public.notification_log n where n.booking_id = b.id and n.type = 'BOOKING_REMINDER');
  get diagnostics made = row_count;
  return made;
end;
$$;

alter table public.profiles enable row level security;
alter table public.venue_settings enable row level security;
alter table public.courts enable row level security;
alter table public.operating_hours enable row level security;
alter table public.unavailable_periods enable row level security;
alter table public.bookings enable row level security;
alter table public.payments enable row level security;
alter table public.booking_requests enable row level security;
alter table public.payment_adjustments enable row level security;
alter table public.support_messages enable row level security;
alter table public.audit_log enable row level security;
alter table public.notification_log enable row level security;

drop policy if exists "Players read own profile" on public.profiles;
create policy "Players read own profile" on public.profiles for select using (auth.uid() = id or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('STAFF','ADMIN')));
drop policy if exists "Players update own contact" on public.profiles;
create policy "Players update own contact" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id and role = (select p.role from public.profiles p where p.id = auth.uid()));
drop policy if exists "Public read active courts" on public.courts;
create policy "Public read active courts" on public.courts for select using (active = true or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='ADMIN'));
drop policy if exists "Public read operating hours" on public.operating_hours;
create policy "Public read operating hours" on public.operating_hours for select using (true);
drop policy if exists "Players read own bookings" on public.bookings;
create policy "Players read own bookings" on public.bookings for select using (auth.uid() = player_id or exists (select 1 from public.profiles p where p.id=auth.uid() and p.role in ('STAFF','ADMIN')));
drop policy if exists "Players read own payments" on public.payments;
create policy "Players read own payments" on public.payments for select using (exists(select 1 from public.bookings b where b.id=booking_id and (b.player_id=auth.uid() or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('STAFF','ADMIN')))));
drop policy if exists "Players read own requests" on public.booking_requests;
create policy "Players read own requests" on public.booking_requests for select using (player_id=auth.uid() or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('STAFF','ADMIN')));
drop policy if exists "Players create own requests" on public.booking_requests;
create policy "Players create own requests" on public.booking_requests for insert with check (player_id=auth.uid());
drop policy if exists "Players read own support messages" on public.support_messages;
create policy "Players read own support messages" on public.support_messages for select using (player_id=auth.uid() or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('STAFF','ADMIN')));
drop policy if exists "Players create own support messages" on public.support_messages;
create policy "Players create own support messages" on public.support_messages for insert with check (player_id=auth.uid());
drop policy if exists "Staff view payment adjustments" on public.payment_adjustments;
create policy "Staff view payment adjustments" on public.payment_adjustments for select using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('STAFF','ADMIN')));
drop policy if exists "Owners view revenue" on public.payments;
create policy "Owners view revenue" on public.payments for all using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='ADMIN')) with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='ADMIN'));
drop policy if exists "Owners read venue settings" on public.venue_settings;
create policy "Owners read venue settings" on public.venue_settings for select using (true);

grant usage on schema public to anon, authenticated;
grant select on public.courts, public.operating_hours, public.venue_settings to anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.bookings, public.payments, public.booking_requests, public.support_messages to authenticated;
grant insert on public.booking_requests, public.support_messages to authenticated;
revoke all on function public.create_booking_hold(uuid,uuid,date,time,integer) from public, anon, authenticated;
grant execute on function public.create_booking_hold(uuid,uuid,date,time,integer) to service_role;
revoke all on function public.prepare_payment_checkout(uuid,uuid) from public, anon, authenticated;
grant execute on function public.prepare_payment_checkout(uuid,uuid) to service_role;
revoke all on function public.confirm_provider_payment(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.confirm_provider_payment(text,text,text,jsonb) to service_role;
revoke all on function public.review_booking_request(uuid,uuid,public.request_status,text) from public, anon, authenticated;
grant execute on function public.review_booking_request(uuid,uuid,public.request_status,text) to service_role;

-- Run with pg_cron enabled for automated hold release and 24-hour reminders:
-- select cron.schedule('expire-booking-holds', '* * * * *', $$select public.expire_booking_holds()$$);
-- select cron.schedule('send-booking-reminders', '*/15 * * * *', $$select public.create_24h_booking_reminders()$$);

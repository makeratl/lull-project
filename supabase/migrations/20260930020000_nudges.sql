-- Lull: daily breathing nudges (Web Push), for people who turn them on.
--
--   push_subscriptions  the phone's push endpoint(s), per person (a person may have several devices)
--   nudge_settings      on/off, up to 3 local times, which days, time zone, and the daily goal
--   nudge_sent          one row per person, day and time slot, so each nudge is sent (or skipped) once
--
-- Every 15 minutes pg_cron asks the app's /api/nudge to send what's due. The URL and shared secret come
-- from Supabase Vault (secrets 'nudge_url' and 'nudge_secret'), set once per environment; see README.
-- A nudge is skipped when the person has already met today's goal.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user on public.push_subscriptions (user_id);

create table public.nudge_settings (
  user_id uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  enabled boolean not null default false,
  -- Local times, 'HH:MM'.
  times text[] not null default '{08:00,13:00,21:00}'
    check (cardinality(times) between 1 and 3 and array_to_string(times, ',') ~ '^([01][0-9]|2[0-3]):[0-5][0-9](,([01][0-9]|2[0-3]):[0-5][0-9])*$'),
  -- 0 = Sunday … 6 = Saturday.
  days smallint[] not null default '{0,1,2,3,4,5,6}' check (cardinality(days) between 1 and 7 and days <@ '{0,1,2,3,4,5,6}'),
  tz text not null default 'UTC' check (char_length(tz) between 1 and 64),
  goal int not null default 15 check (goal between 1 and 120),
  updated_at timestamptz not null default now()
);

create table public.nudge_sent (
  user_id uuid not null references public.profiles (id) on delete cascade,
  local_date date not null,
  slot text not null,
  outcome text not null check (outcome in ('sent', 'skipped_goal', 'no_device', 'failed')),
  at timestamptz not null default now(),
  primary key (user_id, local_date, slot)
);

alter table public.push_subscriptions enable row level security;
alter table public.nudge_settings enable row level security;
alter table public.nudge_sent enable row level security;

create policy "own subscriptions: read" on public.push_subscriptions for select using (user_id = auth.uid());
create policy "own subscriptions: add" on public.push_subscriptions for insert with check (user_id = auth.uid());
create policy "own subscriptions: remove" on public.push_subscriptions for delete using (user_id = auth.uid());

create policy "own settings: read" on public.nudge_settings for select using (user_id = auth.uid());
create policy "own settings: add" on public.nudge_settings for insert with check (user_id = auth.uid());
create policy "own settings: change" on public.nudge_settings for update using (user_id = auth.uid()) with check (user_id = auth.uid());
-- nudge_sent is the server's bookkeeping: no policies, so the app can't read or write it.

-- ── the scheduler ──
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function public.nudge_tick() returns void
language plpgsql security definer set search_path = public as $$
declare
  u text := (select decrypted_secret from vault.decrypted_secrets where name = 'nudge_url');
  s text := (select decrypted_secret from vault.decrypted_secrets where name = 'nudge_secret');
begin
  -- Not configured in this environment (e.g. a fresh local stack): do nothing.
  if u is null or s is null then return; end if;
  perform net.http_post(url := u, headers := jsonb_build_object('content-type', 'application/json', 'x-nudge-secret', s), body := '{}'::jsonb);
end $$;
revoke all on function public.nudge_tick() from public, anon, authenticated;

select cron.schedule('lull-nudges', '*/15 * * * *', 'select public.nudge_tick()');

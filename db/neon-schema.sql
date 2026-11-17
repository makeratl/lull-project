-- ==== 20260929000000_core.sql
-- Lull: invite-only accounts. Adapted from wellofwyrd's core schema, trimmed to what Lull needs:
--   * profiles keyed to auth.users, with a role (only admins invite) and a status (suspension)
--   * single-use invitation codes that never expire; admins can revoke open ones
--   * an IP brute-force guard and an admin audit log
-- All sound, mixes and settings stay on the device; nothing about listening is stored here.

create extension if not exists citext;
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references neon_auth."user" (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  email citext not null unique,
  role text not null default 'member' check (role in ('member', 'admin')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  invited_by uuid references public.profiles (id) on delete set null,
  joined_at timestamptz not null default now(),
  suspended_at timestamptz
);
create index profiles_invited_by on public.profiles (invited_by);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  created_by uuid references public.profiles (id) on delete set null,
  for_whom text check (char_length(for_whom) <= 120),
  status text not null default 'open' check (status in ('open', 'redeemed', 'revoked')),
  redeemed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  redeemed_at timestamptz
);
create index invitations_created_at on public.invitations (created_at desc);

create table public.ip_attempts (
  id bigserial primary key,
  ip text not null,
  action text not null,
  created_at timestamptz not null default now()
);
create index ip_attempts_lookup on public.ip_attempts (ip, action, created_at);

create table public.admin_audit_log (
  id bigserial primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (action in ('invite_create', 'invite_revoke', 'suspend', 'reactivate', 'reset_link')),
  target_user_id uuid references public.profiles (id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ─────────────────────────── RLS ───────────────────────────
alter table public.profiles enable row level security;
alter table public.invitations enable row level security;
alter table public.ip_attempts enable row level security;
alter table public.admin_audit_log enable row level security;

-- Members can read their own profile (the app checks status with it). Everything else goes through the server.
create policy "own profile" on public.profiles for select using (id = auth.uid());

-- ─────────────────────────── invitations ───────────────────────────
create or replace function public.new_invite_code() returns text
language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  out text;
begin
  loop
    select string_agg(substr(alphabet, 1 + (get_byte(b, i) % 32), 1), '')
      into out
      from (select gen_random_bytes(8) as b) r, generate_series(0, 7) as i;
    exit when not exists (select 1 from public.invitations where code = out);
  end loop;
  return out;
end $$;
revoke all on function public.new_invite_code() from public, anonymous, authenticated;

-- Only active admins create invitations (called by the server after it has checked the caller's token).
create or replace function public.create_invitation(p_by uuid, p_for text default null)
returns public.invitations
language plpgsql security definer set search_path = public as $$
declare
  inv public.invitations;
begin
  if not exists (select 1 from public.profiles where id = p_by and role = 'admin' and status = 'active') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.invitations (code, created_by, for_whom)
    values (public.new_invite_code(), p_by, nullif(trim(p_for), ''))
    returning * into inv;
  return inv;
end $$;
revoke all on function public.create_invitation(uuid, text) from public, anonymous, authenticated;

-- Validate a code (public, via the server). Returns the inviter's name.
create or replace function public.check_invitation(p_code text)
returns table (status text, inviter_name text)
language sql stable security definer set search_path = public as $$
  select i.status, coalesce(p.name, 'Lull')
  from public.invitations i left join public.profiles p on p.id = i.created_by
  where i.code = upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g'))
$$;
revoke all on function public.check_invitation(text) from public, anonymous, authenticated;

-- Atomic redemption: lock the invitation, create the profile, mark it redeemed.
create or replace function public.redeem_invitation(p_code text, p_user uuid, p_name text, p_email text)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  inv public.invitations;
  prof public.profiles;
begin
  select * into inv from public.invitations
    where code = upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g')) for update;
  if inv.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if inv.status <> 'open' then raise exception 'used' using errcode = 'P0001'; end if;
  insert into public.profiles (id, name, email, invited_by)
    values (p_user, trim(p_name), lower(p_email), inv.created_by)
    returning * into prof;
  update public.invitations set status = 'redeemed', redeemed_by = p_user, redeemed_at = now() where id = inv.id;
  return prof;
end $$;
revoke all on function public.redeem_invitation(text, uuid, text, text) from public, anonymous, authenticated;

-- IP brute-force guard: returns true when the attempt is allowed (and records it).
create or replace function public.ip_attempt(p_ip text, p_action text, p_max int, p_window_sec int)
returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform pg_advisory_xact_lock(hashtext('ip:' || p_ip || ':' || p_action));
  delete from public.ip_attempts where created_at < now() - interval '1 day';
  select count(*) into n from public.ip_attempts
    where ip = p_ip and action = p_action and created_at > now() - make_interval(secs => p_window_sec);
  if n >= p_max then return false; end if;
  insert into public.ip_attempts (ip, action) values (p_ip, p_action);
  return true;
end $$;
revoke all on function public.ip_attempt(text, text, int, int) from public, anonymous, authenticated;

-- ==== 20260930000000_relax_sessions.sql
-- Lull: a practice log of breathing sessions, for streaks and a calendar on the Relax screen.
--
-- The one exception to "nothing about listening is stored": a breathing session's pattern, start time,
-- length, rounds and whether it ran to the end. Never sounds, mixes or anything else. Only the person
-- themselves can read, add or remove their rows (RLS); the app writes them directly with the user's token.
--
-- Ids are made on the device, so a session logged offline and uploaded twice is stored once.

create table public.relax_sessions (
  id uuid primary key,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  pattern text not null check (pattern in ('478', 'box', 'even')),
  started_at timestamptz not null,
  seconds int not null check (seconds between 60 and 86400),
  rounds int not null default 0 check (rounds >= 0),
  planned_min int not null default 0 check (planned_min >= 0),
  completed boolean not null,
  created_at timestamptz not null default now()
);
create index relax_sessions_user_started on public.relax_sessions (user_id, started_at desc);

alter table public.relax_sessions enable row level security;

create policy "own sessions: read" on public.relax_sessions for select using (user_id = auth.uid());
create policy "own sessions: add" on public.relax_sessions for insert with check (user_id = auth.uid());
create policy "own sessions: remove" on public.relax_sessions for delete using (user_id = auth.uid());

-- ==== 20260930010000_member_sharing.sql
-- Lull: members can share Lull too, and the invitations form a family tree.
--
-- The tree already exists: a profile's invited_by is whoever created the code it joined with. This adds:
--   * members creating invites: single use, up to 5 open at a time, expiring after 30 days unused
--     (admins: unlimited and never expiring, as before)
--   * a per-person switch an admin can turn off (profiles.can_share)
--   * expired codes refused at check and at redemption

alter table public.profiles add column can_share boolean not null default true;
alter table public.invitations add column expires_at timestamptz;
create index invitations_created_by_open on public.invitations (created_by) where status = 'open';

alter table public.admin_audit_log drop constraint admin_audit_log_action_check;
alter table public.admin_audit_log add constraint admin_audit_log_action_check
  check (action in ('invite_create', 'invite_revoke', 'suspend', 'reactivate', 'reset_link', 'sharing_on', 'sharing_off'));

-- Who may create an invitation, and on what terms. Called by the server after it has checked the caller's token.
create or replace function public.create_invitation(p_by uuid, p_for text default null)
returns public.invitations
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  inv public.invitations;
  open_count int;
begin
  select * into me from public.profiles where id = p_by;
  if me.id is null or me.status <> 'active' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if me.role = 'admin' then
    insert into public.invitations (code, created_by, for_whom)
      values (public.new_invite_code(), p_by, nullif(trim(p_for), ''))
      returning * into inv;
    return inv;
  end if;
  if not me.can_share then
    raise exception 'sharing_off' using errcode = '42501';
  end if;
  -- Serialise this member's invite creation, so two taps can't both slip under the limit.
  perform pg_advisory_xact_lock(hashtext('invite:' || p_by::text));
  select count(*) into open_count from public.invitations
    where created_by = p_by and status = 'open' and (expires_at is null or expires_at > now());
  if open_count >= 5 then
    raise exception 'limit' using errcode = 'P0001';
  end if;
  insert into public.invitations (code, created_by, for_whom, expires_at)
    values (public.new_invite_code(), p_by, nullif(trim(p_for), ''), now() + interval '30 days')
    returning * into inv;
  return inv;
end $$;
revoke all on function public.create_invitation(uuid, text) from public, anonymous, authenticated;

-- Validate a code (public, via the server). An open code past its date reads as 'expired'.
drop function public.check_invitation(text);
create function public.check_invitation(p_code text)
returns table (status text, inviter_name text)
language sql stable security definer set search_path = public as $$
  select case when i.status = 'open' and i.expires_at < now() then 'expired' else i.status end,
         coalesce(p.name, 'Lull')
  from public.invitations i left join public.profiles p on p.id = i.created_by
  where i.code = upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g'))
$$;
revoke all on function public.check_invitation(text) from public, anonymous, authenticated;

-- Atomic redemption, now refusing expired codes.
create or replace function public.redeem_invitation(p_code text, p_user uuid, p_name text, p_email text)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  inv public.invitations;
  prof public.profiles;
begin
  select * into inv from public.invitations
    where code = upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g')) for update;
  if inv.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if inv.status <> 'open' then raise exception 'used' using errcode = 'P0001'; end if;
  if inv.expires_at < now() then raise exception 'expired' using errcode = 'P0001'; end if;
  insert into public.profiles (id, name, email, invited_by)
    values (p_user, trim(p_name), lower(p_email), inv.created_by)
    returning * into prof;
  update public.invitations set status = 'redeemed', redeemed_by = p_user, redeemed_at = now() where id = inv.id;
  return prof;
end $$;
revoke all on function public.redeem_invitation(text, uuid, text, text) from public, anonymous, authenticated;

-- ==== 20260930020000_nudges.sql
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
-- Neon: the pg_cron + pg_net + Vault scheduler is gone; .github/workflows/nudge.yml calls /api/nudge every 15 minutes.


-- ==== 20261003000000_group_invites.sql
-- Lull: group invites. An admin can make one code (QR and link) that several people can join with:
-- up to a number they choose, or with no limit until it's revoked. Members' invites stay single use.
--
--   * invitations.max_uses: how many people can join with it (1 by default); null means no limit
--   * invitations.uses: how many have
--   * profiles.invitation_id: the invite each person joined with, so a group link can list who came through it
--
-- An invite stays 'open' while it has room, and becomes 'redeemed' when its last place is taken.
-- redeemed_by and redeemed_at keep meaning "who joined, and when" for single-use invites; for a group link
-- redeemed_at is the latest join.

alter table public.invitations add column max_uses int default 1 check (max_uses is null or max_uses >= 1);
alter table public.invitations add column uses int not null default 0 check (uses >= 0);
update public.invitations set uses = 1 where status = 'redeemed';

alter table public.profiles add column invitation_id uuid references public.invitations (id) on delete set null;
create index profiles_invitation_id on public.profiles (invitation_id);
update public.profiles p set invitation_id = i.id from public.invitations i where i.redeemed_by = p.id;

-- Who may create an invitation, and on what terms. Called by the server after it has checked the caller's token.
-- Only admins choose max_uses; a member's invite is always single use.
drop function public.create_invitation(uuid, text);
create function public.create_invitation(p_by uuid, p_for text default null, p_max_uses int default 1)
returns public.invitations
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  inv public.invitations;
  open_count int;
begin
  select * into me from public.profiles where id = p_by;
  if me.id is null or me.status <> 'active' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if me.role = 'admin' then
    if p_max_uses is not null and p_max_uses < 1 then
      raise exception 'bad_max_uses' using errcode = '22023';
    end if;
    insert into public.invitations (code, created_by, for_whom, max_uses)
      values (public.new_invite_code(), p_by, nullif(trim(p_for), ''), p_max_uses)
      returning * into inv;
    return inv;
  end if;
  if not me.can_share then
    raise exception 'sharing_off' using errcode = '42501';
  end if;
  -- Serialise this member's invite creation, so two taps can't both slip under the limit.
  perform pg_advisory_xact_lock(hashtext('invite:' || p_by::text));
  select count(*) into open_count from public.invitations
    where created_by = p_by and status = 'open' and (expires_at is null or expires_at > now());
  if open_count >= 5 then
    raise exception 'limit' using errcode = 'P0001';
  end if;
  insert into public.invitations (code, created_by, for_whom, expires_at)
    values (public.new_invite_code(), p_by, nullif(trim(p_for), ''), now() + interval '30 days')
    returning * into inv;
  return inv;
end $$;
revoke all on function public.create_invitation(uuid, text, int) from public, anonymous, authenticated;

-- Atomic redemption: the row lock makes concurrent joins on a group link take places one at a time.
create or replace function public.redeem_invitation(p_code text, p_user uuid, p_name text, p_email text)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  inv public.invitations;
  prof public.profiles;
  is_full boolean;
begin
  select * into inv from public.invitations
    where code = upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g')) for update;
  if inv.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if inv.status <> 'open' then raise exception 'used' using errcode = 'P0001'; end if;
  if inv.expires_at < now() then raise exception 'expired' using errcode = 'P0001'; end if;
  insert into public.profiles (id, name, email, invited_by, invitation_id)
    values (p_user, trim(p_name), lower(p_email), inv.created_by, inv.id)
    returning * into prof;
  is_full := inv.max_uses is not null and inv.uses + 1 >= inv.max_uses;
  update public.invitations
    set uses = uses + 1,
        status = case when is_full then 'redeemed' else 'open' end,
        redeemed_by = case when max_uses = 1 then p_user else redeemed_by end,
        redeemed_at = now()
    where id = inv.id;
  return prof;
end $$;
revoke all on function public.redeem_invitation(text, uuid, text, text) from public, anonymous, authenticated;


-- ==== Neon: table privileges for the Data API's `authenticated` role (Supabase granted these by default).
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;

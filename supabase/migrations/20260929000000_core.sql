-- Lull: invite-only accounts. Adapted from wellofwyrd's core schema, trimmed to what Lull needs:
--   * profiles keyed to auth.users, with a role (only admins invite) and a status (suspension)
--   * single-use invitation codes that never expire; admins can revoke open ones
--   * an IP brute-force guard and an admin audit log
-- All sound, mixes and settings stay on the device; nothing about listening is stored here.

create extension if not exists citext;
create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
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
      from (select extensions.gen_random_bytes(8) as b) r, generate_series(0, 7) as i;
    exit when not exists (select 1 from public.invitations where code = out);
  end loop;
  return out;
end $$;
revoke all on function public.new_invite_code() from public, anon, authenticated;

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
revoke all on function public.create_invitation(uuid, text) from public, anon, authenticated;

-- Validate a code (public, via the server). Returns the inviter's name.
create or replace function public.check_invitation(p_code text)
returns table (status text, inviter_name text)
language sql stable security definer set search_path = public as $$
  select i.status, coalesce(p.name, 'Lull')
  from public.invitations i left join public.profiles p on p.id = i.created_by
  where i.code = upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g'))
$$;
revoke all on function public.check_invitation(text) from public, anon, authenticated;

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
revoke all on function public.redeem_invitation(text, uuid, text, text) from public, anon, authenticated;

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
revoke all on function public.ip_attempt(text, text, int, int) from public, anon, authenticated;

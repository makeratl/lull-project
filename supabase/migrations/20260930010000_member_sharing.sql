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
revoke all on function public.create_invitation(uuid, text) from public, anon, authenticated;

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
revoke all on function public.check_invitation(text) from public, anon, authenticated;

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
revoke all on function public.redeem_invitation(text, uuid, text, text) from public, anon, authenticated;

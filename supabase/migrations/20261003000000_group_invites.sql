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
revoke all on function public.create_invitation(uuid, text, int) from public, anon, authenticated;

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
revoke all on function public.redeem_invitation(text, uuid, text, text) from public, anon, authenticated;

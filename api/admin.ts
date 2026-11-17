import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { appOrigin, audit, handle, HttpError, ok, parse, requireAdmin, sql, type Profile } from './_lib/http.js';
import { normalizeCode } from '../shared/codes.js';

/** Invitations and members, for the admin screen. */
export const GET = handle(async req => {
  await requireAdmin(req);
  const [invites, users] = await Promise.all([
    // Revoked invites are dead ends; the screen never shows them.
    sql`select id, code, for_whom, status, created_at, redeemed_at, redeemed_by, created_by, expires_at, max_uses, uses
        from invitations where status <> 'revoked' order by created_at desc limit 200`,
    sql`select * from profiles order by joined_at`,
  ]);
  const names = new Map((users as Profile[]).map(u => [u.id, u.name]));
  // Who came in through each group invite, in the order they joined.
  const joined = new Map<string, string[]>();
  for (const u of users as Profile[]) if (u.invitation_id) joined.set(u.invitation_id, [...(joined.get(u.invitation_id) ?? []), u.name]);
  return ok({
    invites: invites
      // An open invite past its date is as good as gone.
      .filter(i => !(i.status === 'open' && i.expires_at && i.expires_at < new Date().toISOString()))
      .map(({ id, ...i }) => ({
        ...i,
        joined: i.max_uses === 1 ? [] : joined.get(id) ?? [],
        redeemed_by_name: i.redeemed_by ? names.get(i.redeemed_by) ?? null : null,
        created_by_name: i.created_by ? names.get(i.created_by) ?? null : null,
      })),
    users,
  });
});

const action = z.discriminatedUnion('action', [
  // Every invite is for someone: the name is how the admin tells them apart later.
  // maxUses: how many people can join with it; null for no limit (a group link, until revoked).
  z.object({ action: z.literal('invite'), forWhom: z.string().trim().min(1).max(120), maxUses: z.number().int().min(1).max(10000).nullable().default(1) }),
  z.object({ action: z.literal('revoke'), code: z.string().max(20) }),
  z.object({ action: z.literal('suspend'), id: z.string().uuid() }),
  z.object({ action: z.literal('reactivate'), id: z.string().uuid() }),
  z.object({ action: z.literal('reset_link'), id: z.string().uuid() }),
  z.object({ action: z.literal('sharing'), id: z.string().uuid(), on: z.boolean() }),
]);

/** Admins act on members only: another admin can't be paused or have a reset link made (nor can you). */
const requireMemberTarget = async (id: string) => {
  const [data] = (await sql`select email, role from profiles where id = ${id}`) as { email: string; role: string }[];
  if (!data) throw new HttpError(404, 'not_found');
  if (data.role === 'admin') throw new HttpError(403, 'target_admin');
  return data;
};

export const POST = handle(async req => {
  const { profile: me } = await requireAdmin(req);
  const body = await parse(req, action);
  switch (body.action) {
    case 'invite': {
      const [data] = await sql`select * from public.create_invitation(${me.id}::uuid, ${body.forWhom}, ${body.maxUses}::int)`;
      await audit(me.id, 'invite_create', null, { code: data.code, max_uses: body.maxUses });
      return ok({ invite: data }, 201);
    }
    case 'revoke': {
      const code = normalizeCode(body.code);
      const data = await sql`update invitations set status = 'revoked' where code = ${code} and status = 'open' returning code`;
      if (!data.length) throw new HttpError(409, 'not_open');
      await audit(me.id, 'invite_revoke', null, { code });
      return ok({ revoked: code });
    }
    case 'suspend':
    case 'reactivate': {
      if (body.id === me.id) throw new HttpError(400, 'self');
      await requireMemberTarget(body.id);
      const suspend = body.action === 'suspend';
      await sql`update profiles set status = ${suspend ? 'suspended' : 'active'}, suspended_at = ${suspend ? new Date().toISOString() : null}
        where id = ${body.id}`;
      // Ban in Neon Auth and end their sessions, so the app signs them out on its next check.
      await sql`update neon_auth."user" set banned = ${suspend} where id = ${body.id}`;
      if (suspend) await sql`delete from neon_auth.session where "userId" = ${body.id}`;
      await audit(me.id, body.action, body.id);
      return ok({ id: body.id, status: suspend ? 'suspended' : 'active' });
    }
    case 'sharing': {
      await requireMemberTarget(body.id);
      await sql`update profiles set can_share = ${body.on} where id = ${body.id}`;
      await audit(me.id, body.on ? 'sharing_on' : 'sharing_off', body.id);
      return ok({ id: body.id, canShare: body.on });
    }
    case 'reset_link': {
      await requireMemberTarget(body.id);   // a member, not an admin
      // A one-time Neon Auth reset token, stored the way Neon Auth (Better Auth) stores its own:
      // identifier `reset-password:<token>`, value = the user id. It works once and lasts an hour.
      const token = randomBytes(18).toString('base64url');
      await sql`insert into neon_auth.verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
        values (gen_random_uuid(), ${'reset-password:' + token}, ${body.id}, now() + interval '1 hour', now(), now())`;
      await audit(me.id, 'reset_link', body.id);
      return ok({ link: `${appOrigin(req)}/reset?token=${encodeURIComponent(token)}` });
    }
  }
});

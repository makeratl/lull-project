import { z } from 'zod';
import { handle, HttpError, ok, parse, requireMember, sql } from './_lib/http.js';
import { normalizeCode } from '../shared/codes.js';
import { buildTree, countTree, type Person } from '../shared/tree.js';

/** How many unused invites a member may have waiting (admins: no limit). Mirrors create_invitation. */
export const MEMBER_OPEN_LIMIT = 5;

/** Your sharing: your open invites and your branch of the tree (names and join dates only). */
export const GET = handle(async req => {
  const { profile: me } = await requireMember(req);
  const [invites, people] = await Promise.all([
    sql`select code, for_whom, created_at, expires_at from invitations
        where created_by = ${me.id} and status = 'open' and (expires_at is null or expires_at > now())
        order by created_at desc`,
    sql`select id, name, invited_by, joined_at from profiles`,
  ]);
  const branch = buildTree(people as Person[], me.id);
  return ok({
    canShare: me.role === 'admin' || me.can_share,
    limit: me.role === 'admin' ? null : MEMBER_OPEN_LIMIT,
    invites,
    branch,
    branchSize: countTree(branch),
  });
});

const action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), forWhom: z.string().trim().max(120).optional() }),
  z.object({ action: z.literal('label'), code: z.string().max(20), forWhom: z.string().trim().max(120) }),
  z.object({ action: z.literal('revoke'), code: z.string().max(20) }),
]);

export const POST = handle(async req => {
  const { profile: me } = await requireMember(req);
  const body = await parse(req, action);
  switch (body.action) {
    case 'create': {
      try {
        const [invite] = await sql`select * from public.create_invitation(${me.id}::uuid, ${body.forWhom || null})`;
        return ok({ invite }, 201);
      } catch (e) {
        const m = e instanceof Error ? e.message : '';
        if (/limit/.test(m)) throw new HttpError(409, 'limit');
        if (/sharing_off/.test(m)) throw new HttpError(403, 'sharing_off');
        throw e;
      }
    }
    // Your own open invites only: name one after the fact, or take one back.
    case 'label':
    case 'revoke': {
      const code = normalizeCode(body.code);
      const data = body.action === 'label'
        ? await sql`update invitations set for_whom = ${body.forWhom || null} where code = ${code} and created_by = ${me.id} and status = 'open' returning code`
        : await sql`update invitations set status = 'revoked' where code = ${code} and created_by = ${me.id} and status = 'open' returning code`;
      if (!data.length) throw new HttpError(409, 'not_open');
      return ok({ code });
    }
  }
});

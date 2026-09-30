import { z } from 'zod';
import { handle, HttpError, ok, parse, requireMember, supabaseAdmin } from './_lib/http.js';
import { normalizeCode } from '../shared/codes.js';
import { buildTree, countTree, type Person } from '../shared/tree.js';

/** How many unused invites a member may have waiting (admins: no limit). Mirrors create_invitation. */
export const MEMBER_OPEN_LIMIT = 5;

/** Your sharing: your open invites and your branch of the tree (names and join dates only). */
export const GET = handle(async req => {
  const { profile: me } = await requireMember(req);
  const admin = supabaseAdmin();
  const [invites, people] = await Promise.all([
    admin
      .from('invitations')
      .select('code, for_whom, created_at, expires_at')
      .eq('created_by', me.id)
      .eq('status', 'open')
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order('created_at', { ascending: false }),
    admin.from('profiles').select('id, name, invited_by, joined_at'),
  ]);
  if (invites.error) throw invites.error;
  if (people.error) throw people.error;
  const branch = buildTree(people.data as Person[], me.id);
  return ok({
    canShare: me.role === 'admin' || me.can_share,
    limit: me.role === 'admin' ? null : MEMBER_OPEN_LIMIT,
    invites: invites.data,
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
  const admin = supabaseAdmin();

  switch (body.action) {
    case 'create': {
      const { data, error } = await admin.rpc('create_invitation', { p_by: me.id, p_for: body.forWhom || null });
      if (error) {
        if (/limit/.test(error.message)) throw new HttpError(409, 'limit');
        if (/sharing_off/.test(error.message)) throw new HttpError(403, 'sharing_off');
        throw error;
      }
      return ok({ invite: data }, 201);
    }
    // Your own open invites only: name one after the fact, or take one back.
    case 'label':
    case 'revoke': {
      const code = normalizeCode(body.code);
      const patch = body.action === 'label' ? { for_whom: body.forWhom || null } : { status: 'revoked' };
      const { data, error } = await admin.from('invitations').update(patch).eq('code', code).eq('created_by', me.id).eq('status', 'open').select('code');
      if (error) throw error;
      if (!data.length) throw new HttpError(409, 'not_open');
      return ok({ code });
    }
  }
});

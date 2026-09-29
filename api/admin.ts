import { z } from 'zod';
import { appOrigin, audit, handle, HttpError, ok, parse, requireAdmin, supabaseAdmin, type Profile } from './_lib/http.js';
import { normalizeCode } from '../shared/codes.js';

/** Invitations and members, for the admin screen. */
export const GET = handle(async req => {
  await requireAdmin(req);
  const admin = supabaseAdmin();
  const [invites, users] = await Promise.all([
    admin.from('invitations').select('code, for_whom, status, created_at, redeemed_at, redeemed_by').order('created_at', { ascending: false }).limit(200),
    admin.from('profiles').select('*').order('joined_at'),
  ]);
  if (invites.error) throw invites.error;
  if (users.error) throw users.error;
  const names = new Map((users.data as Profile[]).map(u => [u.id, u.name]));
  return ok({
    invites: invites.data.map(i => ({ ...i, redeemed_by_name: i.redeemed_by ? names.get(i.redeemed_by) ?? null : null })),
    users: users.data,
  });
});

const action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('invite'), forWhom: z.string().trim().max(120).optional() }),
  z.object({ action: z.literal('revoke'), code: z.string().max(20) }),
  z.object({ action: z.literal('suspend'), id: z.string().uuid() }),
  z.object({ action: z.literal('reactivate'), id: z.string().uuid() }),
  z.object({ action: z.literal('reset_link'), id: z.string().uuid() }),
]);

export const POST = handle(async req => {
  const { profile: me } = await requireAdmin(req);
  const body = await parse(req, action);
  const admin = supabaseAdmin();

  switch (body.action) {
    case 'invite': {
      const { data, error } = await admin.rpc('create_invitation', { p_by: me.id, p_for: body.forWhom ?? null });
      if (error) throw error;
      await audit(me.id, 'invite_create', null, { code: (data as { code: string }).code });
      return ok({ invite: data }, 201);
    }
    case 'revoke': {
      const code = normalizeCode(body.code);
      const { data, error } = await admin.from('invitations').update({ status: 'revoked' }).eq('code', code).eq('status', 'open').select('code');
      if (error) throw error;
      if (!data.length) throw new HttpError(409, 'not_open');
      await audit(me.id, 'invite_revoke', null, { code });
      return ok({ revoked: code });
    }
    case 'suspend':
    case 'reactivate': {
      if (body.id === me.id) throw new HttpError(400, 'self');
      const suspend = body.action === 'suspend';
      const { error } = await admin
        .from('profiles')
        .update({ status: suspend ? 'suspended' : 'active', suspended_at: suspend ? new Date().toISOString() : null })
        .eq('id', body.id);
      if (error) throw error;
      // Banning also stops their refresh tokens, so the app signs them out on its next check.
      const { error: banErr } = await admin.auth.admin.updateUserById(body.id, { ban_duration: suspend ? '876000h' : 'none' });
      if (banErr) throw banErr;
      await audit(me.id, body.action, body.id);
      return ok({ id: body.id, status: suspend ? 'suspended' : 'active' });
    }
    case 'reset_link': {
      const { data: user, error } = await admin.from('profiles').select('email').eq('id', body.id).single<{ email: string }>();
      if (error || !user) throw new HttpError(404, 'not_found');
      const { data, error: linkErr } = await admin.auth.admin.generateLink({ type: 'recovery', email: user.email });
      if (linkErr) throw linkErr;
      await audit(me.id, 'reset_link', body.id);
      return ok({ link: `${appOrigin(req)}/reset?token_hash=${encodeURIComponent(data.properties.hashed_token)}` });
    }
  }
});

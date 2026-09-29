import { z } from 'zod';
import { handle, HttpError, guardIp, ok, parse, supabaseAdmin } from './_lib/http.js';
import { isValidCode, normalizeCode } from '../shared/codes.js';

const body = z.object({
  code: z.string().max(20),
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(10).max(200),
});

/**
 * Invite-gated sign-up: create the auth user, then redeem atomically; undo on failure.
 * The browser signs in with the same credentials afterwards (its session lives in localStorage).
 */
export const POST = handle(async req => {
  await guardIp(req, 'signup');
  const { code, name, email, password } = await parse(req, body);
  if (!isValidCode(code)) throw new HttpError(400, 'bad_format');
  const admin = supabaseAdmin();

  const { data: check } = await admin.rpc('check_invitation', { p_code: normalizeCode(code) });
  const inv = (check as { status: string }[] | null)?.[0];
  if (!inv) throw new HttpError(404, 'not_found');
  if (inv.status !== 'open') throw new HttpError(409, inv.status === 'revoked' ? 'revoked' : 'used');

  const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
  if (createErr || !created.user) {
    if (/already|registered|exists/i.test(createErr?.message ?? '')) throw new HttpError(409, 'email_taken');
    if (/password/i.test(createErr?.message ?? '')) throw new HttpError(400, 'weak_password');
    throw createErr ?? new Error('createUser failed');
  }

  const { data: profile, error: redeemErr } = await admin.rpc('redeem_invitation', {
    p_code: normalizeCode(code), p_user: created.user.id, p_name: name, p_email: email,
  });
  if (redeemErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    if (/used/.test(redeemErr.message)) throw new HttpError(409, 'used');
    if (/not_found/.test(redeemErr.message)) throw new HttpError(404, 'not_found');
    throw redeemErr;
  }
  return ok({ user: profile }, 201);
});

import { z } from 'zod';
import { authFetch, handle, HttpError, guardIp, ok, parse, sql } from './_lib/http.js';
import { isValidCode, normalizeCode } from '../shared/codes.js';

const body = z.object({
  code: z.string().max(20),
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(10).max(200),
});

/**
 * Invite-gated sign-up: create the Neon Auth user, then redeem atomically; undo on failure.
 * The browser signs in with the same credentials afterwards (through /api/auth, so its session cookie is Lull's).
 */
export const POST = handle(async req => {
  await guardIp(req, 'signup');
  const { code, name, email, password } = await parse(req, body);
  if (!isValidCode(code)) throw new HttpError(400, 'bad_format');
  const [inv] = (await sql`select * from public.check_invitation(${normalizeCode(code)})`) as { status: string }[];
  if (!inv) throw new HttpError(404, 'not_found');
  if (inv.status !== 'open') throw new HttpError(409, inv.status === 'revoked' || inv.status === 'expired' ? inv.status : 'used');

  // The server-side sign-up's session is thrown away; the browser signs in for its own.
  const created = await authFetch(req, 'sign-up/email', { email, password, name });
  const userId = (created.data.user as { id?: string } | undefined)?.id;
  if (!created.ok || !userId) {
    const msg = `${created.data.code ?? ''} ${created.data.message ?? ''}`;
    if (/already|exists/i.test(msg)) throw new HttpError(409, 'email_taken');
    if (/password/i.test(msg)) throw new HttpError(400, 'weak_password');
    throw new Error(`sign-up failed: ${created.status} ${msg}`);
  }
  await sql`update neon_auth."user" set "emailVerified" = true where id = ${userId}`;

  try {
    const [profile] = await sql`select * from public.redeem_invitation(${normalizeCode(code)}, ${userId}::uuid, ${name}, ${email})`;
    return ok({ user: profile }, 201);
  } catch (e) {
    await sql`delete from neon_auth."user" where id = ${userId}`;   // its sessions and account cascade
    const m = e instanceof Error ? e.message : '';
    if (/used/.test(m)) throw new HttpError(409, 'used');
    if (/expired/.test(m)) throw new HttpError(409, 'expired');
    if (/not_found/.test(m)) throw new HttpError(404, 'not_found');
    throw e;
  }
});

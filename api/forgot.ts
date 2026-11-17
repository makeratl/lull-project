import { z } from 'zod';
import { appOrigin, authFetch, guardIp, handle, ok, parse } from './_lib/http.js';

/**
 * "Forgot password": Neon Auth emails a reset link that comes back to /reset?token=….
 * Always answers the same way, so it can't be used to find out who has an account.
 */
export const POST = handle(async req => {
  await guardIp(req, 'forgot', 5, 3600);
  const { email } = await parse(req, z.object({ email: z.string().trim().toLowerCase().email().max(200) }));
  await authFetch(req, 'request-password-reset', { email, redirectTo: `${appOrigin(req)}/reset` }).catch(() => undefined);
  return ok({ ok: true });
});

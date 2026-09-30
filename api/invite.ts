import { z } from 'zod';
import { handle, HttpError, guardIp, ok, parse, supabaseAdmin } from './_lib/http.js';
import { isValidCode, normalizeCode } from '../shared/codes.js';

/** Check an invitation code before showing the join form. */
export const POST = handle(async req => {
  await guardIp(req, 'invite_validate');
  const { code } = await parse(req, z.object({ code: z.string().max(20) }));
  if (!isValidCode(code)) throw new HttpError(400, 'bad_format');
  const { data } = await supabaseAdmin().rpc('check_invitation', { p_code: normalizeCode(code) });
  const row = (data as { status: string; inviter_name: string }[] | null)?.[0];
  if (!row) throw new HttpError(404, 'not_found');
  if (row.status !== 'open') throw new HttpError(409, row.status === 'revoked' || row.status === 'expired' ? row.status : 'used');
  return ok({ valid: true, inviterName: row.inviter_name });
});

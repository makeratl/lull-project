import { z } from 'zod';
import { handle, HttpError, guardIp, ok, parse, sql } from './_lib/http.js';
import { isValidCode, normalizeCode } from '../shared/codes.js';

/** Check an invitation code before showing the join form. */
export const POST = handle(async req => {
  await guardIp(req, 'invite_validate');
  const { code } = await parse(req, z.object({ code: z.string().max(20) }));
  if (!isValidCode(code)) throw new HttpError(400, 'bad_format');
  const [row] = (await sql`select * from public.check_invitation(${normalizeCode(code)})`) as { status: string; inviter_name: string }[];
  if (!row) throw new HttpError(404, 'not_found');
  if (row.status !== 'open') throw new HttpError(409, row.status === 'revoked' || row.status === 'expired' ? row.status : 'used');
  return ok({ valid: true, inviterName: row.inviter_name });
});

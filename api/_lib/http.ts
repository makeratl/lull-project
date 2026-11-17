/**
 * Shared helpers for Lull's Vercel functions (web-standard Request/Response handlers).
 * Sessions are Bearer JWTs from Neon Auth (the browser's session), verified against the branch's JWKS.
 * Database work here runs as the owner (`sql`), which bypasses RLS: the browser's own queries go through
 * the Neon Data API with the member's JWT, where RLS applies.
 */
import { neon } from '@neondatabase/serverless';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { ZodType } from 'zod';

export interface Profile {
  id: string;
  name: string;
  email: string;
  role: 'member' | 'admin';
  status: 'active' | 'suspended';
  invited_by: string | null;
  joined_at: string;
  suspended_at: string | null;
  can_share: boolean;
  /** The invite they joined with. */
  invitation_id: string | null;
}

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

export const ok = <T,>(body: T, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export const handle = (fn: (req: Request) => Promise<Response>) => async (req: Request): Promise<Response> => {
  try {
    return await fn(req);
  } catch (e) {
    if (e instanceof HttpError) return Response.json({ error: e.code }, { status: e.status });
    console.error('[api]', e);
    return Response.json({ error: 'server_error' }, { status: 500 });
  }
};

export const parse = async <T,>(req: Request, schema: ZodType<T>): Promise<T> => {
  const body = await req.json().catch(() => {
    throw new HttpError(400, 'invalid_json');
  });
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, 'invalid_input');
  return r.data;
};

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

// Same shapes PostgREST returned on Supabase: timestamps as ISO strings (the driver gives Date objects,
// which e.g. shared/tree.ts's localeCompare can't sort).
const plain = (rows: Row[]) =>
  rows.map(r => {
    for (const k in r) if (r[k] instanceof Date) r[k] = (r[k] as Date).toISOString();
    return r;
  });

let owner: ReturnType<typeof neon> | null = null;
/** Tagged-template SQL as the database owner: bypasses RLS. Server only. */
export const sql = async (strings: TemplateStringsArray, ...values: unknown[]): Promise<Row[]> => {
  owner ??= neon(env('DATABASE_URL'));
  return plain((await owner(strings, ...values)) as Row[]);
};

/** Neon Auth for this branch (NEON_AUTH_BASE_URL, e.g. https://ep-….neonauth…/neondb/auth). */
export const authBase = () => env('NEON_AUTH_BASE_URL').replace(/\/$/, '');

/** Call Neon Auth from the server. It refuses requests without an Origin, so send the app's. */
export const authFetch = async (req: Request, path: string, body: unknown) => {
  const r = await fetch(`${authBase()}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: appOrigin(req) },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data: data as Row, cookies: r.headers.getSetCookie() };
};

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
/** The user id behind a Neon Auth JWT, or null if it isn't valid (bad signature, expired). */
export const verifyToken = async (token: string) => {
  jwks ??= createRemoteJWKSet(new URL(`${authBase()}/.well-known/jwks.json`));
  try {
    const { payload } = await jwtVerify(token, jwks);
    return typeof payload.sub === 'string' ? { id: payload.sub, email: String(payload.email ?? '') } : null;
  } catch {
    return null;
  }
};

/** The signed-in, active member behind the Bearer token. */
export const requireMember = async (req: Request) => {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'unauthenticated');
  const user = await verifyToken(token);
  if (!user) throw new HttpError(401, 'unauthenticated');
  const [profile] = (await sql`select * from profiles where id = ${user.id}`) as Profile[];
  if (!profile) throw new HttpError(401, 'unauthenticated');
  if (profile.status !== 'active') throw new HttpError(403, 'suspended');
  return { user, profile };
};

export const requireAdmin = async (req: Request) => {
  const ctx = await requireMember(req);
  if (ctx.profile.role !== 'admin') throw new HttpError(403, 'forbidden');
  return ctx;
};

export const clientIp = (req: Request) =>
  (req.headers.get('x-forwarded-for')?.split(',')[0] ?? req.headers.get('x-real-ip') ?? 'unknown').trim();

/** IP brute-force guard (default 10 attempts per 10 minutes). */
export const guardIp = async (req: Request, action: string, max = 10, windowSec = 600) => {
  const [{ allowed }] = await sql`select public.ip_attempt(${clientIp(req)}, ${action}, ${max}::int, ${windowSec}::int) as allowed`;
  if (allowed === false) throw new HttpError(429, 'rate_limited');
};

export const audit = async (actorId: string, action: string, target: string | null, payload: Record<string, unknown> = {}) => {
  await sql`insert into admin_audit_log (actor_id, action, target_user_id, payload) values (${actorId}, ${action}, ${target}, ${JSON.stringify(payload)}::jsonb)`;
};

export const appOrigin = (req: Request) => process.env.APP_ORIGIN || new URL(req.url).origin;

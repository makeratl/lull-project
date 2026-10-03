/**
 * Shared helpers for Lull's Vercel functions (web-standard Request/Response handlers).
 * Sessions are Bearer tokens from the browser's supabase-js session, checked with the service client.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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

let adminClient: SupabaseClient | null = null;
/** Service-role client: bypasses RLS. Server only. */
export const supabaseAdmin = () => {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  return (adminClient ||= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }));
};

/** The signed-in, active member behind the Bearer token. */
export const requireMember = async (req: Request) => {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'unauthenticated');
  const admin = supabaseAdmin();
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) throw new HttpError(401, 'unauthenticated');
  const { data: profile } = await admin.from('profiles').select('*').eq('id', user.id).single<Profile>();
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
  const { data, error } = await supabaseAdmin().rpc('ip_attempt', { p_ip: clientIp(req), p_action: action, p_max: max, p_window_sec: windowSec });
  if (error) throw error;
  if (data === false) throw new HttpError(429, 'rate_limited');
};

export const audit = async (actorId: string, action: string, target: string | null, payload: Record<string, unknown> = {}) => {
  await supabaseAdmin().from('admin_audit_log').insert({ actor_id: actorId, action, target_user_id: target, payload });
};

export const appOrigin = (req: Request) => process.env.APP_ORIGIN || new URL(req.url).origin;

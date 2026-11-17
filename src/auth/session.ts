/**
 * Offline-first session.
 *
 * The app opens from a cached profile (`lull.me`), even offline or with an expired token,
 * so it can never lock anyone out at 2am. When online, the session is re-checked in the background,
 * and the user is signed out only on a definite answer (revoked, suspended, deleted), never on a network error.
 */
import { createClient } from '@neon/neon-js/supabase';
import type { Remote, Session } from '../core/practice';

export interface Me {
  id: string;
  name: string;
  email: string;
  role: 'member' | 'admin';
}

const ME_KEY = 'lull.me';

/**
 * Neon: auth goes through Lull's own /api/auth (see api/auth.ts) so the session cookie is first-party,
 * which Safari keeps. Queries go to the branch's Data API with the session's JWT, where RLS applies.
 * The Data API lives beside Neon Auth on the same endpoint, so its URL is derived from VITE_NEON_AUTH_URL
 * (which the Vercel Neon integration sets per branch, previews included).
 */
const authUrl: string = import.meta.env.VITE_NEON_AUTH_URL;
const dataApiUrl = authUrl.replace(/^(https:\/\/[^.]+)\.neonauth\.(.+)\/([^/]+)\/auth\/?$/, '$1.apirest.$2/$3/rest/v1');

export const supabase = createClient({
  auth: { url: `${typeof location === 'undefined' ? '' : location.origin}/api/auth` },
  dataApi: { url: dataApiUrl },
});

/** A failure to reach the server (offline, timeout), as opposed to a definite "no". */
const isNetworkError = (e: unknown) => {
  const err = e as { name?: string; status?: number; message?: string } | null;
  if (!err) return false;
  return err.name === 'AuthRetryableFetchError' || err.name === 'TypeError' || err.status === 0 || err.status === 502
    || /fetch|network|NETWORK_/i.test(`${err.name ?? ''} ${err.message ?? ''}`);
};

export const cachedMe = (): Me | null => {
  try {
    return JSON.parse(localStorage.getItem(ME_KEY) || 'null');
  } catch {
    return null;
  }
};

export const saveMe = (me: Me | null) => {
  try {
    if (me) localStorage.setItem(ME_KEY, JSON.stringify(me));
    else localStorage.removeItem(ME_KEY);
  } catch { /* private mode */ }
};

export class AuthError extends Error {}

/** Load the signed-in user's profile; a suspended profile signs out. */
export const loadProfile = async (userId: string): Promise<Me> => {
  const { data, error } = await supabase.from('profiles').select('id, name, email, role, status').eq('id', userId).single();
  if (error) throw error;
  if (data.status !== 'active') {
    await supabase.auth.signOut({ scope: 'local' });
    throw new AuthError('This account is paused. Ask whoever invited you to turn it back on.');
  }
  return { id: data.id, name: data.name, email: data.email, role: data.role };
};

export const signIn = async (email: string, password: string): Promise<Me> => {
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error || !data.user) {
    if (error && isNetworkError(error)) throw new AuthError('Can’t reach Lull right now. Check your connection.');
    throw new AuthError('That email and password don’t match.');
  }
  const me = await loadProfile(data.user.id);
  saveMe(me);
  return me;
};

/** Change the password; Neon Auth checks the current one. Other devices stay signed in. */
export const changePassword = async (_email: string, current: string, next: string) => {
  if (next.length < 10) throw new AuthError('Use at least 10 characters.');
  if (next === current) throw new AuthError('Choose a password different from the current one.');
  let res: Response;
  try {
    res = await fetch('/api/auth/change-password', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: current, newPassword: next, revokeOtherSessions: false }),
    });
  } catch {
    throw new AuthError('Can’t reach Lull right now. Check your connection.');
  }
  if (res.ok) return;
  const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
  if (/INVALID_PASSWORD|invalid password/i.test(`${body.code} ${body.message}`)) throw new AuthError('Your current password isn’t right.');
  if (res.status >= 500) throw new AuthError('Can’t reach Lull right now. Check your connection.');
  throw new AuthError('That password wasn’t accepted. Try a longer one.');
};

/** Set a new password from a reset link (/reset?token=…), then sign in with it. */
export const resetPassword = async (token: string, password: string) => {
  const res = await fetch('/api/auth/reset-password', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, newPassword: password }),
  }).catch(() => null);
  if (!res) throw new AuthError('Can’t reach Lull right now. Check your connection.');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    if (/PASSWORD_TOO|password/i.test(`${body.code} ${body.message}`) && !/token/i.test(`${body.code} ${body.message}`))
      throw new AuthError('That password wasn’t accepted. Try a longer one.');
    throw new AuthError('This reset link has expired or was already used. Ask for a new one.');
  }
};

export const signOut = async () => {
  saveMe(null);
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch { /* offline: the local session is cleared anyway */ }
};

/**
 * Background check. Returns the fresh profile, `null` when the user must be signed out,
 * or `undefined` when the answer is unknown (offline, server trouble): keep going as-is.
 */
export const verify = async (): Promise<Me | null | undefined> => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return undefined;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      if (isNetworkError(error) || !error.status || error.status >= 500) return undefined;
      return null;
    }
    return await loadProfile(data.user.id);
  } catch (e) {
    // AuthError: suspended. PGRST116: no profile row (the account was removed).
    if (e instanceof AuthError || (e as { code?: string })?.code === 'PGRST116') return null;
    return undefined;
  }
};

const SESSION_COLS = 'id, pattern, started_at, seconds, rounds, planned_min, completed';

/** The practice log's server side: the signed-in person's own rows in `relax_sessions` (RLS). */
export const practiceRemote: Remote = {
  async push(rows) {
    // user_id defaults to the caller; an id already uploaded (a retry) is left alone.
    const { error } = await supabase.from('relax_sessions').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;
  },
  async pull() {
    const { data, error } = await supabase.from('relax_sessions').select(SESSION_COLS).order('started_at').limit(10000);
    if (error) throw error;
    return data as Session[];
  },
  async remove(ids) {
    const { error } = await supabase.from('relax_sessions').delete().in('id', ids);
    if (error) throw error;
  },
};

/** Fetch an /api route with the current session's token. */
export const api = async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...init.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? 'server_error');
  return body as T;
};

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

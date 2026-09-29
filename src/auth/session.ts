/**
 * Offline-first session.
 *
 * The app opens from a cached profile (`lull.me`), even offline or with an expired token,
 * so it can never lock anyone out at 2am. When online, the session is re-checked in the background,
 * and the user is signed out only on a definite answer (revoked, suspended, deleted), never on a network error.
 */
import { createClient, isAuthRetryableFetchError } from '@supabase/supabase-js';

export interface Me {
  id: string;
  name: string;
  email: string;
  role: 'member' | 'admin';
}

const ME_KEY = 'lull.me';

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'lull.auth' },
});

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
    if (error && isAuthRetryableFetchError(error)) throw new AuthError('Can’t reach Lull right now. Check your connection.');
    throw new AuthError('That email and password don’t match.');
  }
  const me = await loadProfile(data.user.id);
  saveMe(me);
  return me;
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
      if (isAuthRetryableFetchError(error) || !error.status || error.status >= 500) return undefined;
      return null;
    }
    return await loadProfile(data.user.id);
  } catch (e) {
    // AuthError: suspended. PGRST116: no profile row (the account was removed).
    if (e instanceof AuthError || (e as { code?: string })?.code === 'PGRST116') return null;
    return undefined;
  }
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

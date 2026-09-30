/**
 * Daily nudges, on the phone's side: asking permission, subscribing this device to Web Push, and saving
 * the person's times and days. Sending happens on the server (api/nudge.ts, every 15 minutes).
 */
import { isIOS } from '../core/constants';
import { supabase } from './session';

export interface Nudges {
  enabled: boolean;
  times: string[];
  days: number[];
}

export const DEFAULT_NUDGES: Nudges = { enabled: false, times: ['08:00', '13:00', '21:00'], days: [0, 1, 2, 3, 4, 5, 6] };

/** What this device can do. iPhone only allows web push for the installed app (Home Screen, iOS 16.4+). */
export const support = () => {
  const standalone = typeof window !== 'undefined' && (matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
  const api = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  return {
    ok: api && (!isIOS || standalone),
    iosNeedsInstall: isIOS && !standalone,
    blocked: api && Notification.permission === 'denied',
  };
};

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const b64ToBytes = (b64: string) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0));
};

/** The service worker that receives pushes. In dev there's no app worker, so the push handlers alone stand in. */
const worker = async () => {
  if (import.meta.env.DEV && !(await navigator.serviceWorker.getRegistration())) await navigator.serviceWorker.register('/push-sw.js');
  return navigator.serviceWorker.ready;
};

export const loadNudges = async (): Promise<Nudges & { goal?: number }> => {
  const { data } = await supabase.from('nudge_settings').select('enabled, times, days, goal').maybeSingle();
  return data ?? DEFAULT_NUDGES;
};

/** Save settings (and the goal the server checks against). Keeps the time zone current. */
export const saveNudges = async (n: Nudges, goal: number) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('signed out');
  const { error } = await supabase
    .from('nudge_settings')
    .upsert({ user_id: session.user.id, ...n, goal, tz: tz(), updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
};

/** Keep the server's copy of the daily goal in step, if nudges were ever set up. */
export const syncGoal = async (goal: number) => {
  try { await supabase.from('nudge_settings').update({ goal, tz: tz() }).not('user_id', 'is', null); } catch { /* offline: next save catches up */ }
};

/**
 * Turn nudges on for this device: must run inside a tap (the permission prompt needs one).
 * Returns 'denied' if the person said no.
 */
export const enableNudges = async (n: Nudges, goal: number): Promise<'ok' | 'denied'> => {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const reg = await worker();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(import.meta.env.VITE_VAPID_PUBLIC_KEY) }));
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const { data: { session } } = await supabase.auth.getSession();
  // Upsert on the endpoint: re-enabling on the same phone doesn't make a duplicate.
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({ user_id: session!.user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: 'endpoint', ignoreDuplicates: true });
  if (error) throw error;
  await saveNudges({ ...n, enabled: true }, goal);
  return 'ok';
};

/** Turn nudges off (for every device), and unsubscribe this one. */
export const disableNudges = async (n: Nudges, goal: number) => {
  await saveNudges({ ...n, enabled: false }, goal);
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      await sub.unsubscribe();
    }
  } catch { /* nothing subscribed here */ }
};

import webpush from 'web-push';
import { handle, HttpError, ok, supabaseAdmin } from './_lib/http.js';
import { dueSlots, nudgeMessage, practiceToday, type NudgeSettings, type Practice } from '../shared/nudge.js';

/**
 * Send the nudges that are due. Called every 15 minutes by pg_cron (see the nudges migration) with a shared
 * secret; nobody else can trigger it. Each slot is claimed in nudge_sent before sending, so overlapping runs
 * never send twice, and a nudge is skipped once the person has met today's goal.
 */
export const POST = handle(async req => {
  const secret = process.env.NUDGE_SECRET;
  if (!secret || req.headers.get('x-nudge-secret') !== secret) throw new HttpError(401, 'unauthenticated');
  webpush.setVapidDetails(process.env.VAPID_SUBJECT!, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);

  const admin = supabaseAdmin(), now = new Date();
  const { data: settings, error } = await admin.from('nudge_settings').select('user_id, enabled, times, days, tz, goal').eq('enabled', true);
  if (error) throw error;
  if (!settings.length) return ok({ due: 0 });
  const ids = settings.map(s => s.user_id);
  const since = new Date(now.getTime() - 2 * 86400_000).toISOString().slice(0, 10);
  const [active, handled, sessions, subs] = await Promise.all([
    admin.from('profiles').select('id').in('id', ids).eq('status', 'active'),
    admin.from('nudge_sent').select('user_id, local_date, slot').in('user_id', ids).gte('local_date', since),
    admin.from('relax_sessions').select('user_id, started_at, seconds').in('user_id', ids).gte('started_at', new Date(now.getTime() - 400 * 86400_000).toISOString()),
    admin.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', ids),
  ]);
  for (const r of [active, handled, sessions, subs]) if (r.error) throw r.error;
  const activeIds = new Set(active.data!.map(p => p.id));

  const counts = { sent: 0, skipped_goal: 0, no_device: 0, failed: 0 };
  for (const s of settings as NudgeSettings[]) {
    if (!activeIds.has(s.user_id)) continue;
    const done = new Set(handled.data!.filter(h => h.user_id === s.user_id).map(h => `${h.local_date}|${h.slot}`));
    for (const due of dueSlots(s, now, done)) {
      // Claim the slot first: a second run at the same moment finds it taken and moves on.
      const { data: claimed } = await admin
        .from('nudge_sent')
        .upsert({ user_id: s.user_id, local_date: due.date, slot: due.slot, outcome: 'sent' }, { onConflict: 'user_id,local_date,slot', ignoreDuplicates: true })
        .select('slot');
      if (!claimed?.length) continue;
      const mark = async (outcome: keyof typeof counts) => {
        counts[outcome]++;
        if (outcome !== 'sent') await admin.from('nudge_sent').update({ outcome }).match({ user_id: s.user_id, local_date: due.date, slot: due.slot });
      };

      const today = practiceToday((sessions.data as (Practice & { user_id: string })[]).filter(x => x.user_id === s.user_id), due.date, s.tz);
      if (today.minutes >= s.goal) { await mark('skipped_goal'); continue; }
      const devices = subs.data!.filter(d => d.user_id === s.user_id);
      if (!devices.length) { await mark('no_device'); continue; }

      const payload = JSON.stringify(nudgeMessage({ ...today, goal: s.goal, last: due.last }));
      let delivered = 0;
      for (const d of devices) {
        try {
          await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, payload, { TTL: 3600, urgency: 'normal' });
          delivered++;
        } catch (e) {
          // The phone unsubscribed or the app was removed: forget that device.
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('id', d.id);
        }
      }
      await mark(delivered ? 'sent' : 'failed');
    }
  }
  return ok(counts);
});

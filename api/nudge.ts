import webpush from 'web-push';
import { handle, HttpError, ok, sql } from './_lib/http.js';
import { dueSlots, nudgeMessage, practiceToday, type NudgeSettings, type Practice } from '../shared/nudge.js';

/**
 * Send the nudges that are due. Called every 15 minutes by .github/workflows/nudge.yml with a shared
 * secret; nobody else can trigger it. Each slot is claimed in nudge_sent before sending, so overlapping runs
 * never send twice, and a nudge is skipped once the person has met today's goal.
 */
export const POST = handle(async req => {
  const secret = process.env.NUDGE_SECRET;
  if (!secret || req.headers.get('x-nudge-secret') !== secret) throw new HttpError(401, 'unauthenticated');
  webpush.setVapidDetails(process.env.VAPID_SUBJECT!, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);

  const now = new Date();
  const settings = await sql`select user_id, enabled, times, days, tz, goal from nudge_settings where enabled`;
  if (!settings.length) return ok({ due: 0 });
  const ids = settings.map(s => s.user_id as string);
  const since = new Date(now.getTime() - 2 * 86400_000).toISOString().slice(0, 10);
  const [active, handledRows, sessions, subs] = await Promise.all([
    sql`select id from profiles where id = any(${ids}::uuid[]) and status = 'active'`,
    // local_date as text: the slot keys below compare it to 'YYYY-MM-DD' strings.
    sql`select user_id, local_date::text as local_date, slot from nudge_sent where user_id = any(${ids}::uuid[]) and local_date >= ${since}::date`,
    sql`select user_id, started_at, seconds from relax_sessions where user_id = any(${ids}::uuid[]) and started_at >= ${new Date(now.getTime() - 400 * 86400_000).toISOString()}`,
    sql`select id, user_id, endpoint, p256dh, auth from push_subscriptions where user_id = any(${ids}::uuid[])`,
  ]);
  const handled = { data: handledRows };
  const activeIds = new Set(active.map(p => p.id));

  const counts = { sent: 0, skipped_goal: 0, no_device: 0, failed: 0 };
  for (const s of settings as NudgeSettings[]) {
    if (!activeIds.has(s.user_id)) continue;
    const done = new Set(handled.data!.filter(h => h.user_id === s.user_id).map(h => `${h.local_date}|${h.slot}`));
    for (const due of dueSlots(s, now, done)) {
      // Claim the slot first: a second run at the same moment finds it taken and moves on.
      const claimed = await sql`insert into nudge_sent (user_id, local_date, slot, outcome) values (${s.user_id}, ${due.date}::date, ${due.slot}, 'sent')
        on conflict (user_id, local_date, slot) do nothing returning slot`;
      if (!claimed.length) continue;
      const mark = async (outcome: keyof typeof counts) => {
        counts[outcome]++;
        if (outcome !== 'sent') await sql`update nudge_sent set outcome = ${outcome} where user_id = ${s.user_id} and local_date = ${due.date}::date and slot = ${due.slot}`;
      };

      const today = practiceToday((sessions as (Practice & { user_id: string })[]).filter(x => x.user_id === s.user_id), due.date, s.tz);
      if (today.minutes >= s.goal) { await mark('skipped_goal'); continue; }
      const devices = subs.filter(d => d.user_id === s.user_id);
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
          if (code === 404 || code === 410) await sql`delete from push_subscriptions where id = ${d.id}`;
        }
      }
      await mark(delivered ? 'sent' : 'failed');
    }
  }
  return ok(counts);
});

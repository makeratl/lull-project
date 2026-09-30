/**
 * Daily nudges: which reminders are due, and what they say. Pure, so the server's decisions are testable.
 * Times are the person's local times in their own time zone (IANA name), via Intl.
 */
import { streaks } from '../src/core/practice.js';

export interface NudgeSettings {
  user_id: string;
  enabled: boolean;
  /** Local times, 'HH:MM'. */
  times: string[];
  /** 0 = Sunday … 6 = Saturday. */
  days: number[];
  tz: string;
  goal: number;
}

/** A slot missed by more than this (the scheduler was down) is dropped rather than sent late. */
export const WINDOW_MIN = 45;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The local date ('YYYY-MM-DD'), time ('HH:MM') and weekday (0 = Sunday) of an instant in a time zone. */
export const localParts = (at: Date, tz: string) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
    }).formatToParts(at).map(p => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hm: `${parts.hour}:${parts.minute}`, weekday: WEEKDAYS.indexOf(parts.weekday) };
};

const mins = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/** Slots due now: a chosen day, the time has passed within the window, and not already handled today. */
export const dueSlots = (s: NudgeSettings, now: Date, handled: Set<string>) => {
  const { date, hm, weekday } = localParts(now, s.tz);
  if (!s.enabled || !s.days.includes(weekday)) return [];
  const last = [...s.times].sort().at(-1);
  return s.times
    .filter(t => mins(hm) >= mins(t) && mins(hm) - mins(t) < WINDOW_MIN && !handled.has(`${date}|${t}`))
    .map(t => ({ date, slot: t, last: t === last }));
};

export interface Practice {
  started_at: string;
  seconds: number;
}

/** Minutes breathed on a local date, and the streak before today, in that time zone. */
export const practiceToday = (sessions: Practice[], date: string, tz: string) => {
  let minutes = 0;
  const days = new Set<string>();
  for (const s of sessions) {
    const d = localParts(new Date(s.started_at), tz).date;
    days.add(d);
    if (d === date) minutes += s.seconds / 60;
  }
  days.delete(date);
  return { minutes, streak: streaks(days, date).current };
};

/** Gentle, specific, never guilt-tripping. Tapping it opens the Relax screen. */
export const nudgeMessage = ({ minutes, goal, streak, last }: { minutes: number; goal: number; streak: number; last: boolean }) => {
  const m = Math.floor(minutes);
  const body =
    m > 0
      ? `You’re at ${m} of ${goal} minutes today. A few more slow breaths?`
      : last && streak > 0
        ? `Keep your ${streak}-day streak going with a few minutes of breathing.`
        : `A few minutes of slow breathing? ${Math.min(5, goal)} is enough.`;
  return { title: 'Lull', body, url: '/?screen=relax' };
};

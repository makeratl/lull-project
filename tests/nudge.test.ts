import { describe, expect, it } from 'vitest';
import { dueSlots, localParts, nudgeMessage, practiceToday, type NudgeSettings } from '../shared/nudge';

const s = (over: Partial<NudgeSettings> = {}): NudgeSettings => ({
  user_id: 'u', enabled: true, times: ['08:00', '13:00', '21:00'], days: [0, 1, 2, 3, 4, 5, 6], tz: 'America/New_York', goal: 15, ...over,
});
// 2026-09-30 is a Wednesday. New York is UTC-4 until Nov 1, then UTC-5.
const ny = (d: string, hm: string, offset = 4) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day, Number(hm.slice(0, 2)) + offset, Number(hm.slice(3))));
};

describe('nudges', () => {
  it('reads local time in the person’s zone, across daylight saving', () => {
    expect(localParts(ny('2026-09-30', '08:05'), 'America/New_York')).toEqual({ date: '2026-09-30', hm: '08:05', weekday: 3 });
    expect(localParts(new Date('2026-11-02T13:05:00Z'), 'America/New_York')).toEqual({ date: '2026-11-02', hm: '08:05', weekday: 1 });
    expect(localParts(new Date('2026-09-30T23:30:00Z'), 'Asia/Tokyo').date).toBe('2026-10-01');
  });

  it('a slot is due from its time until the window closes, once', () => {
    expect(dueSlots(s(), ny('2026-09-30', '07:59'), new Set())).toEqual([]);
    expect(dueSlots(s(), ny('2026-09-30', '08:00'), new Set())).toEqual([{ date: '2026-09-30', slot: '08:00', last: false }]);
    expect(dueSlots(s(), ny('2026-09-30', '08:14'), new Set())).toHaveLength(1);
    expect(dueSlots(s(), ny('2026-09-30', '08:14'), new Set(['2026-09-30|08:00']))).toEqual([]);
    // The scheduler was down: an hour late is dropped rather than sent.
    expect(dueSlots(s(), ny('2026-09-30', '09:00'), new Set())).toEqual([]);
    expect(dueSlots(s(), ny('2026-09-30', '21:10'), new Set())).toEqual([{ date: '2026-09-30', slot: '21:00', last: true }]);
  });

  it('only on chosen days, only when on', () => {
    expect(dueSlots(s({ days: [1, 2, 4, 5] }), ny('2026-09-30', '08:05'), new Set())).toEqual([]);
    expect(dueSlots(s({ enabled: false }), ny('2026-09-30', '08:05'), new Set())).toEqual([]);
  });

  it("today's minutes and the streak before today, in local days", () => {
    const at = (d: string, hm: string) => ny(d, hm).toISOString();
    const log = [
      { started_at: at('2026-09-27', '21:00'), seconds: 300 },
      { started_at: at('2026-09-28', '21:00'), seconds: 300 },
      { started_at: at('2026-09-29', '23:30'), seconds: 600 }, // 03:30 UTC on the 30th, but the 29th in New York
      { started_at: at('2026-09-30', '07:10'), seconds: 300 },
    ];
    expect(practiceToday(log, '2026-09-30', 'America/New_York')).toEqual({ minutes: 5, streak: 3 });
    expect(practiceToday(log, '2026-10-01', 'America/New_York')).toEqual({ minutes: 0, streak: 4 });
  });

  it('messages: progress, a streak to keep, or a gentle start', () => {
    expect(nudgeMessage({ minutes: 5.4, goal: 15, streak: 3, last: false }).body).toBe('You’re at 5 of 15 minutes today. A few more slow breaths?');
    expect(nudgeMessage({ minutes: 0, goal: 15, streak: 3, last: true }).body).toBe('Keep your 3-day streak going with a few minutes of breathing.');
    expect(nudgeMessage({ minutes: 0, goal: 15, streak: 3, last: false }).body).toBe('A few minutes of slow breathing? 5 is enough.');
    expect(nudgeMessage({ minutes: 0, goal: 5, streak: 0, last: true }).url).toBe('/?screen=relax');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays, byDay, dayKey, monthGrid, PracticeLog, streaks, type Remote, type Session } from '../src/core/practice';
import { Lull } from '../src/core/lull';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

/** A server that can be switched off, like a phone in airplane mode. */
const fakeRemote = () => {
  const rows = new Map<string, Session>();
  const calls = { push: 0, pull: 0, remove: 0 };
  let online = true;
  const net = () => { if (!online) throw new Error('offline'); };
  const remote: Remote = {
    async push(r) { net(); calls.push++; r.forEach(s => rows.has(s.id) || rows.set(s.id, s)); },
    async pull() { net(); calls.pull++; return [...rows.values()]; },
    async remove(ids) { net(); calls.remove++; ids.forEach(id => rows.delete(id)); },
  };
  return { remote, rows, calls, setOnline: (v: boolean) => { online = v; } };
};

const session = (started_at: string, seconds = 300): Omit<Session, 'id'> => ({ pattern: '478', started_at, seconds, rounds: 5, planned_min: 5, completed: true });
let n = 0;
const ids = () => `id-${++n}`;

describe('nights', () => {
  it('a night runs until 4 a.m. local time', () => {
    expect(dayKey(new Date(2026, 8, 29, 23, 30))).toBe('2026-09-29');
    expect(dayKey(new Date(2026, 8, 30, 0, 40))).toBe('2026-09-29');
    expect(dayKey(new Date(2026, 8, 30, 3, 59))).toBe('2026-09-29');
    expect(dayKey(new Date(2026, 8, 30, 4, 0))).toBe('2026-09-30');
    expect(dayKey(new Date(2026, 8, 30, 0, 40), 0)).toBe('2026-09-30');
  });

  it('day arithmetic crosses months, years and daylight-saving changes', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    // US daylight saving ends 2026-11-01 and begins 2027-03-14: still one day per step.
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(addDays('2027-03-14', -1)).toBe('2027-03-13');
  });

  it('streaks: tonight counts, an empty tonight keeps last night going, a gap breaks it', () => {
    const d = ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-25', '2026-09-26', '2026-09-27'];
    expect(streaks(d, '2026-09-27')).toEqual({ current: 3, longest: 3 });
    expect(streaks(d, '2026-09-28')).toEqual({ current: 3, longest: 3 });
    expect(streaks(d, '2026-09-29')).toEqual({ current: 0, longest: 3 });
    expect(streaks([...d, '2026-09-23'], '2026-09-23')).toEqual({ current: 4, longest: 4 });
    expect(streaks([], '2026-09-29')).toEqual({ current: 0, longest: 0 });
    expect(streaks(['2026-10-31', '2026-11-01', '2026-11-02'], '2026-11-02')).toEqual({ current: 3, longest: 3 });
  });

  it('month grid: Sunday first, whole weeks, right length', () => {
    const sep = monthGrid(2026, 8); // Sep 1 2026 is a Tuesday
    expect(sep[0].slice(0, 3)).toEqual([null, null, '2026-09-01']);
    expect(sep.flat().filter(Boolean)).toHaveLength(30);
    expect(sep.every(w => w.length === 7)).toBe(true);
    expect(monthGrid(2027, 1).flat().filter(Boolean)).toHaveLength(28);
    expect(monthGrid(2028, 1).flat().filter(Boolean)).toHaveLength(29);
  });

  it('byDay groups by night and adds up minutes', () => {
    const days = byDay([
      { id: 'a', ...session(new Date(2026, 8, 29, 22).toISOString(), 300) },
      { id: 'b', ...session(new Date(2026, 8, 30, 1).toISOString(), 120) },
    ]);
    expect([...days.keys()]).toEqual(['2026-09-29']);
    expect(days.get('2026-09-29')).toMatchObject({ minutes: 7, count: 2 });
  });
});

describe('practice log', () => {
  it('logs offline, uploads once when back, and survives a reload', async () => {
    const st = mem(), srv = fakeRemote();
    srv.setOnline(false);
    const log = new PracticeLog('u1', srv.remote, st, ids);
    log.record(session('2026-09-29T22:00:00Z'));
    await log.sync();
    expect(log.sessions).toHaveLength(1);
    expect(log.pendingCount).toBe(1);
    expect(srv.rows.size).toBe(0);
    // A reload while offline keeps the queue.
    const again = new PracticeLog('u1', srv.remote, st, ids);
    expect(again.pendingCount).toBe(1);
    srv.setOnline(true);
    await again.sync();
    await again.sync();
    expect(srv.rows.size).toBe(1);
    expect(again.pendingCount).toBe(0);
    expect(again.sessions).toHaveLength(1);
  });

  it('sessions logged while a sync is running are uploaded by the same sync', async () => {
    const srv = fakeRemote();
    const log = new PracticeLog('u1', srv.remote, mem(), ids);
    log.record(session('2026-09-26T22:00:00Z'));
    log.record(session('2026-09-27T22:00:00Z'));
    log.record(session('2026-09-28T22:00:00Z'));
    await log.sync();
    expect(srv.rows.size).toBe(3);
    expect(log.pendingCount).toBe(0);
  });

  it('takes sessions from other devices, and removals travel both ways', async () => {
    const srv = fakeRemote();
    const phone = new PracticeLog('u1', srv.remote, mem(), ids), tablet = new PracticeLog('u1', srv.remote, mem(), ids);
    const s = phone.record(session('2026-09-29T22:00:00Z'));
    await phone.sync();
    await tablet.sync();
    expect(tablet.sessions.map(x => x.id)).toEqual([s.id]);
    tablet.remove(s.id);
    await tablet.sync();
    expect(srv.rows.size).toBe(0);
    await phone.sync();
    expect(phone.sessions).toHaveLength(0);
  });

  it('removing a session that never uploaded needs no server call', async () => {
    const srv = fakeRemote();
    srv.setOnline(false);
    const log = new PracticeLog('u1', srv.remote, mem(), ids);
    const s = log.record(session('2026-09-29T22:00:00Z'));
    log.remove(s.id);
    srv.setOnline(true);
    await log.sync();
    expect(srv.calls.remove).toBe(0);
    expect(log.pendingCount).toBe(0);
  });

  it('keeps each person separate on a shared device', () => {
    const st = mem();
    new PracticeLog('u1', null, st, ids).record(session('2026-09-29T22:00:00Z'));
    expect(new PracticeLog('u2', null, st, ids).sessions).toHaveLength(0);
    expect(new PracticeLog('u1', null, st, ids).sessions).toHaveLength(1);
  });
});

describe('logging breathing sessions', () => {
  const setup = () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 29, 22, 0, 0));
    const c = new Lull(mem());
    c.gong = { prime() {}, ring() {} };
    const recorded: Omit<Session, 'id'>[] = [];
    c.setPractice({ record: s => { recorded.push(s); return { id: 'x', ...s }; }, sessions: [], remove() {}, sync: async () => {}, subscribe: () => () => {} });
    return { c, recorded };
  };
  let core: Lull | null = null;
  afterEach(() => { core?.destroy(); core = null; vi.useRealTimers(); });

  it('under a minute is not practice', () => {
    const { c, recorded } = setup(); core = c;
    c.startBreath();
    vi.advanceTimersByTime(2000 + 50_000);
    c.closeBreath();
    expect(recorded).toHaveLength(0);
  });

  it('a timed session that runs out is logged as finished, for its full length', () => {
    const { c, recorded } = setup(); core = c;
    c.setRelax({ min: 3 });
    c.startBreath();
    vi.advanceTimersByTime(2000 + 3 * 60_000 + 500);
    expect(c.s.breath).toBeNull();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ pattern: '478', seconds: 180, planned_min: 3, completed: true });
    expect(recorded[0].rounds).toBeGreaterThan(0);
    expect(recorded[0].started_at).toBe(new Date(2026, 8, 29, 22, 0, 2).toISOString());
  });

  it('stopping early, and leaving the screen, still count', () => {
    const { c, recorded } = setup(); core = c;
    c.setRelax({ min: 10 });
    c.startBreath();
    vi.advanceTimersByTime(2000 + 3 * 60_000);
    c.closeBreath();
    c.startBreath();
    vi.advanceTimersByTime(2000 + 90_000);
    c.closeBreath(false);
    expect(recorded.map(r => [r.seconds, r.completed])).toEqual([[180, false], [90, false]]);
  });

  it('changing the pattern mid-session logs the part already breathed', () => {
    const { c, recorded } = setup(); core = c;
    c.setRelax({ min: 0 });
    c.startBreath();
    vi.advanceTimersByTime(2000 + 2 * 60_000);
    c.setRelax({ p: 'box' });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ pattern: '478', seconds: 120, planned_min: 0 });
    vi.advanceTimersByTime(2000 + 61_000);
    c.closeBreath();
    expect(recorded.map(r => r.pattern)).toEqual(['478', 'box']);
  });
});

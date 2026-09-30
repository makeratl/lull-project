/**
 * The practice log: breathing sessions for streaks and a calendar.
 *
 * Local first: sessions are kept on the device (localStorage, per user) and uploaded to the person's own
 * rows in `relax_sessions` when online. A session logged offline waits in a queue; ids are made here, so a
 * retried upload is stored once. The server copy is the truth for everything already uploaded, which is
 * how a session removed on one device disappears from the others.
 */
import type { PatternId } from './constants';

export interface Session {
  id: string;
  pattern: PatternId;
  /** ISO time the breathing began (after "Settle in"). */
  started_at: string;
  seconds: number;
  rounds: number;
  /** The chosen length in minutes; 0 for an open session. */
  planned_min: number;
  /** Ran to the end of its time (rather than being stopped). */
  completed: boolean;
}

/** Sessions shorter than this aren't logged: a tap to see how it looks isn't practice. */
export const MIN_SECONDS = 60;
/** A night runs until 4 a.m.: a 12:40 a.m. session belongs to the evening before. */
export const CUTOFF_HOUR = 4;

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Local noon on that day, so day arithmetic never trips over a daylight-saving hour. */
const noon = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};

/** The night a moment belongs to, as `YYYY-MM-DD` in local time. */
export const dayKey = (at: Date | string | number, cutoff = CUTOFF_HOUR) => {
  const d = new Date(at);
  d.setHours(d.getHours() - cutoff);
  return ymd(d);
};

export const addDays = (key: string, n: number) => {
  const d = noon(key);
  d.setDate(d.getDate() + n);
  return ymd(d);
};

/**
 * Consecutive nights with practice. `current` counts back from tonight if tonight has a session,
 * otherwise from last night: a streak isn't broken until tonight is over.
 */
export const streaks = (days: Iterable<string>, today: string) => {
  const set = new Set(days);
  let current = 0;
  for (let k = set.has(today) ? today : addDays(today, -1); set.has(k); k = addDays(k, -1)) current++;
  let longest = 0, run = 0, prev = '';
  for (const k of [...set].sort()) {
    run = prev && addDays(prev, 1) === k ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = k;
  }
  return { current, longest };
};

/** A month as weeks of day keys, Sunday first; days outside the month are null. */
export const monthGrid = (year: number, month: number) => {
  const offset = new Date(year, month, 1).getDay(), days = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => ymd(new Date(year, month, i + 1)))];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
};

export interface Day {
  minutes: number;
  count: number;
  sessions: Session[];
}

/** Sessions grouped by night, each night's sessions oldest first. */
export const byDay = (sessions: Session[], cutoff = CUTOFF_HOUR) => {
  const out = new Map<string, Day>();
  for (const s of [...sessions].sort((a, b) => a.started_at.localeCompare(b.started_at))) {
    const k = dayKey(s.started_at, cutoff);
    const d = out.get(k) ?? { minutes: 0, count: 0, sessions: [] };
    d.minutes += s.seconds / 60;
    d.count++;
    d.sessions.push(s);
    out.set(k, d);
  }
  return out;
};

/** Where uploaded sessions live (Supabase in the app, a fake in tests). Each call throws when offline. */
export interface Remote {
  push(rows: Session[]): Promise<void>;
  /** All of this person's sessions. */
  pull(): Promise<Session[]>;
  remove(ids: string[]): Promise<void>;
}

interface Stored {
  sessions: Session[];
  /** Logged here, not yet uploaded. */
  pending: string[];
  /** Removed here, not yet removed from the server. */
  removed: string[];
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export class PracticeLog {
  private st: Stored;
  private key: string;
  private listeners = new Set<() => void>();
  private syncing: Promise<void> | null = null;

  constructor(
    userId: string,
    private remote: Remote | null,
    private storage: Store | null = typeof localStorage !== 'undefined' ? localStorage : null,
    private uuid: () => string = () => crypto.randomUUID(),
  ) {
    this.key = `lull.practice.${userId}`;
    let st: Partial<Stored> = {};
    try { st = JSON.parse(storage?.getItem(this.key) || '{}'); } catch { /* corrupt: start empty */ }
    this.st = { sessions: st.sessions ?? [], pending: st.pending ?? [], removed: st.removed ?? [] };
  }

  /** Newest first. */
  get sessions() {
    return [...this.st.sessions].sort((a, b) => b.started_at.localeCompare(a.started_at));
  }
  get pendingCount() {
    return this.st.pending.length + this.st.removed.length;
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  record(s: Omit<Session, 'id'>): Session {
    const row = { id: this.uuid(), ...s };
    this.st.sessions.push(row);
    this.st.pending.push(row.id);
    this.changed();
    this.sync();
    return row;
  }

  remove(id: string) {
    this.st.sessions = this.st.sessions.filter(s => s.id !== id);
    // Never uploaded: nothing to remove on the server.
    if (this.st.pending.includes(id)) this.st.pending = this.st.pending.filter(p => p !== id);
    else this.st.removed.push(id);
    this.changed();
    this.sync();
  }

  /**
   * Upload what's queued, then take the server's list (plus anything still queued here). Quiet when offline.
   * A call during a sync is folded into one more pass once it finishes, so nothing logged meanwhile waits.
   */
  sync(): Promise<void> {
    if (!this.remote) return Promise.resolve();
    if (this.syncing) {
      this.again = true;
      return this.syncing;
    }
    return (this.syncing = (async () => {
      do {
        this.again = false;
        // Stop early when a pass fails (offline): the queue keeps for the next trigger.
        if (!(await this.run())) break;
      } while (this.again);
      this.syncing = null;
    })());
  }

  private again = false;

  /** One pass; false when the network or server failed. */
  private async run(): Promise<boolean> {
    const remote = this.remote!;
    try {
      const pending = [...this.st.pending], removed = [...this.st.removed];
      if (pending.length) {
        await remote.push(this.st.sessions.filter(s => pending.includes(s.id)));
        this.st.pending = this.st.pending.filter(id => !pending.includes(id));
      }
      if (removed.length) {
        await remote.remove(removed);
        this.st.removed = this.st.removed.filter(id => !removed.includes(id));
      }
      const server = await remote.pull();
      // Anything logged or removed while this sync was under way is kept as it is here.
      const queued = this.st.sessions.filter(s => this.st.pending.includes(s.id));
      const gone = new Set(this.st.removed);
      this.st.sessions = [...server.filter(s => !gone.has(s.id) && !this.st.pending.includes(s.id)), ...queued];
      this.changed();
      return true;
    } catch {
      /* offline or the server said no: the queue stays for next time */
      return false;
    }
  }

  private changed() {
    try { this.storage?.setItem(this.key, JSON.stringify(this.st)); } catch { /* quota or private mode */ }
    this.listeners.forEach(f => f());
  }
}

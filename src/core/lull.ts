/**
 * App state and actions: a typed port of the reference `lull-core.js`.
 * Framework-free; the UI subscribes and renders `viewModel(core)`.
 */
import { ASSETS, DEFAULT_GOAL, PATTERNS, PRESETS, SOUNDS, isIOS, type Mix, type PatternId, type SoundDef } from './constants';
import { LiveEngine, type Engine, type PlayState } from './engine';
import { allFiles, decode, deleteFile, putFile, trimEdges } from './files';
import { Gong, type Chime } from './gong';
import { MIN_SECONDS, type PracticeLog, type Session } from './practice';
import { SafeEngine } from './safeMode';

export const KEY = 'lull.v2';

export interface Breath {
  p: PatternId;
  /** -1 while settling in */
  i: number;
  ends: number;
  cycles: number;
  until: number | null;
  /** When breathing begins (after "Settle in"), and the chosen length (0 = open): for the practice log. */
  started: number;
  min: number;
}

export interface Saved {
  levels: Record<string, number>;
  active: Record<string, boolean>;
  timer: number;
  wave: number;
  mixes: Mix[];
  fade: number;
  /** Pattern, session length (0 = open), and the daily practice goal in minutes. */
  relax: { p: PatternId; min: number; goal: number };
  safeMode: boolean;
}

export interface State extends Saved {
  customs: SoundDef[];
  playing: boolean;
  endsAt: number | null;
  dim: boolean;
  now: number;
  breath: Breath | null;
  fileError: string | null;
}

export const FILE_ERROR = 'That file couldn’t be played. Try an MP3 or M4A.';

export const loadSaved = (raw: string | null, ios = isIOS): Saved => {
  let sv: Partial<Saved> = {};
  try { sv = JSON.parse(raw || '{}'); } catch { /* corrupt: use defaults */ }
  return {
    levels: sv.levels || { ocean: 0.75 },
    active: sv.active || { ocean: true },
    timer: sv.timer === undefined ? 60 : sv.timer,
    wave: sv.wave || 11,
    mixes: sv.mixes || PRESETS,
    fade: sv.fade ?? 10,
    relax: { p: '478', min: 5, goal: DEFAULT_GOAL, ...sv.relax },
    safeMode: sv.safeMode ?? ios,
  };
};

type Listener = () => void;

export class Lull {
  s: State;
  /** Last touch, for auto-dim. */
  last = Date.now();
  buffers: Record<string, AudioBuffer> = {};
  blobs: Record<string, Blob> = {};
  assets: Record<string, AudioBuffer[]> = {};
  private loadingAssets = new Set<string>();
  private clips = new Map<string, Promise<AudioBuffer | null>>();
  live = new LiveEngine();
  gong: Chime = typeof window !== 'undefined' ? new Gong() : { prime() {}, ring() {} };
  /** The signed-in person's practice log (set by the app once it knows who that is). */
  practice: Pick<PracticeLog, 'record' | 'sessions' | 'remove' | 'sync' | 'subscribe'> | null = null;
  private practiceOff?: () => void;
  safe: SafeEngine | null = null;
  private listeners = new Set<Listener>();
  private saved = '';
  private iv: ReturnType<typeof setInterval>;
  private biv?: ReturnType<typeof setInterval>;

  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null) {
    let raw: string | null = null;
    try { raw = storage?.getItem(KEY) ?? null; } catch { /* private mode */ }
    this.s = { ...loadSaved(raw), customs: [], playing: false, endsAt: null, dim: false, now: Date.now(), breath: null, fileError: null };
    this.iv = setInterval(() => this.tick(), 1000);
  }

  /** Load the user's files from IndexedDB, and pre-render safe mode. Browser only. */
  async init() {
    const recs = await allFiles();
    for (const r of recs) {
      this.blobs[r.id] = r.blob;
      try { this.buffers[r.id] = await decode(await r.blob.arrayBuffer()); } catch { /* unplayable now; stays listed */ }
    }
    this.s.customs = recs.map(r => ({ id: r.id, name: r.name, note: 'Your recording', group: 'yours' as const, custom: true }));
    this.emit();
    this.ensureAssets();
    if (this.s.safeMode) this.safeEngine().prepare(this.playState());
  }

  /**
   * Load the recorded clips of every active sound that has them. Only active ones: a three-minute
   * recording is ~45 MB decoded. The files are precached by the service worker, so this works offline.
   */
  ensureAssets() {
    for (const id of Object.keys(ASSETS)) if (this.s.active[id] && !this.assets[id] && !this.loadingAssets.has(id)) this.loadAssets(id);
  }

  private async loadAssets(id: string) {
    this.loadingAssets.add(id);
    const got = await Promise.all(ASSETS[id].map(url => this.clip(url)));
    this.loadingAssets.delete(id);
    // All or nothing: a sound's clips have roles (Ocean's first is its bed).
    if (got.some(b => !b)) return;
    this.assets[id] = got as AudioBuffer[];
    this.mixChanged();
  }

  /** One decoded clip, shared between sounds that use the same file (Shore and Ocean's bed). */
  private clip(url: string) {
    let p = this.clips.get(url);
    if (!p) {
      // 32 kHz is plenty for water and voices, and keeps long recordings a third smaller in memory.
      p = fetch(url)
        .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
        .then(d => decode(d, 32000))
        .then(b => trimEdges(b))
        .catch(() => { this.clips.delete(url); return null; });
      this.clips.set(url, p);
    }
    return p;
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  emit() { this.listeners.forEach(f => f()); }

  destroy() {
    clearInterval(this.iv);
    clearInterval(this.biv);
    this.live.destroy();
    this.safe?.destroy();
  }

  set(p: Partial<State> | ((s: State) => Partial<State>)) {
    Object.assign(this.s, typeof p === 'function' ? p(this.s) : p);
    this.save();
    this.emit();
  }

  save() {
    const { levels, active, timer, wave, mixes, fade, relax, safeMode } = this.s;
    const j = JSON.stringify({ levels, active, timer, wave, mixes, fade, relax, safeMode });
    if (j !== this.saved) {
      this.saved = j;
      try { this.storage?.setItem(KEY, j); } catch { /* quota or private mode */ }
    }
  }

  // ─── sounds ───
  all(): SoundDef[] { return [...SOUNDS, ...this.s.customs]; }
  known(id: string) { return this.all().some(x => x.id === id); }
  activeList() { return this.all().filter(x => this.s.active[x.id]); }
  mixLabel() {
    const a = this.activeList();
    return a.length ? a.map(x => x.name).join(' + ') : 'Nothing selected';
  }

  playState(): PlayState {
    const { playing, active, levels, wave, timer, fade, endsAt } = this.s;
    return { playing, active, levels, wave, timer, fade, endsAt, buffers: this.buffers, assets: this.assets };
  }

  safeEngine() {
    return (this.safe ||= new SafeEngine(() => this.stop()));
  }
  engine(): Engine { return this.s.safeMode ? this.safeEngine() : this.live; }

  /** Tell the engine the mix changed. */
  private mixChanged() {
    this.ensureAssets();
    if (this.s.playing) this.engine().update(this.playState());
    else if (this.s.safeMode) this.safeEngine().update(this.playState());
    this.media();
  }

  play() {
    const s = this.s;
    this.last = Date.now();
    const anyOn = Object.keys(s.active).some(k => s.active[k] && this.known(k));
    const extra: Partial<State> = anyOn ? {} : { active: { ocean: true }, levels: { ...s.levels, ocean: s.levels.ocean || 0.7 } };
    this.set({ ...extra, playing: true, endsAt: s.timer ? Date.now() + s.timer * 60000 : null });
    this.ensureAssets();
    this.engine().start(this.playState());
    this.media();
  }

  stop() {
    this.set({ playing: false, endsAt: null, dim: false });
    this.live.stop();
    this.safe?.stop();
    this.media();
  }

  togglePlay() { if (this.s.playing) this.stop(); else this.play(); }

  setSafeMode(on: boolean) {
    const playing = this.s.playing;
    if (playing) this.engine().stop();
    this.set({ safeMode: on });
    // This runs inside a tap, so the other engine may start right away.
    if (playing) this.engine().start(this.playState());
    else if (on) this.safeEngine().prepare(this.playState());
  }

  media() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: this.mixLabel(), artist: 'Lull' });
      navigator.mediaSession.playbackState = this.s.playing ? 'playing' : 'paused';
      navigator.mediaSession.setActionHandler('play', () => this.play());
      navigator.mediaSession.setActionHandler('pause', () => this.stop());
    } catch { /* unsupported action */ }
  }

  tick() {
    const now = Date.now(), s = this.s;
    if (s.playing && s.endsAt && now >= s.endsAt) { this.stop(); return; }
    if (s.playing && !s.dim && !s.breath && now - this.last > 30000) s.dim = true;
    s.now = now;
    this.emit();
  }

  setTimer(min: number) {
    const playing = this.s.playing;
    this.set({ timer: min, endsAt: playing && min ? Date.now() + min * 60000 : null });
    if (playing) this.engine().schedule(this.playState());
  }

  setFade(v: number) {
    this.set({ fade: v });
    if (this.s.playing) this.engine().schedule(this.playState());
  }

  setWave(sec: number) {
    this.set({ wave: sec });
    if (this.s.playing) this.engine().setWave(this.playState());
    else if (this.s.safeMode) this.safeEngine().update(this.playState());
  }

  toggleSound(id: string) {
    this.set(s => ({ active: { ...s.active, [id]: !s.active[id] } }));
    this.mixChanged();
  }

  setLevel(id: string, v: number) {
    this.set(s => ({ levels: { ...s.levels, [id]: v }, active: { ...s.active, [id]: v > 0 } }));
    this.mixChanged();
  }

  // ─── mixes ───
  isCurrent(mix: Record<string, number>) {
    const s = this.s;
    const on = Object.keys(s.active).filter(k => s.active[k] && this.known(k)), keys = Object.keys(mix);
    return on.length === keys.length && keys.every(k => s.active[k] && Math.abs((s.levels[k] ?? 0.5) - mix[k]) < 0.03);
  }

  /** Only built-in sounds are saved; the name is the active names joined with " & ". */
  saveMix() {
    const s = this.s, a = this.activeList().filter(x => !x.custom);
    if (!a.length) return;
    this.set({ mixes: [...s.mixes, { name: a.map(x => x.name).join(' & '), mix: Object.fromEntries(a.map(x => [x.id, s.levels[x.id] ?? 0.5])) }] });
  }

  applyMix(mix: Record<string, number>) {
    this.set(s => ({ active: Object.fromEntries(Object.keys(mix).map(k => [k, true])), levels: { ...s.levels, ...mix } }));
    this.mixChanged();
  }

  deleteMix(i: number) { this.set(st => ({ mixes: st.mixes.filter((_, j) => j !== i) })); }

  // ─── user files ───
  async addFile(file: File | null | undefined) {
    if (!file) return;
    const id = 'file-' + Date.now(), name = file.name.replace(/\.[^.]+$/, '').slice(0, 24);
    try {
      this.buffers[id] = await decode(await file.arrayBuffer());
    } catch {
      this.set({ fileError: FILE_ERROR });
      return;
    }
    this.blobs[id] = file;
    await putFile({ id, name, blob: file });
    this.set(s => ({
      fileError: null,
      customs: [...s.customs, { id, name, note: 'Your recording', group: 'yours' as const, custom: true }],
      active: { ...s.active, [id]: true },
      levels: { ...s.levels, [id]: 0.6 },
    }));
    this.mixChanged();
  }

  async removeFile(id: string) {
    await deleteFile(id);
    this.set(s => {
      const a = { ...s.active }, l = { ...s.levels };
      delete a[id]; delete l[id];
      return { customs: s.customs.filter(c => c.id !== id), active: a, levels: l };
    });
    this.mixChanged();
    delete this.buffers[id];
    delete this.blobs[id];
  }

  setPractice(log: Lull['practice']) {
    this.practiceOff?.();
    this.practice = log;
    this.practiceOff = log?.subscribe(() => this.emit());
    this.emit();
  }

  // ─── breathing ───
  /** The daily goal only shapes the calendar; unlike the pattern or length, it doesn't restart a session. */
  setGoal(goal: number) {
    this.set(s => ({ relax: { ...s.relax, goal } }));
  }

  setRelax(patch: Partial<Omit<State['relax'], 'goal'>>) {
    this.set(s => ({ relax: { ...s.relax, ...patch } }));
    if (this.s.breath) this.startBreath();
  }

  startBreath() { this.openBreath(this.s.relax.p, this.s.relax.min); }

  /** A new session rings the gong; restarting one (a pattern or length change) doesn't. */
  openBreath(p: PatternId, min: number) {
    const now = Date.now();
    if (!this.s.breath) {
      this.gong.prime();
      this.gong.ring();
    } else this.logBreath(this.s.breath, false, now);
    this.s.breath = { p, i: -1, ends: now + 2000, cycles: 0, until: min ? now + 2000 + min * 60000 : null, started: now + 2000, min };
    this.s.now = now;
    this.emit();
    clearInterval(this.biv);
    this.biv = setInterval(() => this.btick(), 200);
  }

  btick(now = Date.now()) {
    const b = this.s.breath;
    if (!b) { clearInterval(this.biv); return; }
    if (b.until && now >= b.until) { this.closeBreath(true, true); return; }
    if (now >= b.ends) {
      const steps = PATTERNS[b.p].steps;
      let i = b.i + 1;
      if (i >= steps.length) { i = 0; b.cycles++; }
      b.i = i;
      b.ends = now + steps[i][1] * 1000;
    }
    this.s.now = now;
    this.emit();
  }

  /**
   * Ends the session with the gong, when it finishes or is stopped; leaving the screen passes `gong: false`.
   * A session of a minute or more goes into the practice log either way.
   */
  closeBreath(gong = true, completed = false) {
    if (this.s.breath) this.logBreath(this.s.breath, completed, Date.now());
    if (gong && this.s.breath) this.gong.ring();
    this.s.breath = null;
    clearInterval(this.biv);
    this.last = Date.now();
    this.emit();
  }

  private logBreath(b: Breath, completed: boolean, now: number) {
    const seconds = Math.floor((Math.min(now, b.until ?? now) - b.started) / 1000);
    if (seconds < MIN_SECONDS || !this.practice) return;
    const s: Omit<Session, 'id'> = { pattern: b.p, started_at: new Date(b.started).toISOString(), seconds, rounds: b.cycles, planned_min: b.min, completed };
    this.practice.record(s);
  }

  // ─── dim ───
  goDim() { this.s.dim = true; this.emit(); }
  wake() { this.last = Date.now(); this.s.dim = false; this.emit(); }
  touch() { this.last = Date.now(); }
}

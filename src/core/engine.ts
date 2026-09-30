import { isIOS } from './constants';
import { fadeSeconds } from './format';
import { buildSound, genNoise, type Built, type Noise } from './recipes';

/** What an engine needs to know to make sound. */
export interface PlayState {
  playing: boolean;
  active: Record<string, boolean>;
  levels: Record<string, number>;
  wave: number;
  timer: number;
  fade: number;
  endsAt: number | null;
  buffers: Record<string, AudioBuffer>;
  /** Recorded clips per built-in sound (Haunt's one-shots, and so on), once loaded. */
  assets?: Record<string, AudioBuffer[]>;
}

export interface Engine {
  /** Must be called inside the tap handler (iOS unlocks audio only there). */
  start(p: PlayState): void;
  stop(): void;
  /** Mix levels or sounds changed. */
  update(p: PlayState): void;
  setWave(p: PlayState): void;
  /** The timer or fade changed while playing. */
  schedule(p: PlayState): void;
  destroy(): void;
}

export const levelOf = (p: PlayState, id: string) => p.levels[id] ?? 0.5;
export const wanted = (p: PlayState, id: string) => p.playing && !!p.active[id] && levelOf(p, id) > 0;

/** One-shots are scheduled this far ahead on the audio clock, so throttled timers in the background can keep up. */
const SCATTER_AHEAD = 180;

/** A sound's clips and the time its one-shots may start from, as `buildSound` takes them. */
export const assetsFor = (p: PlayState, id: string, from: number) => {
  const clips = p.assets?.[id];
  return clips?.length ? { clips, from } : undefined;
};

/** The live Web Audio engine, a port of the reference `lull-core.js`. */
export class LiveEngine implements Engine {
  ctx?: AudioContext;
  master?: GainNode;
  noise?: Noise;
  el: HTMLAudioElement | null = null;
  nodes: Record<string, Built> = {};
  susp?: ReturnType<typeof setTimeout>;
  scatter?: ReturnType<typeof setInterval>;

  ensureCtx() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    try {
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (nav.audioSession) nav.audioSession.type = 'playback';
    } catch { /* not supported */ }
    // On iPhone, route through an <audio> element so playback survives the lock screen.
    try {
      if (isIOS && ctx.createMediaStreamDestination) {
        const dest = ctx.createMediaStreamDestination();
        this.master.connect(dest);
        const el = new Audio();
        el.setAttribute('playsinline', '');
        el.srcObject = dest.stream;
        this.el = el;
      } else this.master.connect(ctx.destination);
    } catch {
      this.master.connect(ctx.destination);
    }
    this.noise = genNoise(ctx);
    return ctx;
  }

  sync(p: PlayState) {
    if (!this.ctx || !this.noise || !this.master) return;
    const t = this.ctx.currentTime;
    new Set([...Object.keys(this.nodes), ...Object.keys(p.active)]).forEach(id => {
      const want = wanted(p, id);
      let n = this.nodes[id];
      if (want && !n) {
        const built = buildSound(this.ctx!, id, this.noise!, p.wave, this.master!, p.buffers[id], assetsFor(p, id, t));
        if (!built) return;
        n = this.nodes[id] = built;
        built.scatter?.fill(t + SCATTER_AHEAD);
      }
      if (!n) return;
      n.g.gain.setTargetAtTime(want ? (p.levels[id] ?? 0.5) * n.base : 0, t, 0.25);
      if (!want) {
        delete this.nodes[id];
        setTimeout(() => {
          try {
            n.srcs.forEach(x => x.stop());
            n.extra.forEach(o => o.stop());
            n.g.disconnect();
          } catch { /* already stopped */ }
        }, 1500);
      }
    });
  }

  /** The timer fade lives on the audio clock, so it still happens while JS timers are throttled. */
  schedule(p: PlayState) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime, m = this.master.gain;
    m.cancelScheduledValues(t);
    m.setValueAtTime(m.value, t);
    m.linearRampToValueAtTime(1, t + 2.5);
    if (p.timer && p.endsAt) {
      const total = Math.max(3, (p.endsAt - Date.now()) / 1000);
      const fade = fadeSeconds(p.timer, p.fade);
      m.setValueAtTime(1, t + Math.max(2.6, total - fade));
      m.linearRampToValueAtTime(0, t + total);
    }
  }

  start(p: PlayState) {
    const ctx = this.ensureCtx();
    clearTimeout(this.susp);
    ctx.resume();
    if (this.el)
      this.el.play().catch(() => {
        try { this.master!.disconnect(); } catch { /* not connected */ }
        this.master!.connect(ctx.destination);
        this.el = null;
      });
    this.sync(p);
    this.schedule(p);
    clearInterval(this.scatter);
    this.scatter = setInterval(() => {
      const t = this.ctx!.currentTime;
      Object.values(this.nodes).forEach(n => n.scatter?.fill(t + SCATTER_AHEAD));
    }, 30000);
  }

  stop() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime, m = this.master.gain;
    m.cancelScheduledValues(t);
    m.setValueAtTime(m.value, t);
    m.linearRampToValueAtTime(0, t + 1);
    clearTimeout(this.susp);
    clearInterval(this.scatter);
    this.susp = setTimeout(() => {
      this.ctx?.suspend();
      this.el?.pause();
    }, 2500);
  }

  update(p: PlayState) {
    this.sync(p);
  }

  setWave(p: PlayState) {
    const n = this.nodes.ocean;
    if (!n?.setWave || !this.ctx) return;
    const t = this.ctx.currentTime;
    n.setWave(p.wave, t);
    n.scatter?.fill(t + SCATTER_AHEAD);
  }

  destroy() {
    clearTimeout(this.susp);
    clearInterval(this.scatter);
    try {
      this.el?.pause();
      this.ctx?.close();
    } catch { /* closing */ }
  }
}

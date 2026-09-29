/**
 * Lock-screen safe mode.
 *
 * iOS is most dependable in the background when it's playing a plain <audio> element,
 * so the current mix is rendered offline into a seamless loop (a WAV Blob) and played that way.
 * iOS ignores `audio.volume`, so the timer fade is baked into separate fade segments.
 */
import { fadeSeconds } from './format';
import { buildSound, crossfadeLoop, genNoise } from './recipes';
import { levelOf, wanted, type Engine, type PlayState } from './engine';

export const SAFE_RATE = 32000; // plenty for noise; keeps a 2-minute stereo loop around 15 MB
const TARGET_LOOP = 120;
const TAIL = 0.5;

/** Loop length in seconds. With Ocean on, a whole number of waves so the swell never jumps. */
export const loopSeconds = (wave: number, oceanOn: boolean, target = TARGET_LOOP) =>
  oceanOn ? Math.max(1, Math.round(target / wave)) * wave : target;

/** Seconds rendered and thrown away first, so the wash delay line and filters have settled. Whole waves, to keep phase. */
export const preRoll = (wave: number) => Math.ceil(4 / wave) * wave;

/** How many loop-length fade segments to use, and the resulting fade length. Never longer than the timer. */
export const fadePlan = (timerMin: number, fadeMin: number, loopSec: number) => {
  let k = Math.max(1, Math.round(fadeSeconds(timerMin, fadeMin) / loopSec));
  while (k > 1 && k * loopSec > timerMin * 60) k--;
  return { segments: k, seconds: k * loopSec };
};

/**
 * 16-bit PCM WAV. `gainAt(i)` scales sample i; `rotate` starts the output at that sample of the loop
 * (so a fade can begin exactly where the loop was playing).
 */
export const encodeWav = (chs: Float32Array[], sr: number, gainAt?: (i: number) => number, rotate = 0): ArrayBuffer => {
  const n = chs[0].length, nch = chs.length, bytes = n * nch * 2;
  const buf = new ArrayBuffer(44 + bytes), v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * nch * 2, true); v.setUint16(32, nch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, bytes, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    const src = (i + rotate) % n, g = gainAt ? gainAt(i) : 1;
    for (let c = 0; c < nch; c++) {
      const x = Math.max(-1, Math.min(1, chs[c][src] * g));
      v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
      o += 2;
    }
  }
  return buf;
};

export interface Loop {
  key: string;
  pcm: Float32Array[];
  seconds: number;
  url: string;
}

const mixKey = (p: PlayState) => {
  const on = Object.keys(p.active).filter(id => wanted({ ...p, playing: true }, id)).sort();
  return JSON.stringify([on.map(id => [id, Math.round(levelOf(p, id) * 100), !!p.buffers[id]]), on.includes('ocean') ? p.wave : 0]);
};

/** Render the mix into a seamless loop. */
export const renderLoop = async (p: PlayState): Promise<Omit<Loop, 'url'>> => {
  const key = mixKey(p);
  const on = Object.keys(p.active).filter(id => wanted({ ...p, playing: true }, id));
  const oceanOn = on.includes('ocean');
  const L = loopSeconds(p.wave, oceanOn), W = oceanOn ? preRoll(p.wave) : 1;
  const sr = SAFE_RATE, len = Math.round(L * sr), fade = Math.round(TAIL * sr), off = Math.round(W * sr);
  const ctx = new OfflineAudioContext(2, off + len + fade, sr);
  const noise = genNoise(ctx);
  for (const id of on) {
    const b = buildSound(ctx, id, noise, p.wave, ctx.destination, p.buffers[id]);
    if (b) b.g.gain.value = levelOf(p, id) * b.base;
  }
  const out = await ctx.startRendering();
  const pcm = [0, 1].map(ch => crossfadeLoop(out.getChannelData(ch).subarray(off), len, fade));
  return { key, pcm, seconds: L };
};

const wavUrl = (buf: ArrayBuffer) => URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
const SILENCE = () => wavUrl(encodeWav([new Float32Array(SAFE_RATE), new Float32Array(SAFE_RATE)], SAFE_RATE));

export class SafeEngine implements Engine {
  el: HTMLAudioElement;
  loop: Loop | null = null;
  p: PlayState | null = null;
  phase: 'idle' | 'loop' | 'fade' = 'idle';
  fade = { start: 0, segments: 1, index: 0, rotate: 0, url: '' };
  rendering: Promise<void> | null = null;
  debounce?: ReturnType<typeof setTimeout>;
  watch?: ReturnType<typeof setInterval>;
  silence = '';

  /** `onFinished` is called when the last fade segment ends. */
  constructor(private onFinished: () => void) {
    const el = new Audio();
    el.setAttribute('playsinline', '');
    el.preload = 'auto';
    el.addEventListener('ended', () => this.ended());
    el.addEventListener('timeupdate', () => this.check());
    this.el = el;
  }

  /** Render ahead of time, so a tap can start the real loop immediately. */
  prepare(p: PlayState) {
    this.p = p;
    if (this.loop?.key === mixKey(p)) return Promise.resolve();
    if (!this.rendering)
      this.rendering = renderLoop(p)
        .then(r => {
          const old = this.loop;
          this.loop = { ...r, url: wavUrl(encodeWav(r.pcm, SAFE_RATE)) };
          this.swap();
          if (old) setTimeout(() => URL.revokeObjectURL(old.url), 5000);
        })
        .catch(e => console.error('[lull] render failed', e))
        .finally(() => {
          this.rendering = null;
          // The mix may have changed while rendering.
          if (this.p && this.loop?.key !== mixKey(this.p)) this.prepare(this.p);
        });
    return this.rendering;
  }

  /** Put the current loop on the element, keeping the position when already playing. */
  swap() {
    if (this.phase !== 'loop' || !this.loop) return;
    if (this.el.src === this.loop.url) return;
    const pos = this.el.src === this.silence ? 0 : this.el.currentTime % this.loop.seconds;
    this.el.src = this.loop.url;
    this.el.loop = true;
    const go = () => {
      try { this.el.currentTime = pos; } catch { /* not seekable yet */ }
    };
    this.el.addEventListener('loadedmetadata', go, { once: true });
    this.el.play().catch(e => console.warn('[lull] play', e));
  }

  start(p: PlayState) {
    this.p = p;
    this.phase = 'loop';
    const ready = this.loop && this.loop.key === mixKey(p);
    if (!ready) {
      // Unlock the element inside the tap with silence, then swap in the loop once rendered.
      this.silence ||= SILENCE();
      this.el.src = this.silence;
      this.el.loop = true;
    } else {
      this.el.src = this.loop!.url;
      this.el.loop = true;
    }
    this.el.play().catch(e => console.warn('[lull] play', e));
    if (!ready) this.prepare(p);
    clearInterval(this.watch);
    this.watch = setInterval(() => this.check(), 1000);
    this.check();
  }

  stop() {
    this.phase = 'idle';
    clearInterval(this.watch);
    this.el.pause();
  }

  update(p: PlayState) {
    this.p = p;
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.prepare(p), 800);
  }

  setWave(p: PlayState) {
    this.update(p);
  }

  schedule(p: PlayState) {
    this.p = p;
    if (this.phase === 'fade') {
      // The timer changed mid-fade: go back to the loop and let check() decide again.
      this.phase = 'loop';
      this.swap();
    }
    this.check();
  }

  /** Switch to the fade segments when their time comes. Driven by timeupdate and a 1 s interval. */
  check() {
    const p = this.p, loop = this.loop;
    if (this.phase !== 'loop' || !p || !loop || !p.timer || !p.endsAt || this.el.src !== loop.url) return;
    const plan = fadePlan(p.timer, p.fade, loop.seconds);
    const start = p.endsAt - plan.seconds * 1000, now = Date.now();
    if (now < start) return;
    const index = Math.min(plan.segments - 1, Math.floor((now - start) / (loop.seconds * 1000)));
    this.phase = 'fade';
    this.fade = { start, segments: plan.segments, index, rotate: Math.round((this.el.currentTime % loop.seconds) * SAFE_RATE), url: '' };
    this.playSegment();
  }

  /** Segment i is the loop with the gain ramping from 1 - i/k to 1 - (i+1)/k. */
  playSegment() {
    const loop = this.loop!, f = this.fade, n = loop.pcm[0].length;
    if (f.index >= f.segments) {
      this.phase = 'idle';
      this.onFinished();
      return;
    }
    const url = wavUrl(encodeWav(loop.pcm, SAFE_RATE, i => 1 - (f.index + i / n) / f.segments, f.rotate));
    const old = f.url;
    f.url = url;
    this.el.loop = false;
    this.el.src = url;
    this.el.play().catch(e => console.warn('[lull] play', e));
    if (old) URL.revokeObjectURL(old);
  }

  ended() {
    if (this.phase !== 'fade') return;
    this.fade.index++;
    this.playSegment();
  }

  destroy() {
    clearInterval(this.watch);
    clearTimeout(this.debounce);
    this.el.pause();
  }
}

/**
 * Plays one journey, start to finish, on its own audio path so the sleep sounds carry on underneath.
 *
 * - Live: its own AudioContext, with short rendered chunks scheduled back to back (no seams).
 * - Safe (iPhone): a plain <audio> element playing one-minute WAV segments chained on `ended`, the
 *   way safe mode chains its fade segments, so it keeps going on the lock screen.
 *
 * The gong for a return ending is mixed into the audio itself, so it rings on time even while
 * the page's timers are asleep.
 */
import { decode } from './files';
import { JourneyVoice, gongAt, type Journey, type Output } from './journeys';
import { encodeWav } from './safeMode';

const GONG_URL = '/sounds/gong.mp3';
const GONG_LEVEL = 0.55;
/** Stopping by hand is never a cut. */
const STOP_FADE = 3;

export interface JourneyPlayer {
  start(): void;
  stop(): void;
  setOutput(o: Output): void;
  destroy(): void;
}

/** Add `clip` (starting at absolute sample `at`) into a chunk that starts at absolute sample `pos`. */
const mixClip = (out: Float32Array[], pos: number, clip: Float32Array[] | null, at: number | null, gain: number) => {
  if (!clip || at == null) return;
  const len = out[0].length, from = Math.max(pos, at), to = Math.min(pos + len, at + clip[0].length);
  for (let i = from; i < to; i++) for (let c = 0; c < 2; c++) out[c][i - pos] += clip[Math.min(c, clip.length - 1)][i - at] * gain;
};

const loadGong = (rate: number) =>
  fetch(GONG_URL)
    .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
    .then(d => decode(d, rate))
    .then(b => [0, 1].map(c => b.getChannelData(Math.min(c, b.numberOfChannels - 1))))
    .catch(() => null);

/** Ring through the silent switch on iPhone, like the sleep sounds. */
const playbackSession = () => {
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = 'playback';
  } catch { /* not supported */ }
};

export class LiveJourney implements JourneyPlayer {
  private ctx: AudioContext;
  private master: GainNode;
  private voice: JourneyVoice;
  private next = 0;
  /** Absolute samples rendered. */
  private pos = 0;
  private timer?: ReturnType<typeof setInterval>;
  private gong: Float32Array[] | null = null;
  private over = false;

  /** Seconds per chunk, and how far ahead to keep: enough to ride out throttled timers in a background tab. */
  static CHUNK = 1;
  static AHEAD = 8;

  constructor(private j: Journey, output: Output, private onEnd: () => void) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    playbackSession();
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.voice = new JourneyVoice(j, this.ctx.sampleRate, output);
    loadGong(this.ctx.sampleRate).then(g => { this.gong = g; });
  }

  start() {
    this.ctx.resume();
    this.next = this.ctx.currentTime + 0.1;
    this.pump();
    this.timer = setInterval(() => this.pump(), 500);
  }

  private pump() {
    const { ctx } = this, sr = ctx.sampleRate, ga = gongAt(this.j);
    while (!this.over && this.next < ctx.currentTime + LiveJourney.AHEAD) {
      const len = Math.round(LiveJourney.CHUNK * sr), buf = ctx.createBuffer(2, len, sr);
      const out: [Float32Array, Float32Array] = [buf.getChannelData(0), buf.getChannelData(1)];
      this.voice.render(len, out);
      mixClip(out, this.pos, this.gong, ga == null ? null : Math.round(ga * sr), GONG_LEVEL);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.master);
      src.start(this.next);
      this.next += LiveJourney.CHUNK;
      this.pos += len;
      // Done once the tone is silent and the gong has rung out.
      if (this.voice.done && (!this.gong || ga == null || this.pos >= Math.round(ga * sr) + this.gong[0].length)) {
        this.over = true;
        clearInterval(this.timer);
        setTimeout(() => { this.destroy(); this.onEnd(); }, Math.max(0, (this.next - ctx.currentTime) * 1000));
      }
    }
  }

  setOutput(o: Output) { this.voice.output = o; }

  stop() {
    this.over = true;
    clearInterval(this.timer);
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, STOP_FADE / 4);
    setTimeout(() => this.destroy(), STOP_FADE * 1000 + 200);
  }

  destroy() {
    clearInterval(this.timer);
    if (this.ctx.state !== 'closed') this.ctx.close().catch(() => {});
  }
}

/** Plenty for these tones and their soft noise; a one-minute stereo segment is about 5 MB. */
const SAFE_JOURNEY_RATE = 22050;
const SEGMENT = 60;
/** The first segment is short, so it renders inside the tap and the journey starts at once. */
const FIRST = 8;
/** A few ms of fade at each segment edge, so the brief gap between segments is a soft dip, not a click. */
const EDGE = Math.round(0.006 * SAFE_JOURNEY_RATE);

interface Segment { pcm: Float32Array[]; url: string }

export class SafeJourney implements JourneyPlayer {
  el: HTMLAudioElement;
  private voice: JourneyVoice;
  private pos = 0;
  private cur: Segment | null = null;
  private queued: Segment | null = null;
  private gong: Float32Array[] | null = null;
  private state: 'playing' | 'stopping' | 'over' = 'playing';

  constructor(private j: Journey, output: Output, private onEnd: () => void) {
    this.voice = new JourneyVoice(j, SAFE_JOURNEY_RATE, output);
    const el = new Audio();
    el.setAttribute('playsinline', '');
    el.preload = 'auto';
    el.addEventListener('ended', () => this.ended());
    // Paused from the lock screen or control centre: that ends the journey.
    el.addEventListener('pause', () => { if (this.state === 'playing' && !el.ended) this.finish(); });
    this.el = el;
    loadGong(SAFE_JOURNEY_RATE).then(g => { this.gong = g; });
  }

  /** Render the next segment, or null once the journey (and its gong) are over. */
  private render(seconds: number): Segment | null {
    const ga = gongAt(this.j), at = ga == null ? null : Math.round(ga * SAFE_JOURNEY_RATE);
    if (this.voice.done && (at == null || !this.gong || this.pos >= at + this.gong[0].length)) return null;
    const len = Math.round(seconds * SAFE_JOURNEY_RATE);
    const pcm = this.voice.render(len);
    mixClip(pcm, this.pos, this.gong, at, GONG_LEVEL);
    this.pos += len;
    const n = pcm[0].length;
    const url = URL.createObjectURL(new Blob([encodeWav(pcm, SAFE_JOURNEY_RATE, i => Math.min(1, i / EDGE, (n - 1 - i) / EDGE))], { type: 'audio/wav' }));
    return { pcm, url };
  }

  start() {
    playbackSession();
    this.cur = this.render(FIRST);
    if (!this.cur) return this.finish();
    this.el.src = this.cur.url;
    this.el.play().catch(e => console.warn('[lull] journey play', e));
    setTimeout(() => this.prepare(), 50);
  }

  /** Render the following segment while this one plays, so `ended` only has to swap it in. */
  private prepare() {
    if (this.state === 'playing' && !this.queued) this.queued = this.render(SEGMENT);
  }

  private ended() {
    if (this.state === 'stopping') return this.finish();
    if (this.state !== 'playing') return;
    this.prepare();
    const old = this.cur;
    this.cur = this.queued;
    this.queued = null;
    if (old) URL.revokeObjectURL(old.url);
    if (!this.cur) return this.finish();
    this.el.src = this.cur.url;
    this.el.play().catch(e => console.warn('[lull] journey play', e));
    setTimeout(() => this.prepare(), 50);
  }

  /** Takes effect from the next segment (within a minute). */
  setOutput(o: Output) { this.voice.output = o; }

  /** iOS ignores volume, so the fade is a short segment cut from where the journey is now. */
  stop() {
    if (this.state !== 'playing' || !this.cur) return this.finish();
    this.state = 'stopping';
    const sr = SAFE_JOURNEY_RATE, from = Math.round(this.el.currentTime * sr), len = STOP_FADE * sr;
    const src = this.cur.pcm, next = this.queued?.pcm;
    const pcm = [0, 1].map(c => {
      const d = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        const k = from + i;
        d[i] = k < src[c].length ? src[c][k] : next ? next[c][k - src[c].length] ?? 0 : 0;
      }
      return d;
    });
    const url = URL.createObjectURL(new Blob([encodeWav(pcm, sr, i => (1 - i / len) ** 2)], { type: 'audio/wav' }));
    this.drop();
    this.cur = { pcm, url };
    this.el.src = url;
    this.el.play().catch(() => this.finish());
  }

  private drop() {
    for (const s of [this.cur, this.queued]) if (s) URL.revokeObjectURL(s.url);
    this.cur = this.queued = null;
  }

  private finish() {
    if (this.state === 'over') return;
    const natural = this.state === 'playing';
    this.state = 'over';
    this.destroy();
    if (natural) this.onEnd();
  }

  destroy() {
    this.state = 'over';
    this.el.pause();
    this.drop();
  }
}

/**
 * Sound recipes shared by the live engine (AudioContext) and safe mode (OfflineAudioContext).
 * Everything is generated on the device; there are no audio files.
 */
export interface Noise {
  white: AudioBuffer;
  pink: AudioBuffer;
  brown: AudioBuffer;
}

export type NoiseKind = keyof Noise;

/** One channel of noise, `total` samples long. Pink uses the Paul Kellet filter; brown is leaky-integrated. */
export const noiseSamples = (kind: NoiseKind, total: number, rand: () => number = Math.random) => {
  const d = new Float32Array(total);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < total; i++) {
    const w = rand() * 2 - 1;
    if (kind === 'white') d[i] = w * 0.5;
    else if (kind === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    } else {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  }
  return d;
};

/**
 * Make a seamless loop of `len` samples from `src` (which must hold at least len + fade samples):
 * the extra tail is crossfaded into the head, so sample len-1 flows into sample 0.
 */
export const crossfadeLoop = (src: Float32Array, len: number, fade: number, out = new Float32Array(len)) => {
  for (let i = 0; i < len; i++) out[i] = src[i];
  for (let i = 0; i < fade; i++) {
    const a = i / fade;
    out[i] = src[i] * a + src[len + i] * (1 - a);
  }
  return out;
};

/** 10 s stereo loops; the channels are independent, which sounds wider on headphones. */
export const genNoise = (ctx: BaseAudioContext, seconds = 10): Noise => {
  const sr = ctx.sampleRate, len = Math.floor(sr * seconds), fade = Math.floor(sr * 0.5);
  const gen = (kind: NoiseKind) => {
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) crossfadeLoop(noiseSamples(kind, len + fade), len, fade, buf.getChannelData(ch));
    return buf;
  };
  return { white: gen('white'), pink: gen('pink'), brown: gen('brown') };
};

/**
 * Running water, one channel: many tiny bubbles, each a short sine that rises in pitch as it decays
 * (big bubbles ring low and long, small ones high and short). Poisson-timed, with the density
 * drifting slowly so the water surges and eases. Normalized to an RMS of 0.1.
 */
export const bubbleSamples = (sr: number, total: number, rand: () => number = Math.random, rate = 400) => {
  const d = new Float32Array(total);
  // A bank of bubble shapes, 1/16 octave apart: placing them is then just addition (fast enough for a tap).
  const lo = 300, hi = 2500, span = Math.log(hi / lo), K = 48;
  const bank = Array.from({ length: K }, (_, k) => {
    const f = lo * Math.exp((span * k) / (K - 1)), tau = 0.015 - (0.011 * k) / (K - 1);
    const n = Math.floor(tau * 5 * sr), b = new Float32Array(n);
    for (let i = 0, ph = 0; i < n; i++) {
      const tt = i / sr;
      ph += (2 * Math.PI * f * (1 + (0.15 * tt) / tau)) / sr;
      b[i] = Math.sin(ph) * Math.exp(-tt / tau);
    }
    return b;
  });
  const drift = rand() * 2 * Math.PI;
  for (let t = 0; ; ) {
    t += -Math.log(1 - rand()) / (rate * (0.65 + 0.35 * Math.sin((2 * Math.PI * t) / 7.3 + drift)));
    const start = Math.floor(t * sr);
    if (start >= total) break;
    const b = bank[Math.floor(rand() * K)], amp = 0.3 + 0.7 * rand();
    const n = Math.min(total - start, b.length);
    for (let i = 0; i < n; i++) d[start + i] += amp * b[i];
  }
  let sq = 0;
  for (let i = 0; i < total; i++) sq += d[i] * d[i];
  const k = 0.1 / Math.sqrt(sq / total || 1);
  for (let i = 0; i < total; i++) d[i] *= k;
  return d;
};

/** A 20 s stereo loop of bubbles (channels independent). Built on first use; about 0.1 s of work. */
const bubbleCache = new WeakMap<BaseAudioContext, AudioBuffer>();
export const genBubbles = (ctx: BaseAudioContext, seconds = 20) => {
  let buf = bubbleCache.get(ctx);
  if (buf) return buf;
  const sr = ctx.sampleRate, len = Math.floor(sr * seconds), fade = Math.floor(sr * 0.5);
  buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) crossfadeLoop(bubbleSamples(sr, len + fade), len, fade, buf.getChannelData(ch));
  bubbleCache.set(ctx, buf);
  return buf;
};

/** Level multipliers, so that equal slider positions sound roughly equally loud. */
export const BASE: Record<string, number> = { white: 0.3, pink: 0.55, brown: 0.8, rain: 0.5, fan: 1.2, stream: 1.05, ocean: 1.1, shore: 1, brook: 1, haunt: 1 };
export const CUSTOM_BASE = 1;

/** How one-shots are strewn over time: ranges are [lo, hi], drawn uniformly per clip. */
export interface ScatterOpts {
  /** Seconds before the first clip. */
  first: [number, number];
  /** Seconds between clip starts; a function so a live setting (the wave slider) applies to the next gap. */
  gap: () => [number, number];
  gain: [number, number];
  pan: [number, number];
  /** Playback rate, which shifts pitch and length together. */
  rate?: [number, number];
}

/** Haunt: the first scare comes soon, so turning it on doesn't seem to do nothing. */
export const HAUNT_SCATTER: ScatterOpts = { first: [4, 14], gap: () => [20, 90], gain: [0.85, 1.4], pan: [-0.8, 0.8] };

const between = ([lo, hi]: [number, number], rand: () => number) => lo + rand() * (hi - lo);

/** Draws clip indexes from a shuffled bag, refilled when empty, never the same clip twice running. */
export const clipBag = (n: number, rand: () => number = Math.random) => {
  let bag: number[] = [], last = -1;
  return () => {
    if (!bag.length) {
      bag = [...Array(n).keys()];
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      if (n > 1 && bag[bag.length - 1] === last) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
    }
    return (last = bag.pop()!);
  };
};

export interface Scatter {
  /** Schedule clips that start before `until` (context time). Safe to call repeatedly. */
  fill(until: number): void;
  /** Drop clips scheduled after `now` and carry on from there, so a changed setting is heard soon. */
  reset(now: number): void;
  /** Longest clip it can play, in seconds at the slowest rate. */
  longest: number;
}

/** One-shots at random times from `start`, each with its own level, rate and place in the stereo field. */
export const scatter = (
  ctx: BaseAudioContext,
  clips: AudioBuffer[],
  dest: AudioNode,
  start: number,
  srcs: AudioScheduledSourceNode[],
  o: ScatterOpts,
  rand: () => number = Math.random,
): Scatter => {
  const pick = clipBag(clips.length, rand);
  const at = new Map<AudioBufferSourceNode, number>();
  let next = start + between(o.first, rand), heard = start;
  return {
    longest: Math.max(0, ...clips.map(c => c.duration)) / (o.rate?.[0] ?? 1),
    reset(now) {
      for (const [s, t] of at) {
        if (t <= now) { heard = Math.max(heard, t); continue; }
        s.onended = null;
        s.stop();
        s.disconnect();
        at.delete(s);
        const i = srcs.indexOf(s);
        if (i >= 0) srcs.splice(i, 1);
      }
      // The next clip keeps its distance from the last one heard, at the new spacing.
      next = Math.max(now + 0.5, heard + between(o.gap(), rand));
    },
    fill(until) {
      for (; next < until; next += between(o.gap(), rand)) {
        const s = ctx.createBufferSource(), g = ctx.createGain(), pan = ctx.createStereoPanner();
        s.buffer = clips[pick()];
        if (o.rate) s.playbackRate.value = between(o.rate, rand);
        g.gain.value = between(o.gain, rand);
        pan.pan.value = between(o.pan, rand);
        s.connect(g); g.connect(pan); pan.connect(dest);
        s.onended = () => {
          const i = srcs.indexOf(s);
          if (i >= 0) srcs.splice(i, 1);
          heard = Math.max(heard, at.get(s) ?? heard);
          at.delete(s);
          pan.disconnect();
        };
        s.start(next);
        at.set(s, next);
        srcs.push(s);
      }
    },
  };
};

export interface Built {
  srcs: AudioScheduledSourceNode[];
  extra: OscillatorNode[];
  g: GainNode;
  base: number;
  scatter?: Scatter;
  /** Ocean: change the average wave spacing (seconds) from now on. */
  setWave?: (wave: number, now: number) => void;
}

/**
 * Build one sound's graph into `dest` through its own gain `g` (starting at 0).
 * Returns null when a custom file or a sound's recordings aren't loaded.
 */
export const buildSound = (
  ctx: BaseAudioContext,
  id: string,
  noise: Noise,
  wave: number,
  dest: AudioNode,
  custom?: AudioBuffer,
  /** This sound's recorded clips, and the context time scattered one-shots may start from. */
  assets?: { clips: AudioBuffer[]; from: number },
): Built | null => {
  const srcs: AudioScheduledSourceNode[] = [], extra: OscillatorNode[] = [];
  const g = ctx.createGain();
  g.gain.value = 0;
  g.connect(dest);
  const loop = (buf: AudioBuffer) => {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    // A random offset so layered loops don't line up.
    s.start(0, Math.random() * Math.max(0, buf.duration - 0.1));
    srcs.push(s);
    return s;
  };
  const filt = (type: BiquadFilterType, f: number, q?: number) => {
    const n = ctx.createBiquadFilter();
    n.type = type;
    n.frequency.value = f;
    if (q != null) n.Q.value = q;
    return n;
  };
  const lfo = (rate: number, depth: number, target: AudioParam) => {
    const o = ctx.createOscillator();
    o.frequency.value = rate;
    const og = ctx.createGain();
    og.gain.value = depth;
    o.connect(og);
    og.connect(target);
    o.start(0);
    extra.push(o);
  };
  const pipe = (...n: AudioNode[]) => {
    for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]);
  };
  /** For a sound whose recording or file isn't loaded (yet). */
  const none = () => {
    g.disconnect();
    return null;
  };
  let more: Partial<Built> = {};
  switch (id) {
    case 'white': pipe(loop(noise.white), g); break;
    case 'pink': pipe(loop(noise.pink), g); break;
    case 'brown': pipe(loop(noise.brown), g); break;
    case 'rain': {
      const m = ctx.createGain(); m.gain.value = 0.9; lfo(0.13, 0.08, m.gain);
      pipe(loop(noise.white), filt('highpass', 900, 0.5), filt('lowpass', 6500, 0.5), m, g);
      break;
    }
    case 'fan': {
      const p = filt('peaking', 160, 1.2); p.gain.value = 5;
      pipe(loop(noise.brown), filt('lowpass', 420, 0.7), p, g);
      break;
    }
    case 'stream': {
      // Bubbles for the water itself, over a soft band of pink noise for the rush.
      pipe(loop(genBubbles(ctx)), g);
      const rush = ctx.createGain(); rush.gain.value = 0.35;
      pipe(loop(noise.pink), filt('highpass', 300, 0.5), filt('lowpass', 4000, 0.5), rush, g);
      break;
    }
    case 'ocean': {
      // Recorded waves breaking at random over the same beach heard from further off (muffled, low).
      if (!assets || assets.clips.length < 2) return none();
      const [bed, ...waves] = assets.clips;
      const far = ctx.createGain(); far.gain.value = 0.3;
      pipe(loop(bed), filt('lowpass', 900, 0.5), far, g);
      // Each wave arrives 0.7–1.3× the slider's spacing after the last, a little bigger or smaller,
      // slower or quicker (playback rate), and from a slightly different angle.
      let w = wave;
      const sc = scatter(ctx, waves, g, assets.from, srcs, { first: [0.5, 3], gap: () => [w * 0.7, w * 1.3], gain: [0.55, 1], pan: [-0.35, 0.35], rate: [0.9, 1.08] });
      more = { scatter: sc, setWave: (v, now) => { w = v; sc.reset(now); } };
      break;
    }
    case 'shore':
    case 'brook': {
      if (!assets?.clips.length) return none();
      pipe(loop(assets.clips[0]), g);
      break;
    }
    case 'haunt': {
      // Nothing until the clips have loaded: the bed alone would just be a drone.
      if (!assets?.clips.length) return none();
      // Bed: wind that gusts and shifts pitch, over a low, slowly beating drone a tritone apart.
      const wf = filt('bandpass', 520, 1.4); lfo(0.07, 260, wf.frequency);
      const wm = ctx.createGain(); wm.gain.value = 0.12; lfo(0.045, 0.07, wm.gain);
      pipe(loop(noise.pink), wf, wm, g);
      const dg = ctx.createGain(); dg.gain.value = 0.013;
      const dlp = filt('lowpass', 320, 0.7);
      pipe(dlp, dg, g);
      for (const f of [55, 55.35, 77.8]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        o.connect(dlp);
        o.start(0);
        extra.push(o);
      }
      more = { scatter: scatter(ctx, assets.clips, g, assets.from, srcs, HAUNT_SCATTER) };
      break;
    }
    default:
      if (!custom) return none();
      pipe(loop(custom), g);
  }
  return { srcs, extra, g, base: BASE[id] ?? CUSTOM_BASE, ...more };
};

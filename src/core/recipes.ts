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

/** Level multipliers, so that equal slider positions sound roughly equally loud. */
export const BASE: Record<string, number> = { white: 0.3, pink: 0.55, brown: 0.8, rain: 0.5, fan: 1.2, stream: 1.4, ocean: 1.1, haunt: 1 };
export const CUSTOM_BASE = 1;

/** Seconds between scares. The first comes sooner, so turning Haunt on doesn't seem to do nothing. */
export const SCARE_FIRST: [number, number] = [4, 14];
export const SCARE_GAP: [number, number] = [20, 90];

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

export interface Scarer {
  /** Schedule scares that start before `until` (context time). Safe to call repeatedly. */
  fill(until: number): void;
}

/** Scares at random times from `start`, each with its own level and place in the stereo field. */
export const scarer = (ctx: BaseAudioContext, clips: AudioBuffer[], dest: AudioNode, start: number, srcs: AudioScheduledSourceNode[], rand: () => number = Math.random): Scarer => {
  const pick = clipBag(clips.length, rand);
  let next = start + between(SCARE_FIRST, rand);
  return {
    fill(until) {
      for (; next < until; next += between(SCARE_GAP, rand)) {
        const s = ctx.createBufferSource(), g = ctx.createGain(), pan = ctx.createStereoPanner();
        s.buffer = clips[pick()];
        g.gain.value = 0.85 + rand() * 0.55;
        pan.pan.value = rand() * 1.6 - 0.8;
        s.connect(g); g.connect(pan); pan.connect(dest);
        s.onended = () => {
          const i = srcs.indexOf(s);
          if (i >= 0) srcs.splice(i, 1);
          pan.disconnect();
        };
        s.start(next);
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
  osc?: OscillatorNode;
  dl?: DelayNode;
  scare?: Scarer;
}

/**
 * Build one sound's graph into `dest` through its own gain `g` (starting at 0).
 * Returns null when a custom buffer isn't available.
 */
export const buildSound = (
  ctx: BaseAudioContext,
  id: string,
  noise: Noise,
  wave: number,
  dest: AudioNode,
  custom?: AudioBuffer,
  /** Haunt's one-shots, and the context time its scares may start from. */
  scares?: { clips: AudioBuffer[]; from: number },
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
      const m = ctx.createGain(); m.gain.value = 0.85; lfo(0.35, 0.15, m.gain);
      pipe(loop(noise.pink), filt('bandpass', 1400, 0.6), m, g);
      break;
    }
    case 'ocean': {
      // Asymmetric swell: slow build, quicker fall. Body = filtered brown noise; wash = hiss trailing each crest.
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(ctx.createPeriodicWave(new Float32Array([0, 0, 0.15]), new Float32Array([0, 1, 0.3])));
      osc.frequency.value = 1 / wave;
      osc.start(0);
      extra.push(osc);
      const lp = filt('lowpass', 650, 0.5);
      const lm = ctx.createGain(); lm.gain.value = 450; osc.connect(lm); lm.connect(lp.frequency);
      const sw = ctx.createGain(); sw.gain.value = 0.55;
      const sm = ctx.createGain(); sm.gain.value = 0.45; osc.connect(sm); sm.connect(sw.gain);
      pipe(loop(noise.brown), lp, sw, g);
      const dl = ctx.createDelay(10); dl.delayTime.value = wave * 0.18;
      const wg = ctx.createGain(); wg.gain.value = 0.1;
      const wm = ctx.createGain(); wm.gain.value = 0.1;
      osc.connect(dl); dl.connect(wm); wm.connect(wg.gain);
      pipe(loop(noise.white), filt('bandpass', 2400, 0.5), wg, g);
      more = { osc, dl };
      break;
    }
    case 'haunt': {
      // Nothing until the clips have loaded: the bed alone would just be a drone.
      if (!scares?.clips.length) {
        g.disconnect();
        return null;
      }
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
      more = { scare: scarer(ctx, scares.clips, g, scares.from, srcs) };
      break;
    }
    default:
      if (!custom) {
        g.disconnect();
        return null;
      }
      pipe(loop(custom), g);
  }
  return { srcs, extra, g, base: BASE[id] ?? CUSTOM_BASE, ...more };
};

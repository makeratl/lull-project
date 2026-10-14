/**
 * Journeys: tones that move. Each is a few keyframes over time (beat rate, pitch, warmth, air, level).
 * A journey plays once, start to finish, and always ends in silence; it never loops.
 *
 * Rendered sample by sample from journey time rather than as a node graph, so it can be rendered in
 * short chunks that butt together seamlessly (phases carry across chunks). The same chunks can feed
 * the live engine (scheduled buffers) and safe mode (chained one-shot WAV segments).
 */

export type JourneyId = 'focus' | 'unwind' | 'dream' | 'drift' | 'intention';
/** Headphones: binaural (each ear its own tone). Speaker: monaural (the beat is in the air, works anywhere). */
export type Output = 'headphones' | 'speaker';
/** Return: comes back up and closes with the gong. Dissolve: thins into the beds or silence, no gong. */
export type Ending = 'return' | 'dissolve';

export interface Params {
  /** Beat rate in Hz: the difference between the two tones. */
  beat: number;
  /** The tone's base pitch in Hz. */
  pitch: number;
  /** 0 is a near-pure tone, 1 adds a sub-octave and soft overtones. */
  warmth: number;
  /** Soft brown-noise breath under the tone, 0–1. */
  air: number;
  /** 0–1. */
  level: number;
}

/** A keyframe: minutes from the start, and any params that change (the rest carry forward). */
export interface Frame extends Partial<Params> {
  at: number;
}

export interface Journey {
  id: JourneyId;
  name: string;
  sub: string;
  ending: Ending;
  frames: Frame[];
}

/**
 * Starting points, to be tuned by ear in design/journey-lab.html. Every journey starts at alpha
 * (about where a waking mind is), arrives from silence and ends at level 0.
 */
export const JOURNEYS: Journey[] = [
  {
    id: 'focus', name: 'Focus', sub: 'Settle in, then sharpen', ending: 'return',
    frames: [
      { at: 0, beat: 10, pitch: 200, warmth: 0.35, air: 0.15, level: 0 },
      { at: 1, level: 0.8 },
      { at: 6, beat: 14 },
      { at: 9, beat: 15.5, pitch: 210 },
      { at: 22, beat: 15.5 },
      { at: 24, beat: 11, level: 0.6 },
      { at: 25, level: 0 },
    ],
  },
  {
    id: 'unwind', name: 'Unwind', sub: 'Let the day go', ending: 'return',
    frames: [
      { at: 0, beat: 10, pitch: 180, warmth: 0.5, air: 0.25, level: 0 },
      { at: 1, level: 0.8 },
      { at: 6, beat: 8 },
      { at: 11, beat: 7.5 },
      { at: 13.5, beat: 9, level: 0.6 },
      { at: 15, level: 0 },
    ],
  },
  {
    id: 'dream', name: 'Dream', sub: 'Down into sleep, and stay there', ending: 'dissolve',
    frames: [
      { at: 0, beat: 10, pitch: 150, warmth: 0.6, air: 0.3, level: 0 },
      { at: 1.5, level: 0.75 },
      { at: 10, beat: 7 },
      { at: 20, beat: 4.5, pitch: 136 },
      { at: 30, beat: 2.5, pitch: 120, level: 0.6, air: 0.4 },
      { at: 36, beat: 2, level: 0.3 },
      { at: 40, level: 0 },
    ],
  },
  {
    id: 'drift', name: 'Drift Out', sub: 'A long descent, a still place, a slow return', ending: 'return',
    frames: [
      { at: 0, beat: 10, pitch: 136.1, warmth: 0.55, air: 0.2, level: 0 },
      { at: 1.5, level: 0.8 },
      { at: 8, beat: 7 },
      { at: 15, beat: 4.2 },
      { at: 33, beat: 4, air: 0.3 },
      { at: 38, beat: 8.5, level: 0.7, air: 0.2 },
      { at: 39.5, beat: 10, level: 0.5 },
      { at: 40, level: 0 },
    ],
  },
  {
    id: 'intention', name: 'Intention', sub: 'Hold one thing in mind', ending: 'return',
    frames: [
      { at: 0, beat: 10, pitch: 170, warmth: 0.45, air: 0.2, level: 0 },
      { at: 1, level: 0.8 },
      { at: 6, beat: 7.8 },
      { at: 15, beat: 7.8 },
      { at: 18.5, beat: 11, pitch: 180, level: 0.7 },
      { at: 20, level: 0 },
    ],
  },
];

export const journeyById = (id: JourneyId) => JOURNEYS.find(j => j.id === id)!;

/** Length in seconds. */
export const durationOf = (j: Journey) => j.frames[j.frames.length - 1].at * 60;

/** Return endings ring the gong as the last tone fades. */
export const GONG_BEFORE_END = 20;
export const gongAt = (j: Journey) => (j.ending === 'return' ? Math.max(0, durationOf(j) - GONG_BEFORE_END) : null);

/** Every frame with all params filled in from the frames before it. */
export const resolveFrames = (j: Journey): (Params & { at: number })[] => {
  let cur = j.frames[0] as Params & { at: number };
  return j.frames.map(f => (cur = { ...cur, ...f }));
};

const smooth = (u: number) => u * u * (3 - 2 * u);

/** Params at `t` seconds into the journey: eased between frames, with the beat eased in log space. */
export const paramsAt = (frames: (Params & { at: number })[], t: number): Params => {
  const m = t / 60;
  if (m <= frames[0].at) return frames[0];
  const last = frames[frames.length - 1];
  if (m >= last.at) return last;
  let i = 1;
  while (frames[i].at < m) i++;
  const a = frames[i - 1], b = frames[i], u = smooth((m - a.at) / (b.at - a.at));
  const mix = (x: number, y: number) => x + (y - x) * u;
  return {
    beat: Math.exp(mix(Math.log(a.beat), Math.log(b.beat))),
    pitch: mix(a.pitch, b.pitch),
    warmth: mix(a.warmth, b.warmth),
    air: mix(a.air, b.air),
    level: mix(a.level, b.level),
  };
};

export type Band = 'delta' | 'theta' | 'alpha' | 'beta' | 'gamma';
export const bandOf = (beat: number): Band =>
  beat < 4 ? 'delta' : beat < 8 ? 'theta' : beat < 13 ? 'alpha' : beat < 30 ? 'beta' : 'gamma';

/** Samples per block: params are computed once per block, level is ramped across it. */
const BLOCK = 128;
const TAU = 2 * Math.PI;
/** Keeps the loudest moment (level 1, full warmth and air) under about 0.6. */
const MASTER = 0.42;

/**
 * Renders one journey in order, chunk after chunk. `speed` compresses journey time for auditioning
 * (60 plays a 40-minute journey in 40 seconds); the beat itself always sounds at its real rate.
 */
export class JourneyVoice {
  /** Journey seconds rendered so far. */
  t = 0;
  readonly duration: number;
  private frames: (Params & { at: number })[];
  /** Phases: the beat pair's low and high tone, sub-octave, 2nd and 3rd harmonics. */
  private ph = [0, 0, 0, 0, 0];
  private noise = [0, 0];
  /** Real samples rendered. Blocks are counted from it, so chunk sizes never change the sound. */
  private n = 0;
  /** The current block: phase steps, amplitudes, and the level it ramps between. */
  private b = { w: [0, 0, 0, 0, 0], a: [0, 0, 0, 0], lvl0: 0, lvl1: 0 };

  constructor(
    j: Journey,
    private sr: number,
    public output: Output,
    public speed = 1,
    private rand: () => number = Math.random,
  ) {
    this.frames = resolveFrames(j);
    this.duration = durationOf(j);
    this.b.lvl1 = this.frames[0].level;
  }

  /** Over, and the last fade has reached silence. */
  get done() {
    return this.t >= this.duration && this.b.lvl0 === 0 && this.b.lvl1 === 0;
  }

  /** Params are computed once per block; the level ramps across it. */
  private nextBlock() {
    const p = paramsAt(this.frames, this.t), sr = this.sr, b = this.b;
    b.w = [p.pitch - p.beat / 2, p.pitch + p.beat / 2, p.pitch * 0.5, p.pitch * 2, p.pitch * 3].map(f => (TAU * f) / sr);
    b.a = [0.18 * p.warmth, 0.3 * p.warmth, 0.12 * p.warmth, 3 * p.air];
    b.lvl0 = b.lvl1;
    b.lvl1 = p.level;
    this.t += (BLOCK / sr) * this.speed;
  }

  /** The next `len` samples, stereo. Silence once the journey is over. */
  render(len: number, out: [Float32Array, Float32Array] = [new Float32Array(len), new Float32Array(len)]) {
    const [L, R] = out, sr = this.sr, ph = this.ph, noise = this.noise, b = this.b;
    const binaural = this.output === 'headphones';
    // Speaker: unequal tones, so the beat is a gentle swell rather than a full on/off pulse.
    const [aLo, aHi] = binaural ? [0.5, 0.5] : [0.42, 0.22];
    for (let i = 0; i < len; i++) {
      const k = this.n % BLOCK;
      if (k === 0) {
        for (let q = 0; q < 5; q++) ph[q] %= TAU;
        this.nextBlock();
      }
      const [aSub, a2, a3, aAir] = b.a;
      // A slow swell (about 13 s), so a held tone still breathes.
      const swell = 1 + 0.06 * Math.sin((TAU * this.n++) / (13 * sr));
      const g = MASTER * swell * (b.lvl0 + ((b.lvl1 - b.lvl0) * k) / BLOCK);
      const lo = Math.sin(ph[0]), hi = Math.sin(ph[1]);
      const shared = aSub * Math.sin(ph[2]) + a2 * Math.sin(ph[3]) + a3 * Math.sin(ph[4]);
      // Leaky-integrated white noise (brown), independent per ear.
      noise[0] = (noise[0] + 0.02 * (this.rand() * 2 - 1)) / 1.02;
      noise[1] = (noise[1] + 0.02 * (this.rand() * 2 - 1)) / 1.02;
      if (binaural) {
        L[i] = g * (aLo * lo + shared + aAir * noise[0]);
        R[i] = g * (aHi * hi + shared + aAir * noise[1]);
      } else {
        const tone = aLo * lo + aHi * hi + shared;
        L[i] = g * (tone + aAir * noise[0]);
        R[i] = g * (tone + aAir * noise[1]);
      }
      for (let q = 0; q < 5; q++) ph[q] += b.w[q];
    }
    return out;
  }
}

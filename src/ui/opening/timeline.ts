/**
 * The Lull opening: moonrise over still water, then the moon glides into the Sleep screen's play button.
 * A pure function of time (like Waywyrd's rite), so it can be tested and captured frame-exact.
 *
 * Full (first open on a device), in seconds:
 *   0–0.5 dark · 0.5–1.5 the horizon draws out from the centre · 1.2–3.2 the moon rises behind it
 *   2.2–3.6 the reflection gathers, stroke by stroke, rippling · 3.0–3.9 "Lull" · 4.2–5.4 the scene lets go:
 *   water and word fade, the moon lifts free of the horizon and settles into the play button, the app shows through.
 * Short (later opens): the scene fades up already risen, holds briefly, then the same exit.
 * Still (reduced motion): a plain fade.
 * Skipping jumps straight to a quick exit.
 */
export type OpeningMode = 'full' | 'short' | 'still';

export const FULL = { horizon: [0.5, 1.5], rise: [1.2, 3.2], refl: [2.2, 3.6], word: [3.0, 3.9], out: [4.2, 5.4] } as const;
export const SHORT = { in: [0, 0.35], out: [0.9, 1.9] } as const;
export const STILL = { out: [0.2, 0.6] } as const;
export const SKIP_OUT = 0.6;

export interface OpeningState {
  /** 0–1 how much of the horizon is drawn (from the centre outwards) */
  horizon: number;
  /** 0–1 the moon's rise: 0 = just below the horizon, 1 = resting */
  rise: number;
  /** per reflection stroke, 0–1 opacity factor */
  refl: [number, number, number, number];
  /** 0–1 the wordmark */
  word: number;
  /** 0–1 the glide from the resting place into the play button */
  glide: number;
  /** 0–1 the water and word letting go */
  release: number;
  /** 0–1 the dark backdrop (1 = opaque) */
  veil: number;
  /** 0–1 the whole overlay's opacity (only the still mode fades out as a whole) */
  fade: number;
  done: boolean;
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const span = (t: number, [a, b]: readonly [number, number]) => clamp((t - a) / (b - a));
export const easeInOut = (v: number) => (v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2);
export const easeOut = (v: number) => 1 - Math.pow(1 - v, 3);

/**
 * The exit beats over [a, b]: water and word go first, the moon glides, the veil lifts.
 * The moon lands exactly on the real play button, which takes its place on the last frame, so nothing crossfades.
 */
const exit = (t: number, a: number, b: number) => {
  const d = b - a;
  return {
    release: easeOut(span(t, [a, a + d * 0.5])),
    glide: easeInOut(span(t, [a + d * 0.15, b])),
    veil: 1 - easeInOut(span(t, [a + d * 0.35, b])),
    fade: 1,
  };
};

/**
 * @param t seconds since the opening started
 * @param skipAt when the user skipped (seconds), if they did
 */
export function openingAt(t: number, mode: OpeningMode, skipAt: number | null = null): OpeningState {
  const rest = { horizon: 1, rise: 1, refl: [1, 1, 1, 1] as OpeningState['refl'], word: 1 };

  if (mode === 'still') {
    const o = span(t, STILL.out);
    return { ...rest, glide: 0, release: o, veil: 1 - o, fade: 1 - o, done: o >= 1 };
  }

  // After a skip, the exit starts from wherever the scene was and runs quickly.
  const outStart = skipAt != null ? Math.min(skipAt, mode === 'full' ? FULL.out[0] : SHORT.out[0]) : null;
  const outRange: [number, number] =
    outStart != null ? [outStart, outStart + SKIP_OUT] : mode === 'full' ? [...FULL.out] : [...SHORT.out];

  let scene: Omit<OpeningState, 'glide' | 'release' | 'veil' | 'fade' | 'done'>;
  if (mode === 'short') {
    const v = easeOut(span(t, SHORT.in));
    scene = { horizon: 1, rise: 1, refl: [v, v, v, v], word: v * 0.9 };
  } else {
    const r = span(t, FULL.refl), step = 0.2;
    const stroke = (i: number) => easeOut(clamp((r * (FULL.refl[1] - FULL.refl[0]) - i * step) / 0.6));
    scene = {
      horizon: easeOut(span(t, FULL.horizon)),
      rise: easeInOut(span(t, FULL.rise)),
      refl: [stroke(0), stroke(1), stroke(2), stroke(3)],
      word: easeOut(span(t, FULL.word)),
    };
  }
  // A skip freezes the scene where it was, so nothing jumps forward before letting go.
  if (outStart != null && t > outStart && mode === 'full') {
    const frozen = openingAt(outStart, mode);
    scene = { horizon: frozen.horizon, rise: frozen.rise, refl: frozen.refl, word: frozen.word };
  }
  // The backdrop is opaque from the first frame in every mode, so the app never flashes before the scene.
  return { ...scene, ...exit(t, outRange[0], outRange[1]), done: t >= outRange[1] };
}

/** Total length when nobody skips. */
export const duration = (mode: OpeningMode) => (mode === 'full' ? FULL.out[1] : mode === 'short' ? SHORT.out[1] : STILL.out[1]);

export type SoundId = 'ocean' | 'rain' | 'fan' | 'stream' | 'brown' | 'pink' | 'white';

export interface SoundDef {
  id: string;
  name: string;
  note: string;
  custom?: boolean;
}

export const SOUNDS: SoundDef[] = [
  { id: 'ocean', name: 'Ocean', note: 'Waves, no gulls' },
  { id: 'rain', name: 'Rain', note: 'Steady shower' },
  { id: 'fan', name: 'Fan', note: 'Low whir' },
  { id: 'stream', name: 'Stream', note: 'Moving water' },
  { id: 'brown', name: 'Brown', note: 'Deep rumble' },
  { id: 'pink', name: 'Pink', note: 'Soft, balanced' },
  { id: 'white', name: 'White', note: 'Bright hiss' },
];

/** October only: a dark bed with scares dropped in at random. */
export const HAUNT: SoundDef = { id: 'haunt', name: 'Haunt', note: 'Whispers & screams' };

/** One-shots in public/sounds/haunt/, built from Chatterbox lines and ACE-Step screams. */
export const HAUNT_CLIPS = [
  'behind-you', 'come-play', 'dont-fall-asleep', 'i-see-you', 'let-me-in', 'listening', 'so-cold', 'still-awake', 'the-light', 'under-the-bed',
  'groan', 'howl', 'moan', 'no', 'shriek', 'wail', 'knock',
].map(n => `/sounds/haunt/${n}.mp3`);

/**
 * Whether Haunt is offered: in October, unless overridden by `?haunt=on|off` (which is remembered)
 * or `localStorage['lull.haunt']`.
 */
export const hauntSeason = (now: Date, search = '', storage: Pick<Storage, 'getItem' | 'setItem'> | null = null) => {
  const q = new URLSearchParams(search).get('haunt');
  try {
    if (q === 'on' || q === 'off') storage?.setItem('lull.haunt', q);
    const v = storage?.getItem('lull.haunt');
    if (v === 'on' || v === 'off') return v === 'on';
  } catch { /* private mode */ }
  if (q === 'on' || q === 'off') return q === 'on';
  return now.getMonth() === 9;
};

export type PatternId ='478' | 'box' | 'even';
/** [label, seconds, inhaled (1) or exhaled (0)] */
export type Step = [string, number, 0 | 1];

export const PATTERNS: Record<PatternId, { name: string; sub: string; steps: Step[] }> = {
  '478': { name: '4-7-8', sub: 'For falling asleep', steps: [['Breathe in', 4, 1], ['Hold', 7, 1], ['Breathe out', 8, 0]] },
  box: { name: 'Box', sub: 'Quiet a busy mind', steps: [['Breathe in', 4, 1], ['Hold', 4, 1], ['Breathe out', 4, 0], ['Hold', 4, 0]] },
  even: { name: '5-5', sub: 'Slow and even', steps: [['Breathe in', 5, 1], ['Breathe out', 5, 0]] },
};

export interface Mix {
  name: string;
  mix: Record<string, number>;
}

export const PRESETS: Mix[] = [
  { name: 'Just the ocean', mix: { ocean: 0.75 } },
  { name: 'Ocean & brown', mix: { ocean: 0.65, brown: 0.25 } },
  { name: 'Rain on the roof', mix: { rain: 0.7, brown: 0.3 } },
];

export const TIMERS = [15, 30, 60, 90, 0] as const;
export const FADES = [5, 10, 20] as const;
export const LENGTHS = [3, 5, 10, 0] as const;

export const isIOS =
  typeof navigator !== 'undefined' &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

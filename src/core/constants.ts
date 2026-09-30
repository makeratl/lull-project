export type SoundId = 'ocean' | 'shore' | 'rain' | 'fan' | 'stream' | 'brook' | 'brown' | 'pink' | 'white' | 'haunt';

export type GroupId = 'water' | 'noise' | 'seasonal' | 'yours';

export interface SoundDef {
  id: string;
  name: string;
  note: string;
  group: GroupId;
  custom?: boolean;
}

/** The library's sections, in order. */
export const GROUPS: { id: GroupId; name: string }[] = [
  { id: 'water', name: 'Water' },
  { id: 'noise', name: 'Hum & noise' },
  { id: 'seasonal', name: 'Seasonal' },
  { id: 'yours', name: 'Your sounds' },
];

export const SOUNDS: SoundDef[] = [
  { id: 'ocean', name: 'Ocean', note: 'Waves, no gulls', group: 'water' },
  { id: 'shore', name: 'Shore', note: 'A real beach, recorded', group: 'water' },
  { id: 'rain', name: 'Rain', note: 'Steady shower', group: 'water' },
  { id: 'stream', name: 'Stream', note: 'Moving water', group: 'water' },
  { id: 'brook', name: 'Brook', note: 'A real creek, recorded', group: 'water' },
  { id: 'fan', name: 'Fan', note: 'Low whir', group: 'noise' },
  { id: 'brown', name: 'Brown', note: 'Deep rumble', group: 'noise' },
  { id: 'pink', name: 'Pink', note: 'Soft, balanced', group: 'noise' },
  { id: 'white', name: 'White', note: 'Bright hiss', group: 'noise' },
  { id: 'haunt', name: 'Haunt', note: 'Whispers & screams', group: 'seasonal' },
];

/** A painting per sound in public/art/ (built by scripts/art.sh); the user's own files share one. */
export const artFor = (s: SoundDef) => `/art/${s.custom ? 'yours' : s.id}.webp`;

/**
 * Recorded clips per built-in sound, in public/sounds/, loaded when the sound is first turned on.
 * Built by scripts/haunt.sh and scripts/recordings.ts (sources and credits in public/sounds/CREDITS.md).
 */
export const ASSETS: Record<string, string[]> = {
  // Field recordings (Freesound, CC0), looped seamlessly.
  shore: ['/sounds/shore.mp3'],
  brook: ['/sounds/brook.mp3'],
  // The first is the bed (the beach, heard from further off); the rest are single breaking waves.
  ocean: ['/sounds/shore.mp3', ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => `/sounds/ocean/wave-${n}.mp3`)],
  // Chatterbox lines and ACE-Step screams.
  haunt: [
    'behind-you', 'come-play', 'dont-fall-asleep', 'i-see-you', 'let-me-in', 'listening', 'so-cold', 'still-awake', 'the-light', 'under-the-bed',
    'groan', 'howl', 'moan', 'no', 'shriek', 'wail', 'knock',
  ].map(n => `/sounds/haunt/${n}.mp3`),
};

export type PatternId = '478' | 'box' | 'even';
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

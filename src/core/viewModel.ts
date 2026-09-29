/** Everything the screens show, derived from core state. Plain data plus actions. */
import { FADES, LENGTHS, PATTERNS, SOUNDS, TIMERS, type PatternId, type Step } from './constants';
import { fadeSeconds, fmt, rounds, statusLine } from './format';
import type { Lull } from './lull';

export const viewModel = (c: Lull, name = '') => {
  const s = c.s, now = s.now;
  const clock = new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const rem = s.endsAt ? s.endsAt - now : null;
  const oceanOn = !!s.active.ocean;
  const b = s.breath, P = b ? PATTERNS[b.p] : null;
  const step: Step | null = b ? (b.i < 0 ? ['Settle in', 2, 0] : P!.steps[b.i]) : null;
  const R = PATTERNS[s.relax.p];
  const trimmed = name.trim();

  return {
    clock,
    greeting: trimmed ? `Good night, ${trimmed}.` : 'Good night.',
    mixLabel: c.mixLabel(),
    playing: s.playing,
    status: statusLine({ playing: s.playing, timer: s.timer, fade: s.fade, remainingMs: rem }),
    /** The halo breathes with the waves when Ocean is on. */
    haloPeriod: oceanOn ? s.wave : 10,
    oceanOn,
    wave: s.wave,
    waveSlider: 25 - s.wave,
    waveLabel: `One wave every ${s.wave} s`,
    sounds: c.all().map(x => ({ ...x, on: !!s.active[x.id], custom: !!x.custom, pct: Math.round((s.levels[x.id] ?? 0.5) * 100) })),
    fileError: s.fileError,
    timers: TIMERS.map(v => ({ value: v, label: v ? `${v}m` : 'All night', on: s.timer === v })),
    fades: FADES.map(v => ({ value: v, label: `${v} min`, on: s.fade === v })),
    mixes: s.mixes.map((m, i) => ({
      index: i,
      name: m.name,
      mix: m.mix,
      summary: Object.entries(m.mix).map(([k, v]) => `${(SOUNDS.find(x => x.id === k) || { name: k }).name} ${Math.round(v * 100)}`).join(' · '),
      on: c.isCurrent(m.mix),
    })),
    // Relax
    relaxPatterns: (Object.keys(PATTERNS) as PatternId[]).map(id => ({ id, name: PATTERNS[id].name, sub: PATTERNS[id].sub, on: s.relax.p === id })),
    relaxLengths: LENGTHS.map(v => ({ value: v, label: v ? `${v} min` : 'Open', on: s.relax.min === v })),
    relaxName: R.name,
    relaxSub: R.sub,
    breathRunning: !!b,
    breathScale: step && step[2] ? 1 : 0.5,
    breathDur: step ? (b!.i < 0 ? 0.8 : step[1]) : 1,
    relaxLabel: step ? step[0] : 'Tap the moon to begin',
    relaxCount: b ? String(Math.max(1, Math.ceil((b.ends - now) / 1000))) : '',
    relaxMeta: b
      ? b.until
        ? `${fmt(b.until - now)} left${b.cycles ? ' · ' + rounds(b.cycles) : ''}`
        : b.cycles ? rounds(b.cycles) : 'Follow the moon'
      : s.relax.min ? `${s.relax.min} minute session` : 'Open session',
    // Dim
    dim: s.dim,
    dimBig: rem != null ? fmt(rem) : clock,
    dimSmall: rem != null ? 'until silence · tap to wake' : 'playing all night · tap to wake',
    safeMode: s.safeMode,
    fadeSeconds: fadeSeconds(s.timer, s.fade),
  };
};

export type ViewModel = ReturnType<typeof viewModel>;

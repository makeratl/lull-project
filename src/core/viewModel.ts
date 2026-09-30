/** Everything the screens show, derived from core state. Plain data plus actions. */
import { FADES, GOALS, GROUPS, LENGTHS, PATTERNS, SOUNDS, TIMERS, artFor, type PatternId, type Step } from './constants';
import { fadeSeconds, fmt, rounds, statusLine } from './format';
import type { Lull } from './lull';
import { addDays, byDay, dayKey, streaks } from './practice';

export const viewModel = (c: Lull, name = '') => {
  const s = c.s, now = s.now;
  const clock = new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const rem = s.endsAt ? s.endsAt - now : null;
  const oceanOn = !!s.active.ocean;
  const b = s.breath, P = b ? PATTERNS[b.p] : null;
  const step: Step | null = b ? (b.i < 0 ? ['Settle in', 2, 0] : P!.steps[b.i]) : null;
  const R = PATTERNS[s.relax.p];
  const trimmed = name.trim();
  const log = c.practice?.sessions ?? [], days = byDay(log), today = dayKey(now), streak = streaks(days.keys(), today);
  let week = 0;
  for (let i = 0; i < 7; i++) week += days.get(addDays(today, -i))?.minutes ?? 0;
  const weekMin = Math.round(week);
  const sounds = c.all().map(x => ({ ...x, on: !!s.active[x.id], custom: !!x.custom, art: artFor(x), pct: Math.round((s.levels[x.id] ?? 0.5) * 100) }));

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
    waveLabel: `About one wave every ${s.wave} s`,
    sounds,
    /** What's playing tonight: the mixer rows. */
    tonight: sounds.filter(x => x.on),
    /** The library, by group. Your sounds is always shown (it holds "Add your own"). */
    library: GROUPS.map(g => {
      const list = sounds.filter(x => x.group === g.id), on = list.filter(x => x.on);
      return { ...g, sounds: list, summary: on.length ? `${on.map(x => x.name).join(', ')} on` : '' };
    }).filter(g => g.sounds.length || g.id === 'yours'),
    timerSummary: s.timer ? `${s.timer} min · fades over ${Math.round(fadeSeconds(s.timer, s.fade) / 60)} min` : 'All night',
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
    practice: {
      has: log.length > 0,
      current: streak.current,
      longest: streak.longest,
      weekMinutes: weekMin,
      goal: s.relax.goal,
      todayMinutes: Math.round(days.get(today)?.minutes ?? 0),
      goals: GOALS.map(g => ({ value: g, label: `${g} min`, on: s.relax.goal === g })),
      /** The quiet line under the Relax pills. */
      line: streak.current ? `${streak.current}-day streak · ${weekMin} min this week` : weekMin ? `${weekMin} min this week` : 'Your practice',
    },
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

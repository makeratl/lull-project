import { afterEach, describe, expect, it, vi } from 'vitest';
import { fadeSeconds, fmt, statusLine } from '../src/core/format';
import { KEY, Lull, loadSaved } from '../src/core/lull';
import { viewModel } from '../src/core/viewModel';
import type { Engine } from '../src/core/engine';
import { bubbleSamples, clipBag, crossfadeLoop, noiseSamples, scatter } from '../src/core/recipes';
import { encodeWav, fadePlan, loopSeconds } from '../src/core/safeMode';
import { formatCode, inviteLink, isValidCode, normalizeCode } from '../shared/codes';

const memStorage = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

const stubEngine = (): Engine & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    start: () => void calls.push('start'),
    stop: () => void calls.push('stop'),
    update: () => void calls.push('update'),
    setWave: () => void calls.push('setWave'),
    schedule: () => void calls.push('schedule'),
    destroy: () => {},
  };
};

const makeCore = (saved?: object) => {
  const st = memStorage(saved ? { [KEY]: JSON.stringify(saved) } : {});
  const c = new Lull(st);
  const eng = stubEngine();
  c.engine = () => eng;
  c.live.stop = () => {};
  const gongs: string[] = [];
  c.gong = { prime: () => void gongs.push('prime'), ring: () => void gongs.push('ring') };
  return { c, eng, st, gongs };
};

let cores: Lull[] = [];
afterEach(() => {
  cores.forEach(c => c.destroy());
  cores = [];
  vi.useRealTimers();
});
const track = <T extends { c: Lull }>(x: T) => (cores.push(x.c), x);

describe('format', () => {
  it('fmt rounds up and adds hours', () => {
    expect(fmt(0)).toBe('0:00');
    expect(fmt(1)).toBe('0:01');
    expect(fmt(42 * 60000 + 10000)).toBe('42:10');
    expect(fmt(3723000)).toBe('1:02:03');
  });
  it('fade is capped at half the timer', () => {
    expect(fadeSeconds(60, 10)).toBe(600);
    expect(fadeSeconds(15, 20)).toBe(450);
    expect(fadeSeconds(0, 10)).toBe(0);
  });
  it('status copy', () => {
    expect(statusLine({ playing: false, timer: 60, fade: 10, remainingMs: null })).toBe('60 min, then silence');
    expect(statusLine({ playing: false, timer: 0, fade: 10, remainingMs: null })).toBe('Plays all night');
    expect(statusLine({ playing: true, timer: 0, fade: 10, remainingMs: null })).toBe('Playing all night');
    expect(statusLine({ playing: true, timer: 60, fade: 10, remainingMs: (42 * 60 + 10) * 1000 })).toBe('Fades out in 42:10');
    expect(statusLine({ playing: true, timer: 60, fade: 10, remainingMs: (3 * 60 + 12) * 1000 })).toBe('Fading out · 3:12');
    expect(statusLine({ playing: true, timer: 60, fade: 10, remainingMs: 600000 })).toBe('Fading out · 10:00');
  });
});

describe('state', () => {
  it('defaults', () => {
    const s = loadSaved(null, false);
    expect(s).toMatchObject({ levels: { ocean: 0.75 }, active: { ocean: true }, timer: 60, wave: 11, fade: 10, relax: { p: '478', min: 5, goal: 15 }, safeMode: false });
    // Settings saved before the goal existed pick up the default.
    expect(loadSaved('{"relax":{"p":"box","min":10}}', false).relax).toEqual({ p: 'box', min: 10, goal: 15 });
    expect(s.mixes.map(m => m.name)).toEqual(['Just the ocean', 'Ocean & brown', 'Rain on the roof']);
    expect(loadSaved(null, true).safeMode).toBe(true);
    expect(loadSaved('{"timer":0}', false).timer).toBe(0);
    expect(loadSaved('not json', false).timer).toBe(60);
  });

  it('persists to lull.v2', () => {
    const { c, st } = track(makeCore());
    c.setTimer(30);
    expect(JSON.parse(st.m.get(KEY)!)).toMatchObject({ timer: 30 });
  });

  it('play with nothing selected turns Ocean on at 0.7', () => {
    const { c, eng } = track(makeCore({ active: {}, levels: {} }));
    c.play();
    expect(c.s.active.ocean).toBe(true);
    expect(c.s.levels.ocean).toBe(0.7);
    expect(c.s.playing).toBe(true);
    expect(eng.calls).toContain('start');
    expect(viewModel(c).mixLabel).toBe('Ocean');
  });

  it('timer sets endsAt and stops at the end', () => {
    vi.useFakeTimers();
    const { c } = track(makeCore());
    c.setTimer(15);
    c.play();
    expect(c.s.endsAt! - Date.now()).toBe(15 * 60000);
    vi.advanceTimersByTime(15 * 60000 + 1000);
    expect(c.s.playing).toBe(false);
  });

  it('auto-dims after 30 s idle while playing, not while breathing', () => {
    vi.useFakeTimers();
    const { c } = track(makeCore());
    c.play();
    vi.advanceTimersByTime(29000);
    expect(c.s.dim).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(c.s.dim).toBe(true);
    c.wake();
    c.startBreath();
    vi.advanceTimersByTime(60000);
    expect(c.s.dim).toBe(false);
  });

  it('volume slider turns sounds on and off', () => {
    const { c } = track(makeCore());
    c.setLevel('rain', 0.4);
    expect(c.s.active.rain).toBe(true);
    c.setLevel('rain', 0);
    expect(c.s.active.rain).toBe(false);
  });

  it('mixes: save names, current match, apply, delete', () => {
    const { c } = track(makeCore({ active: { ocean: true, brown: true }, levels: { ocean: 0.65, brown: 0.25 } }));
    const vm = viewModel(c);
    expect(vm.mixes.find(m => m.name === 'Ocean & brown')!.on).toBe(true);
    expect(vm.mixes.find(m => m.name === 'Just the ocean')!.on).toBe(false);
    expect(vm.mixes[1].summary).toBe('Ocean 65 · Brown 25');
    c.setLevel('fan', 0.5);
    c.saveMix();
    const saved = c.s.mixes.at(-1)!;
    expect(saved.name).toBe('Ocean & Fan & Brown');
    expect(saved.mix).toEqual({ ocean: 0.65, fan: 0.5, brown: 0.25 });
    c.applyMix({ rain: 0.7, brown: 0.3 });
    expect(c.mixLabel()).toBe('Rain + Brown');
    c.deleteMix(0);
    expect(c.s.mixes[0].name).toBe('Ocean & brown');
  });

  it('custom files are left out of saved mixes', () => {
    const { c } = track(makeCore({ active: { ocean: true }, levels: { ocean: 0.5 } }));
    c.s.customs = [{ id: 'file-1', name: 'Fan at home', note: 'Your recording', group: 'yours' as const, custom: true }];
    c.setLevel('file-1', 0.6);
    c.saveMix();
    expect(c.s.mixes.at(-1)).toEqual({ name: 'Ocean', mix: { ocean: 0.5 } });
  });

  it('wave slider maps 5..20 s with slow swells on the left', () => {
    const { c } = track(makeCore());
    expect(viewModel(c).waveSlider).toBe(14);
    c.setWave(20);
    expect(viewModel(c).waveSlider).toBe(5);
    expect(viewModel(c).waveLabel).toBe('About one wave every 20 s');
    expect(viewModel(c).haloPeriod).toBe(20);
    c.toggleSound('ocean');
    expect(viewModel(c).haloPeriod).toBe(10);
  });

  it('sheet: Tonight lists what is on, the library groups sounds, the timer folds to one line', () => {
    const { c } = track(makeCore({ active: { ocean: true, brown: true }, levels: { ocean: 0.65, brown: 0.25 }, timer: 60, fade: 10 }));
    let vm = viewModel(c);
    expect(vm.tonight.map(x => [x.id, x.pct])).toEqual([['ocean', 65], ['brown', 25]]);
    expect(vm.library.map(g => g.id)).toEqual(['water', 'noise', 'seasonal', 'yours']);
    expect(vm.library.find(g => g.id === 'noise')!.summary).toBe('Brown on');
    expect(vm.library.find(g => g.id === 'water')!.sounds.map(x => x.id)).toEqual(['ocean', 'shore', 'rain', 'stream', 'brook']);
    expect(vm.tonight[0].art).toBe('/art/ocean.webp');
    expect(vm.timerSummary).toBe('60 min · fades over 10 min');
    c.setTimer(15);
    c.setFade(20);
    expect(viewModel(c).timerSummary).toBe('15 min · fades over 8 min');
    c.setTimer(0);
    vm = viewModel(c);
    expect(vm.timerSummary).toBe('All night');
    c.s.customs = [{ id: 'file-1', name: 'Fan at home', note: 'Your recording', group: 'yours', custom: true }];
    expect(viewModel(c).library.find(g => g.id === 'yours')!.sounds[0].art).toBe('/art/yours.webp');
  });

  it('greeting uses the name', () => {
    const { c } = track(makeCore());
    expect(viewModel(c).greeting).toBe('Good night.');
    expect(viewModel(c, 'Ana').greeting).toBe('Good night, Ana.');
  });
});

describe('breathing', () => {
  it('settles, steps through 4-7-8 and counts rounds', () => {
    vi.useFakeTimers();
    const { c } = track(makeCore());
    c.startBreath();
    let vm = viewModel(c);
    expect(vm.relaxLabel).toBe('Settle in');
    expect(vm.breathScale).toBe(0.5);
    expect(vm.relaxMeta).toBe('5:02 left');
    vi.advanceTimersByTime(2000);
    vm = viewModel(c);
    expect(vm.relaxLabel).toBe('Breathe in');
    expect(vm.breathScale).toBe(1);
    expect(vm.breathDur).toBe(4);
    vi.advanceTimersByTime(4000);
    expect(viewModel(c).relaxLabel).toBe('Hold');
    vi.advanceTimersByTime(7000);
    expect(viewModel(c).relaxLabel).toBe('Breathe out');
    expect(viewModel(c).breathScale).toBe(0.5);
    vi.advanceTimersByTime(8000);
    vm = viewModel(c);
    expect(vm.relaxLabel).toBe('Breathe in');
    expect(vm.relaxMeta).toMatch(/left · 1 round$/);
  });

  it('timed sessions end on their own; changing length restarts', () => {
    vi.useFakeTimers();
    const { c } = track(makeCore());
    c.setRelax({ min: 3 });
    c.startBreath();
    vi.advanceTimersByTime(60000);
    c.setRelax({ p: 'box' });
    expect(c.s.breath!.i).toBe(-1);
    expect(c.s.breath!.p).toBe('box');
    vi.advanceTimersByTime(3 * 60000 + 2500);
    expect(c.s.breath).toBeNull();
    expect(viewModel(c).relaxMeta).toBe('3 minute session');
  });

  it('the gong rings at the start and end, not on a restart or when leaving', () => {
    vi.useFakeTimers();
    const { c, gongs } = track(makeCore());
    c.setRelax({ min: 3 });
    c.startBreath();
    expect(gongs).toEqual(['prime', 'ring']);
    c.setRelax({ p: 'box' });
    expect(gongs.filter(g => g === 'ring').length).toBe(1);
    vi.advanceTimersByTime(3 * 60000 + 2500);
    expect(gongs.filter(g => g === 'ring').length).toBe(2);
    c.startBreath();
    c.closeBreath();
    expect(gongs.filter(g => g === 'ring').length).toBe(4);
    c.startBreath();
    c.closeBreath(false);
    expect(gongs.filter(g => g === 'ring').length).toBe(5);
  });

  it('changing the daily goal keeps a running session going', () => {
    const { c } = track(makeCore());
    c.startBreath();
    const b = c.s.breath;
    c.setGoal(5);
    expect(c.s.relax.goal).toBe(5);
    expect(c.s.breath).toBe(b);
    expect(viewModel(c).practice.goals.find(g => g.on)!.value).toBe(5);
  });

  it('open sessions', () => {
    const { c } = track(makeCore());
    c.setRelax({ min: 0 });
    expect(viewModel(c).relaxMeta).toBe('Open session');
    c.startBreath();
    expect(viewModel(c).relaxMeta).toBe('Follow the moon');
  });
});

describe('safe mode maths', () => {
  it('loop is two minutes, or long enough for a recording, up to three', () => {
    expect(loopSeconds([])).toBe(120);
    expect(loopSeconds([0])).toBe(120);
    expect(loopSeconds([179.2])).toBe(179);
    expect(loopSeconds([90, 150.4])).toBe(150);
    expect(loopSeconds([600])).toBe(180);
  });

  it('fade plan never exceeds the timer', () => {
    expect(fadePlan(60, 10, 120)).toEqual({ segments: 5, seconds: 600 });
    expect(fadePlan(15, 20, 120)).toEqual({ segments: 4, seconds: 480 });
    expect(fadePlan(15, 5, 190)).toEqual({ segments: 2, seconds: 380 });
    expect(fadePlan(15, 5, 190).seconds).toBeLessThanOrEqual(15 * 60);
  });

  it('crossfaded loops wrap without a jump', () => {
    const len = 48000, fade = 2400;
    const src = noiseSamples('brown', len + fade);
    const out = crossfadeLoop(src, len, fade);
    // At the wrap, sample len-1 must flow into sample 0 like any neighbouring pair does.
    const wrapStep = Math.abs(out[0] - out[len - 1]);
    let maxStep = 0;
    for (let i = 1; i < len; i++) maxStep = Math.max(maxStep, Math.abs(out[i] - out[i - 1]));
    expect(wrapStep).toBeLessThanOrEqual(maxStep);
    expect(out[0]).toBeCloseTo(src[len], 6);
  });

  it('encodes a valid WAV with gain and rotation', () => {
    const a = new Float32Array([0, 0.5, 1, -1]), b = new Float32Array([0, -0.5, 0.25, 0]);
    const v = new DataView(encodeWav([a, b], 32000));
    expect(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3))).toBe('RIFF');
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(32000);
    expect(v.getUint32(40, true)).toBe(16);
    expect(v.getInt16(44 + 4, true)).toBe(Math.round(0.5 * 0x7fff - 0.5));
    const r = new DataView(encodeWav([a, b], 32000, i => (i === 0 ? 0.5 : 1), 2));
    expect(r.getInt16(44, true)).toBe(Math.trunc(0.5 * 0x7fff));
    expect(r.getInt16(44 + 4, true)).toBe(-0x8000);
  });
});

describe('water', () => {
  it('bubbles: normalized, bounded, and different each time', () => {
    const sr = 32000, a = bubbleSamples(sr, sr * 4), b = bubbleSamples(sr, sr * 4);
    const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const rms = Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
    expect(rms).toBeCloseTo(0.1, 3);
    expect(peak(a)).toBeLessThan(1);
    expect(a.some((x, i) => x !== b[i])).toBe(true);
    // Dense enough to be water, not a drip: no silent quarter-second anywhere.
    for (let q = 0; q < 16; q++) expect(peak(a.subarray((q * sr) / 4, ((q + 1) * sr) / 4))).toBeGreaterThan(0.05);
  });
});

describe('scatter', () => {
  // Just enough of an audio context to record when clips start.
  const fakeCtx = () => {
    const started: number[] = [], stopped: number[] = [];
    const param = () => ({ value: 0 });
    const node = () => ({ connect: () => {}, disconnect: () => {} });
    const ctx = {
      createGain: () => ({ ...node(), gain: param() }),
      createStereoPanner: () => ({ ...node(), pan: param() }),
      createBufferSource: () => {
        let at = 0;
        return { ...node(), buffer: null, playbackRate: param(), onended: null, start: (t: number) => started.push((at = t)), stop: () => stopped.push(at) };
      },
    } as unknown as BaseAudioContext;
    return { ctx, started, stopped };
  };
  const clip = { duration: 5 } as AudioBuffer;

  it('spaces clips within the gap range, and a reset applies a new spacing from the last one heard', () => {
    const { ctx, started, stopped } = fakeCtx();
    let w = 10;
    const sc = scatter(ctx, [clip, clip], {} as AudioNode, 0, [], { first: [1, 2], gap: () => [w * 0.7, w * 1.3], gain: [1, 1], pan: [0, 0] });
    sc.fill(300);
    expect(started[0]).toBeGreaterThanOrEqual(1);
    expect(started[0]).toBeLessThanOrEqual(2);
    for (let i = 1; i < started.length; i++) {
      expect(started[i] - started[i - 1]).toBeGreaterThanOrEqual(7);
      expect(started[i] - started[i - 1]).toBeLessThanOrEqual(13);
    }
    // At t = 100 the slider moves to 20 s: later clips are dropped and rescheduled at the new spacing.
    const heard = started.filter(t => t <= 100), before = started.length;
    w = 20;
    sc.reset(100);
    expect(stopped.length).toBe(before - heard.length);
    sc.fill(400);
    const after = started.slice(before);
    expect(after[0] - heard.at(-1)!).toBeGreaterThanOrEqual(14);
    for (let i = 1; i < after.length; i++) expect(after[i] - after[i - 1]).toBeGreaterThanOrEqual(14);
  });
});

describe('haunt', () => {
  it('clip bag plays every clip once per round, never the same twice running', () => {
    const draw = clipBag(5);
    const seq = Array.from({ length: 200 }, draw);
    for (let r = 0; r < 40; r++) expect(new Set(seq.slice(r * 5, r * 5 + 5)).size).toBe(5);
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
    expect(Array.from({ length: 3 }, clipBag(1))).toEqual([0, 0, 0]);
  });

  it('Haunt is a regular sound', () => {
    const { c } = track(makeCore());
    expect(viewModel(c).sounds.map(x => x.id)).toContain('haunt');
  });
});

describe('invite codes', () => {
  it('normalizes and validates', () => {
    expect(normalizeCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(isValidCode('ABCD-EFGH')).toBe(true);
    expect(isValidCode('ABCD-EFG0')).toBe(false);
    expect(formatCode('abcdefgh')).toBe('ABCD-EFGH');
    expect(inviteLink('https://lull.makeratl.com/', 'abcd-efgh')).toBe('https://lull.makeratl.com/join?invite=ABCDEFGH');
  });
});

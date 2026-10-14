import { describe, expect, it } from 'vitest';
import { JOURNEYS, JourneyVoice, bandOf, durationOf, gongAt, paramsAt, resolveFrames } from '../src/core/journeys';

/** A repeatable stand-in for Math.random. */
const seeded = (s = 1) => () => ((s = (s * 16807) % 2147483647) / 2147483647);

describe('journeys', () => {
  it('every journey arrives from silence, ends in silence and starts at alpha', () => {
    for (const j of JOURNEYS) {
      const f = resolveFrames(j);
      expect(f[0].level).toBe(0);
      expect(f[f.length - 1].level).toBe(0);
      expect(bandOf(f[0].beat)).toBe('alpha');
      for (let i = 1; i < f.length; i++) expect(f[i].at).toBeGreaterThan(f[i - 1].at);
    }
  });

  it('eases between frames and holds at the ends', () => {
    const f = resolveFrames(JOURNEYS.find(j => j.id === 'dream')!);
    expect(paramsAt(f, -5).beat).toBe(10);
    expect(paramsAt(f, 10 * 60).beat).toBeCloseTo(7);
    const mid = paramsAt(f, 15 * 60).beat;
    expect(mid).toBeLessThan(7);
    expect(mid).toBeGreaterThan(4.5);
    expect(paramsAt(f, 99 * 60).level).toBe(0);
  });

  it('only return endings ring the gong, just before the end', () => {
    const drift = JOURNEYS.find(j => j.id === 'drift')!, dream = JOURNEYS.find(j => j.id === 'dream')!;
    expect(gongAt(drift)).toBe(durationOf(drift) - 20);
    expect(gongAt(dream)).toBeNull();
  });

  it('renders in chunks exactly as it renders in one go (no seams)', () => {
    const j = JOURNEYS[0], sr = 8000, len = 3000;
    const whole = new JourneyVoice(j, sr, 'headphones', 60, seeded()).render(len);
    const v = new JourneyVoice(j, sr, 'headphones', 60, seeded());
    const a = v.render(1000), b = v.render(2000);
    for (let ch = 0; ch < 2; ch++) {
      const joined = new Float32Array([...a[ch], ...b[ch]]);
      for (let i = 0; i < len; i += 37) expect(joined[i]).toBeCloseTo(whole[ch][i], 5);
    }
  });

  it('headphones split the ears; speaker plays the same tone in both', () => {
    const j = JOURNEYS[0], sr = 8000;
    const diff = (out: Float32Array[]) => out[0].reduce((s, x, i) => s + Math.abs(x - out[1][i]), 0);
    const quiet = () => 0.5; // no noise, so only the tones can differ
    const hp = new JourneyVoice(j, sr, 'headphones', 600, quiet), sp = new JourneyVoice(j, sr, 'speaker', 600, quiet);
    hp.render(sr); sp.render(sr); // past the fade-in
    expect(diff(hp.render(sr))).toBeGreaterThan(1);
    expect(diff(sp.render(sr))).toBe(0);
  });

  it('never clips and is silent once over', () => {
    for (const j of JOURNEYS) {
      const sr = 4000, v = new JourneyVoice(j, sr, 'headphones', 300, seeded());
      let peak = 0;
      while (!v.done) for (const ch of v.render(sr)) for (const x of ch) peak = Math.max(peak, Math.abs(x));
      expect(peak).toBeLessThan(0.9);
      expect(peak).toBeGreaterThan(0.05);
      for (const ch of v.render(1000)) expect(Math.max(...ch.map(Math.abs))).toBeLessThan(1e-4);
    }
  });
});

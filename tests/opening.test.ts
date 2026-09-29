import { describe, expect, it } from 'vitest';
import { FULL, SHORT, SKIP_OUT, STILL, duration, openingAt } from '../src/ui/opening/timeline';

describe('opening timeline', () => {
  it('full: dark, then horizon, moonrise, reflection, word, exit', () => {
    const a = openingAt(0, 'full');
    expect(a).toMatchObject({ horizon: 0, rise: 0, word: 0, glide: 0, veil: 1, fade: 1, done: false });
    expect(openingAt(1.5, 'full').horizon).toBe(1);
    expect(openingAt(3.2, 'full').rise).toBe(1);
    const held = openingAt(4.0, 'full');
    expect(held.refl).toEqual([1, 1, 1, 1]);
    expect(held.word).toBe(1);
    expect(held.glide).toBe(0);
    expect(held.veil).toBe(1);
    const end = openingAt(FULL.out[1], 'full');
    expect(end).toMatchObject({ glide: 1, veil: 0, release: 1, done: true });
    expect(duration('full')).toBe(FULL.out[1]);
  });

  it('reflection strokes arrive one after another', () => {
    const r = openingAt(2.6, 'full').refl;
    expect(r[0]).toBeGreaterThan(r[1]);
    expect(r[1]).toBeGreaterThan(r[2]);
    expect(r[3]).toBe(0);
  });

  it('the glide and veil only ever move one way', () => {
    let g = 0, v = 1;
    for (let t = 0; t <= FULL.out[1]; t += 0.05) {
      const s = openingAt(t, 'full');
      expect(s.glide).toBeGreaterThanOrEqual(g - 1e-9);
      expect(s.veil).toBeLessThanOrEqual(v + 1e-9);
      g = s.glide;
      v = s.veil;
    }
  });

  it('short: already risen, quick exit', () => {
    const s = openingAt(0.5, 'short');
    expect(s).toMatchObject({ horizon: 1, rise: 1, veil: 1, glide: 0 });
    expect(openingAt(SHORT.out[1], 'short').done).toBe(true);
    expect(duration('short')).toBeLessThan(2);
  });

  it('still: a plain fade with no glide', () => {
    const s = openingAt(STILL.out[1], 'still');
    expect(s).toMatchObject({ glide: 0, fade: 0, done: true });
  });

  it('skipping freezes the scene and leaves quickly', () => {
    const at = 1.0;
    const mid = openingAt(at + SKIP_OUT / 2, 'full', at);
    const frozen = openingAt(at, 'full');
    expect(mid.rise).toBe(frozen.rise);
    expect(mid.horizon).toBe(frozen.horizon);
    expect(mid.glide).toBeGreaterThan(0);
    expect(openingAt(at + SKIP_OUT, 'full', at).done).toBe(true);
    // A skip after the exit has begun doesn't restart it.
    expect(openingAt(FULL.out[1], 'full', 5.0).done).toBe(true);
  });
});

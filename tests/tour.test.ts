import { describe, expect, it } from 'vitest';
import { placeCard, tourSeen, TOUR_VERSION } from '../src/core/tour';

const view = { width: 390, height: 800 }, card = { width: 340, height: 160 };

describe('placeCard', () => {
  it('goes below a target near the top', () => {
    expect(placeCard({ top: 100, left: 100, width: 190, height: 190 }, card, view)).toEqual({ left: 25, top: 304 });
  });
  it('goes above a target near the bottom', () => {
    expect(placeCard({ top: 700, left: 120, width: 150, height: 50 }, card, view).top).toBe(700 - 14 - 160);
  });
  it('centres when there is no target, or no room either side', () => {
    expect(placeCard(null, card, view).top).toBe(320);
    expect(placeCard({ top: 100, left: 0, width: 390, height: 600 }, card, view).top).toBe(320);
  });
  it('stays inside the gutter on a narrow screen', () => {
    const p = placeCard(null, { width: 340, height: 160 }, { width: 360, height: 640 });
    expect(p.left).toBe(16);
  });
});

describe('tourSeen', () => {
  it('counts this device or the account', () => {
    expect(tourSeen(0, undefined)).toBe(false);
    expect(tourSeen(TOUR_VERSION, undefined)).toBe(true);
    expect(tourSeen(0, TOUR_VERSION)).toBe(true);
  });
  it('an older tour means not seen', () => {
    expect(tourSeen(TOUR_VERSION - 1, TOUR_VERSION - 1)).toBe(false);
  });
});

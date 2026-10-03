/** The welcome tour's pure parts: when it's due, and where its caption goes. */

/** Bump to show the tour again to everyone (say, to walk through new features). */
export const TOUR_VERSION = 1;

/** Seen if this device or the account (auth metadata, so other devices count) has seen this version. */
export const tourSeen = (local: number, account: number | undefined) => Math.max(local || 0, account || 0) >= TOUR_VERSION;

export interface Rect { top: number; left: number; width: number; height: number }

/**
 * Where the caption card goes: below the spotlight if it fits, otherwise above, otherwise centred;
 * always inside the viewport with a 16 px gutter.
 */
export const placeCard = (spot: Rect | null, card: { width: number; height: number }, view: { width: number; height: number }, gap = 14, gutter = 16) => {
  const left = Math.max(gutter, Math.min((view.width - card.width) / 2, view.width - gutter - card.width));
  if (!spot) return { left, top: Math.max(gutter, (view.height - card.height) / 2) };
  const below = spot.top + spot.height + gap, above = spot.top - gap - card.height;
  const top = below + card.height <= view.height - gutter ? below : above >= gutter ? above : (view.height - card.height) / 2;
  return { left, top: Math.max(gutter, Math.min(top, view.height - gutter - card.height)) };
};

/** Whether this person has had the welcome tour: remembered on the device and on their account. */
import { TOUR_VERSION, tourSeen } from '../core/tour';
import type { Me } from './session';

const key = (me: Me) => `lull.tour.${me.id}`;
const local = (me: Me) => {
  try { return Number(localStorage.getItem(key(me))) || 0; } catch { return 0; }
};

/** Quick check, from this device alone. */
export const seenHere = (me: Me) => tourSeen(local(me), undefined);

/**
 * Full check. On Supabase this also read the account's metadata so a tour watched on another device counted;
 * Neon Auth has no free-form user metadata, so each device now remembers for itself.
 */
export const hasSeenTour = async (me: Me) => seenHere(me);

export const markTourSeen = (me: Me) => {
  try { localStorage.setItem(key(me), String(TOUR_VERSION)); } catch { /* private mode */ }
};

/** Whether this person has had the welcome tour: remembered on the device and on their account. */
import { TOUR_VERSION, tourSeen } from '../core/tour';
import { supabase, type Me } from './session';

const key = (me: Me) => `lull.tour.${me.id}`;
const local = (me: Me) => {
  try { return Number(localStorage.getItem(key(me))) || 0; } catch { return 0; }
};

/** Quick check, from this device alone. */
export const seenHere = (me: Me) => tourSeen(local(me), undefined);

/** Full check: the account's metadata too, so a tour watched on another device counts. Offline: this device decides. */
export const hasSeenTour = async (me: Me) => {
  if (seenHere(me)) return true;
  try {
    // getUser asks the server, so a tour watched on another device since this one signed in counts.
    const { data: { user } } = await supabase.auth.getUser();
    const v = Number(user?.user_metadata?.tour) || 0;
    if (tourSeen(0, v)) {
      try { localStorage.setItem(key(me), String(v)); } catch { /* private mode */ }
      return true;
    }
  } catch { /* offline */ }
  return false;
};

export const markTourSeen = (me: Me) => {
  try { localStorage.setItem(key(me), String(TOUR_VERSION)); } catch { /* private mode */ }
  supabase.auth.updateUser({ data: { tour: TOUR_VERSION } }).catch(() => { /* offline: this device remembers */ });
};

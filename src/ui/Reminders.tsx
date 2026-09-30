import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_NUDGES, disableNudges, enableNudges, loadNudges, saveNudges, support, type Nudges } from '../auth/nudges';

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Suggested times when adding one: a morning, afternoon and evening five. */
const SUGGEST = ['08:00', '13:00', '21:00', '18:00'];

/** Daily nudges, in the Relax sheet: on/off (asks the phone first), up to three times, and which days. */
export function Reminders({ goal }: { goal: number }) {
  const [n, setN] = useState<Nudges | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const can = support();

  useEffect(() => {
    loadNudges().then(setN).catch(() => setN(DEFAULT_NUDGES));
  }, []);

  const save = (next: Nudges) => {
    setN(next);
    if (next.enabled) saveNudges(next, goal).catch(() => setNote('Couldn’t save. Are you online?'));
  };

  const toggle = async () => {
    if (!n || busy) return;
    setBusy(true);
    setNote('');
    try {
      if (n.enabled) {
        await disableNudges(n, goal);
        setN({ ...n, enabled: false });
      } else if ((await enableNudges(n, goal)) === 'denied') {
        setNote('Notifications are turned off for Lull. You can allow them in your phone’s settings, then try again.');
      } else setN({ ...n, enabled: true });
    } catch {
      setNote('Couldn’t turn nudges on. Are you online?');
    }
    setBusy(false);
  };

  if (!n) return null;
  const on = n.enabled;
  const times = [...n.times].sort();

  return (
    <div class="section">
      <span class="label">Daily nudges</span>
      <button class="toggle-row" role="switch" aria-checked={on} disabled={busy || (!on && !can.ok)} onClick={toggle}>
        <span class="mix-text">
          <span class="mix-name">Remind me to breathe</span>
          <span class="note">Only on days you haven’t reached your {goal}-minute goal yet.</span>
        </span>
        <span class={`toggle${on ? ' on' : ''}`} />
      </button>
      {!on && can.iosNeedsInstall && (
        <span class="note">On iPhone, nudges need Lull on your Home Screen: tap Share, then Add to Home Screen, and turn this on from there.</span>
      )}
      {!on && !can.iosNeedsInstall && can.blocked && <span class="note">Notifications are blocked for Lull. Allow them in your browser or phone settings first.</span>}
      {note && <span class="note" role="status">{note}</span>}

      {on && (
        <div class="nudge-config">
          <div class="nudge-times">
            {times.map(t => (
              <div key={t} class="nudge-time">
                <input
                  type="time"
                  value={t}
                  aria-label="Nudge time"
                  onChange={e => {
                    const v = (e.target as HTMLInputElement).value;
                    if (v && !n.times.includes(v)) save({ ...n, times: n.times.map(x => (x === t ? v : x)) });
                  }}
                />
                {n.times.length > 1 && <button class="x" aria-label={`Remove ${t}`} onClick={() => save({ ...n, times: n.times.filter(x => x !== t) })}>×</button>}
              </div>
            ))}
            {n.times.length < 3 && (
              <button class="link" onClick={() => save({ ...n, times: [...n.times, SUGGEST.find(s => !n.times.includes(s)) ?? '12:00'] })}>+ Add a time</button>
            )}
          </div>
          <div class="nudge-days" role="group" aria-label="Days">
            {DAYS.map((d, i) => {
              const picked = n.days.includes(i);
              return (
                <button
                  key={i}
                  class={`chip small nudge-day${picked ? ' on' : ''}`}
                  aria-pressed={picked}
                  aria-label={DAY_NAMES[i]}
                  // At least one day stays chosen; turning nudges off is the switch above.
                  onClick={() => (picked && n.days.length === 1 ? null : save({ ...n, days: picked ? n.days.filter(x => x !== i) : [...n.days, i].sort() }))}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

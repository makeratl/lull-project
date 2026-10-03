import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { placeCard, type Rect } from '../core/tour';

interface Step {
  /** The screen to show (0 Sleep, 1 Relax), or null to stay put. */
  mode: 0 | 1 | null;
  /** The element to spotlight; null for a centred card. */
  target: string | null;
  title: string;
  body: string;
}

const steps = (name: string): Step[] => [
  { mode: 0, target: null, title: `Welcome to Lull, ${name}.`, body: 'A quick look around, about 30 seconds.' },
  { mode: 0, target: '.screen.sleep .moon', title: 'Tap the moon to play.', body: 'Sound keeps going with the screen locked, and fades out when the timer ends.' },
  { mode: 0, target: '.screen.sleep .hint', title: 'Swipe up for sounds and the timer.', body: 'Layer ocean, rain, a brook or noise, set their levels, and save mixes.' },
  { mode: 1, target: '.screen.relax .bmoon-wrap', title: 'Swipe left for Relax: guided breathing.', body: 'Pick a pattern, tap the moon and follow it. A gong starts and ends each session.' },
  { mode: 1, target: '.screen.relax .streak', title: 'Every minute counts.', body: 'Sessions add up toward your daily goal and streak. Tap here for your calendar, goal and reminders.' },
  { mode: null, target: '.topbar .brand', title: 'Tap “Lull” for more.', body: 'Share an invite, your account, and this tour again.' },
  { mode: 0, target: null, title: 'That’s it. Sleep well.', body: '' },
];

const PAD = 10;
// Spotlights are pills: a circle on the moons, a capsule on wider controls.
/** The screens slide in 0.5 s; never wait longer than this for a target to settle. */
const SETTLE_MAX = 1200;

const rectOf = (sel: string | null): Rect | null => {
  if (!sel) return null;
  const r = document.querySelector(sel)?.getBoundingClientRect();
  if (!r || !r.width || !r.height) return null;
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
};

/**
 * The welcome tour: dims the app and spotlights the real controls one at a time, with a caption.
 * Show only: nothing plays or changes. Leaving is only through its buttons (or Escape).
 */
export function Tour({ name, mode, setMode, onDone }: { name: string; mode: number; setMode: (m: number) => void; onDone: () => void }) {
  const all = steps(name);
  const [i, setI] = useState(0);
  const [spot, setSpot] = useState<Rect | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const step = all[i], last = i === all.length - 1;

  const next = () => (last ? onDone() : setI(i + 1));
  const back = () => setI(Math.max(0, i - 1));

  // Go to the step's screen, then measure its target once it has stopped moving (the screens slide).
  useEffect(() => {
    if (step.mode !== null && step.mode !== mode) setMode(step.mode!);
    let raf = 0, last = '', still = 0;
    const started = performance.now();
    const settle = () => {
      const r = rectOf(step.target), k = JSON.stringify(r);
      still = k === last ? still + 1 : 0;
      last = k;
      // On screen and steady for a few frames, or give up waiting after SETTLE_MAX and use what's there.
      const onScreen = !r || (r.left + PAD >= 0 && r.left + r.width - PAD <= innerWidth);
      if ((still >= 3 && onScreen) || performance.now() - started > SETTLE_MAX) setSpot(r);
      else raf = requestAnimationFrame(settle);
    };
    // Wait a frame first, so the slide has begun before we look.
    raf = requestAnimationFrame(settle);
    const onResize = () => setSpot(rectOf(step.target));
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, [i]);

  // Place the caption next to the spotlight, once the card's own size is known.
  useLayoutEffect(() => {
    const c = card.current;
    if (!c) return;
    setPos(placeCard(spot, { width: c.offsetWidth, height: c.offsetHeight }, { width: innerWidth, height: innerHeight }));
    primary.current?.focus({ preventScroll: true });
  }, [spot, i]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDone();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') back();
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    // Capture phase, so the app's own arrow keys (switching screens) don't also fire.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  return (
    <div class="tour" role="dialog" aria-modal="true" aria-label="Welcome tour" onPointerDown={e => e.stopPropagation()}>
      <div
        class={`tour-spot${spot ? '' : ' none'}`}
        style={spot ? { top: `${spot.top}px`, left: `${spot.left}px`, width: `${spot.width}px`, height: `${spot.height}px`, borderRadius: `${Math.min(spot.width, spot.height) / 2}px` } : undefined}
      />
      <div ref={card} class="card tour-card" style={pos ? { top: `${pos.top}px`, left: `${pos.left}px` } : { visibility: 'hidden' }} aria-live="polite">
        <span class="tour-title">{step.title}</span>
        {step.body && <span class="tour-body">{step.body}</span>}
        <div class="tour-foot">
          <span class="tour-dots" aria-label={`Step ${i + 1} of ${all.length}`}>
            {all.map((_, k) => <span key={k} class={k === i ? 'on' : ''} />)}
          </span>
          <div class="tour-btns">
            {!last && <button class="tour-skip" onClick={onDone}>Skip</button>}
            {i > 0 && !last && <button class="btn-quiet" onClick={back}>Back</button>}
            <button ref={primary} class="btn-quiet tour-next" onClick={next}>{i === 0 ? 'Show me' : last ? 'Done' : 'Next'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

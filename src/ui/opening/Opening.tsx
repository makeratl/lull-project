import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { duration, openingAt, type OpeningMode } from './timeline';

const SEEN = 'lull.intro';

/** Which opening to play: full on a device's first open, short after, still under reduced motion. `?intro=full|short|still` forces one. */
export const openingMode = (): OpeningMode | null => {
  const forced = new URLSearchParams(location.search).get('intro');
  if (forced === 'full' || forced === 'short' || forced === 'still') return forced;
  if (forced === 'off') return null;
  // Nobody is watching a hidden launch, and animation frames don't run there.
  if (document.visibilityState === 'hidden') return null;
  let seen: string | null = null;
  try { seen = localStorage.getItem(SEEN); } catch { /* private mode */ }
  if (seen === 'off') return null;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 'still';
  return seen === 'seen' ? 'short' : 'full';
};

interface Geo {
  W: number;
  H: number;
  /** horizon */
  hy: number;
  hw: number;
  /** moon diameter during the scene */
  d: number;
  /** the play button: centre and diameter */
  tx: number;
  ty: number;
  td: number;
}

const measure = (): Geo => {
  const W = window.innerWidth, H = window.innerHeight;
  const d = Math.min(240, H * 0.34, W * 0.62);
  const hw = Math.min(W * 0.84, 420);
  const btn = document.querySelector('.screen.sleep .moon')?.getBoundingClientRect();
  return {
    W, H, hy: H * 0.5, hw, d,
    tx: btn ? btn.left + btn.width / 2 : W / 2,
    ty: btn ? btn.top + btn.height / 2 : H * 0.42,
    td: btn ? btn.width : d,
  };
};

const lerp = (a: number, b: number, v: number) => a + (b - a) * v;

/**
 * The moonrise opening. Renders over the app; the Sleep screen is already laid out underneath,
 * so the moon can land exactly on the real play button. Tap or any key skips.
 */
export function Opening({ mode, onReveal, onDone }: { mode: OpeningMode; onReveal: () => void; onDone: () => void }) {
  const [t, setT] = useState(0);
  const [geo, setGeo] = useState<Geo | null>(null);
  const start = useRef(performance.now());
  const skipAt = useRef<number | null>(null);
  const revealed = useRef(false);

  useLayoutEffect(() => {
    setGeo(measure());
    const onResize = () => setGeo(measure());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    // ?intro=full&at=2.5 holds the opening at one moment: for reviewing beats and frame-exact captures.
    const at = Number(new URLSearchParams(location.search).get('at'));
    if (at > 0) {
      setT(at);
      return;
    }
    let raf = 0;
    const loop = () => {
      setT((performance.now() - start.current) / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const skip = () => {
      if (skipAt.current == null) skipAt.current = (performance.now() - start.current) / 1000;
    };
    window.addEventListener('keydown', skip);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', skip);
    };
  }, []);

  const s = openingAt(t, mode, skipAt.current);
  const finished = useRef(false);
  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    try { if (localStorage.getItem(SEEN) !== 'off') localStorage.setItem(SEEN, 'seen'); } catch { /* private mode */ }
    onReveal();
    onDone();
  };

  // A wall-clock backstop: if frames stop (the tab is hidden mid-opening), the overlay still goes away.
  useEffect(() => {
    if (Number(new URLSearchParams(location.search).get('at')) > 0) return;
    const id = setTimeout(finish, (duration(mode) + 1.5) * 1000);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!revealed.current && s.veil < 1) {
      revealed.current = true;
      onReveal();
    }
    if (s.done) finish();
  }, [s.veil < 1, s.done]);

  if (!geo) return <div class="opening" />;
  const g = geo, r = g.d / 2;

  // The moon: rising from just below the horizon to rest with ~72% of its radius above it, then gliding to the button.
  const restY = g.hy - r * 0.72, lowY = g.hy + r + 6;
  const sceneY = lerp(lowY, restY, s.rise);
  const cx = lerp(g.W / 2, g.tx, s.glide), cy = lerp(sceneY, g.ty, s.glide);
  const scale = lerp(1, g.td / g.d, s.glide);
  // Whatever is below the horizon stays hidden until the water lets go.
  const below = Math.max(0, cy + r * scale - g.hy) / scale;
  const clip = below * (1 - s.release);

  const water = 1 - s.release;
  const k = g.hw / 392; // the mark's horizon is 392 units wide
  const ripple = (i: number) => Math.sin((t * 2 * Math.PI) / 5.5 + i * 0.9) * 3;

  return (
    <div
      class="opening"
      aria-hidden="true"
      style={{ opacity: s.fade }}
      onPointerDown={e => {
        e.stopPropagation();
        if (skipAt.current == null) skipAt.current = (performance.now() - start.current) / 1000;
      }}
    >
      <div class="opening-veil" style={{ opacity: s.veil }} />
      <div
        class="opening-horizon"
        style={{ top: `${g.hy - 1.5}px`, left: `${(g.W - g.hw) / 2}px`, width: `${g.hw}px`, transform: `scaleX(${s.horizon})`, opacity: 0.75 * water }}
      />
      {[0.51, 0.38, 0.245, 0.11].map((w, i) => (
        <div
          key={i}
          class="opening-stroke"
          style={{
            top: `${g.hy + (32 + i * 24) * k}px`,
            left: `${g.W / 2 - (w * g.hw) / 2}px`,
            width: `${w * g.hw}px`,
            opacity: [0.5, 0.34, 0.2, 0.12][i] * s.refl[i] * water,
            transform: `translateX(${ripple(i)}px)`,
          }}
        />
      ))}
      <div
        class="moon-surface opening-moon"
        style={{
          width: `${g.d}px`,
          height: `${g.d}px`,
          transform: `translate(${cx - r}px, ${cy - r}px) scale(${scale})`,
          // Clip only below the horizon; the negative insets leave room for the glow on the other sides.
          clipPath: clip > 0 ? `inset(${-g.d}px ${-g.d}px ${clip}px ${-g.d}px)` : 'none',
          // Divided by the scale so the glow and shading end up exactly the button's.
          boxShadow: `0 0 ${100 / scale}px rgba(205,216,234,${0.22 * Math.max(s.rise, s.glide)}), inset ${-12 / scale}px ${-16 / scale}px ${34 / scale}px rgba(60,72,96,.25)`,
        }}
      />
      <span class="opening-word" style={{ top: `${g.hy + 150 * k}px`, opacity: s.word * water, transform: `translate(-50%, ${(1 - s.word) * 10}px)` }}>
        Lull
      </span>
    </div>
  );
}

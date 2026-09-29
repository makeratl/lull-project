import { useEffect, useReducer, useRef, useState } from 'preact/hooks';
import type { Lull } from '../core/lull';
import { viewModel } from '../core/viewModel';
import { Sleep } from './Sleep';
import { Relax } from './Relax';
import { SleepSheet } from './SleepSheet';
import { RelaxSheet } from './RelaxSheet';
import type { Me } from '../auth/session';

const MODES = ['Sleep', 'Relax'] as const;
const EASE = 'transform .5s cubic-bezier(.2,.8,.2,1)';

export function Shell({ core, me, onSignOut, onAdmin }: { core: Lull; me: Me; onSignOut: () => void; onAdmin: () => void }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => core.subscribe(() => rerender(0)), [core]);

  const [mode, setModeRaw] = useState(0);
  const [sheet, setSheet] = useState(false);
  const [drag, setDrag] = useState({ x: 0, y: 0, sheet: 0, on: false });
  const g = useRef<{ x: number; y: number; axis: 'x' | 'y' | null } | null>(null);
  const sg = useRef<{ y: number } | null>(null);
  const swipedAt = useRef(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const setMode = (m: number) => {
    m = Math.max(0, Math.min(MODES.length - 1, m));
    // Leaving Relax ends a breathing session; sound keeps playing.
    if (m !== modeRef.current && core.s.breath) core.closeBreath();
    setModeRaw(m);
  };

  /** Ignore taps right after a swipe, so a swipe across the moon doesn't toggle play. */
  const guard = (fn: () => void) => () => {
    if (Date.now() - swipedAt.current < 350) return;
    fn();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input')) return;
      if (e.key === 'ArrowRight') setMode(modeRef.current + 1);
      else if (e.key === 'ArrowLeft') setMode(modeRef.current - 1);
      else if (e.key === 'ArrowUp') setSheet(true);
      else if (e.key === 'ArrowDown' || e.key === 'Escape') setSheet(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onDown = (e: PointerEvent) => {
    core.touch();
    if (sheet || core.s.dim) return;
    if ((e.target as HTMLElement).closest?.('input,label')) return;
    g.current = { x: e.clientX, y: e.clientY, axis: null };
  };
  const onMove = (e: PointerEvent) => {
    const s = g.current;
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!s.axis) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (s.axis === 'x') {
      const edge = (mode === 0 && dx > 0) || (mode === MODES.length - 1 && dx < 0);
      setDrag(d => ({ ...d, on: true, x: edge ? dx * 0.3 : dx }));
    } else if (dy < 0) setDrag(d => ({ ...d, on: true, y: Math.max(dy, -220) }));
  };
  const onUp = (e: PointerEvent) => {
    const s = g.current;
    g.current = null;
    if (!s || !s.axis) return;
    swipedAt.current = Date.now();
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (s.axis === 'x') {
      let m = mode;
      if (dx < -60) m += 1;
      else if (dx > 60) m -= 1;
      setMode(m);
    } else if (dy < -60) setSheet(true);
    setDrag({ x: 0, y: 0, sheet: 0, on: false });
  };

  const onSheetDown = (e: PointerEvent) => {
    e.stopPropagation();
    sg.current = { y: e.clientY };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* old browsers */ }
  };
  const onSheetMove = (e: PointerEvent) => {
    if (!sg.current) return;
    setDrag(d => ({ ...d, on: true, sheet: Math.max(0, e.clientY - sg.current!.y) }));
  };
  const onSheetUp = (e: PointerEvent) => {
    if (!sg.current) return;
    const dy = e.clientY - sg.current.y;
    sg.current = null;
    setDrag({ x: 0, y: 0, sheet: 0, on: false });
    setSheet(dy <= 90);
  };

  const v = viewModel(core, me.name);
  const openSheet = guard(() => setSheet(true));
  const closeSheet = () => setSheet(false);
  const togglePlay = guard(() => core.togglePlay());

  const trackX = `calc(${-mode * 50}% + ${drag.x}px)`;
  const sheetY = sheet ? `${drag.sheet}px` : `calc(100% + ${drag.y}px)`;
  const backdropOpacity = sheet ? 1 - Math.min(1, drag.sheet / 400) : Math.min(1, -drag.y / 220);

  return (
    <div class="shell" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <div class="topbar">
        <span class="brand">Lull</span>
        <div class="tabs">
          {MODES.map((label, i) => (
            <button key={label} class={`tab${i === mode ? ' on' : ''}`} onClick={() => setMode(i)}>
              <span>{label}</span>
              <span />
            </button>
          ))}
        </div>
        <span class="clock">{v.clock}</span>
      </div>

      <div class="track" style={{ transform: `translateX(${trackX})`, transition: drag.on ? 'none' : EASE }}>
        <Sleep v={v} togglePlay={togglePlay} goDim={() => core.goDim()} openSheet={openSheet} active={mode === 0} />
        <Relax
          v={v}
          active={mode === 1}
          toggleBreath={guard(() => (core.s.breath ? core.closeBreath() : core.startBreath()))}
          pickPattern={id => core.setRelax({ p: id })}
          openSheet={openSheet}
        />
      </div>

      <div
        class="backdrop"
        onClick={closeSheet}
        style={{ opacity: backdropOpacity, pointerEvents: sheet ? 'auto' : 'none', transition: drag.on ? 'none' : 'opacity .4s' }}
      />

      <div
        class="sheet"
        aria-hidden={!sheet}
        // The shadow would show as a dark band along the bottom edge while the sheet is tucked away.
        style={{ transform: `translateY(${sheetY})`, transition: drag.on ? 'none' : EASE, boxShadow: sheet || drag.y ? undefined : 'none' }}
      >
        <div class="sheet-head" onPointerDown={onSheetDown} onPointerMove={onSheetMove} onPointerUp={onSheetUp} onPointerCancel={onSheetUp}>
          <span class="grabber" />
          <div class="sheet-title-row">
            <span class="sheet-title">{mode === 0 ? 'Sounds & timer' : 'Session'}</span>
            <button class="done" onPointerDown={e => e.stopPropagation()} onClick={closeSheet}>Done</button>
          </div>
        </div>
        <div class="sheet-body">
          {mode === 0 ? (
            <SleepSheet v={v} core={core} me={me} onSignOut={onSignOut} onAdmin={onAdmin} />
          ) : (
            <RelaxSheet v={v} core={core} />
          )}
        </div>
      </div>

      {v.dim && (
        <div class="dim" onClick={() => core.wake()}>
          <span class="dim-big">{v.dimBig}</span>
          <span class="dim-small">{v.dimSmall}</span>
        </div>
      )}
    </div>
  );
}

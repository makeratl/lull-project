import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

const KEY = 'lull.folds';
const read = (): Record<string, boolean> => {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
};

/** A section that opens and closes, remembered on this device. */
export function Fold(props: { id: string; title: ComponentChildren; summary?: string; open?: boolean; action?: ComponentChildren; children: ComponentChildren }) {
  const [open, setOpen] = useState(() => read()[props.id] ?? props.open ?? false);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(KEY, JSON.stringify({ ...read(), [props.id]: next })); } catch { /* private mode */ }
  };
  return (
    <div class={`fold${open ? ' open' : ''}`}>
      <div class="fold-head">
        <button class="fold-btn" aria-expanded={open} onClick={toggle}>
          <span class="fold-chev" aria-hidden="true" />
          <span class="fold-title">{props.title}</span>
          {props.summary && <span class="fold-summary">{props.summary}</span>}
        </button>
        {props.action}
      </div>
      <div class="fold-body">
        <div class="fold-inner" inert={!open}>{props.children}</div>
      </div>
    </div>
  );
}

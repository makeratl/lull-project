import type { PatternId } from '../core/constants';
import type { ViewModel } from '../core/viewModel';
import { SheetHint } from './Sleep';

export function Relax(props: { v: ViewModel; active: boolean; toggleBreath: () => void; pickPattern: (id: PatternId) => void; openSheet: () => void; openPractice: () => void }) {
  const { v } = props;
  return (
    <section class="screen relax" aria-label="Relax" inert={!props.active}>
      <div class="relax-head">
        <span class="relax-name">{v.relaxName}</span>
        <span class="relax-sub">{v.relaxSub}</span>
      </div>
      <div class="bmoon-wrap">
        <div class="bmoon-ring" />
        <button
          class="bmoon"
          onClick={props.toggleBreath}
          aria-label={v.breathRunning ? 'Stop breathing' : 'Start breathing'}
          style={{ transform: `scale(${v.breathScale})`, transition: `transform ${v.breathDur}s ease-in-out` }}
        />
      </div>
      <div class="phase" aria-live="polite">
        <span class="phase-label">{v.relaxLabel}</span>
        <span class="phase-count">{v.relaxCount}</span>
        <span class="phase-meta">{v.relaxMeta}</span>
      </div>
      <div class="pattern-pills">
        {v.relaxPatterns.map(p => (
          <button key={p.id} class={`ppill${p.on ? ' on' : ''}`} onClick={() => props.pickPattern(p.id)}>{p.name}</button>
        ))}
      </div>
      <button class={`streak${v.practice.current ? ' on' : ''}`} onClick={props.openPractice}>
        <span class="streak-moon" aria-hidden="true" />
        {v.practice.line}
      </button>
      <SheetHint label="Session & sound" onClick={props.openSheet} />
    </section>
  );
}

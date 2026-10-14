import type { JourneyId, Output } from '../core/journeys';
import type { ViewModel } from '../core/viewModel';
import { SheetHint } from './Sleep';

export function Journey(props: {
  v: ViewModel;
  active: boolean;
  toggle: () => void;
  pick: (id: JourneyId) => void;
  setOutput: (o: Output) => void;
  openSheet: () => void;
}) {
  const { v } = props;
  return (
    <section class="screen journey" aria-label="Journey" inert={!props.active}>
      <div class="relax-head">
        <span class="relax-name">{v.journeyName}</span>
        <span class="relax-sub">{v.journeySub}</span>
      </div>
      <div class={`jmoon-wrap${v.journeyRunning ? ' on' : ''}`}>
        <svg class="jring" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="48.5" pathLength={1} />
          {v.journeyRunning && <circle class="jring-done" cx="50" cy="50" r="48.5" pathLength={1} style={{ strokeDashoffset: 1 - v.journeyProgress }} />}
        </svg>
        <button class="bmoon jmoon" onClick={props.toggle} aria-label={v.journeyRunning ? 'End the journey' : 'Begin the journey'} />
      </div>
      <div class="phase" aria-live="polite">
        <span class="phase-label">{v.journeyLabel}</span>
        <span class="phase-count">{v.journeyCount}</span>
        <span class="phase-meta">{v.journeyMeta}</span>
      </div>
      <div class="pattern-pills jpills">
        {v.journeys.map(j => (
          <button key={j.id} class={`ppill${j.on ? ' on' : ''}`} onClick={() => props.pick(j.id)}>{j.name}</button>
        ))}
      </div>
      <div class="seg" role="group" aria-label="Listening on">
        {v.outputs.map(o => (
          <button key={o.value} class={o.on ? 'on' : ''} aria-pressed={o.on} onClick={() => props.setOutput(o.value)}>{o.label}</button>
        ))}
      </div>
      <SheetHint label="Journeys & sound" onClick={props.openSheet} />
    </section>
  );
}

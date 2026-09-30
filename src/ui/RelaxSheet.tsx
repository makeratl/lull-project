import type { Lull } from '../core/lull';
import type { ViewModel } from '../core/viewModel';

export function RelaxSheet({ v, core, openPractice }: { v: ViewModel; core: Lull; openPractice: () => void }) {
  return (
    <>
      <button class="practice-row" onClick={openPractice}>
        <span class="mix-text">
          <span class="mix-name">Your practice</span>
          <span class="note">{v.practice.has ? `${v.practice.line} · longest ${v.practice.longest}` : 'Streaks and a calendar of your breathing'}</span>
        </span>
        <span class="menu-chev" aria-hidden="true" />
      </button>
      <div class="section">
        <span class="label">Pattern</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {v.relaxPatterns.map(p => (
            <button key={p.id} class={`pattern-card${p.on ? ' on' : ''}`} onClick={() => core.setRelax({ p: p.id })}>
              <span>{p.name}</span>
              <span>{p.sub}</span>
            </button>
          ))}
        </div>
      </div>
      <div class="section">
        <span class="label">Daily goal</span>
        <div class="chips">
          {v.practice.goals.map(g => (
            <button key={g.value} class={`chip${g.on ? ' on' : ''}`} onClick={() => core.setGoal(g.value)}>{g.label}</button>
          ))}
        </div>
        <span class="note">The moon on your calendar fills as you reach it. Five minutes a day is a well-studied amount; fifteen fits a morning, afternoon and evening five.</span>
      </div>
      <div class="section">
        <span class="label">Session length</span>
        <div class="chips">
          {v.relaxLengths.map(l => (
            <button key={l.value} class={`chip${l.on ? ' on' : ''}`} onClick={() => core.setRelax({ min: l.value })}>{l.label}</button>
          ))}
        </div>
      </div>
      <div class="section">
        <span class="label">Sound while breathing</span>
        <div class="sound-card">
          <span class="mix-text">
            <span class="sound-card-name">{v.mixLabel}</span>
            <span class="note">Change it on the Sleep screen</span>
          </span>
          <button class="pill-solid" onClick={() => core.togglePlay()}>{v.playing ? 'Pause' : 'Play'}</button>
        </div>
      </div>
    </>
  );
}

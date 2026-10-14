import type { Lull } from '../core/lull';
import type { ViewModel } from '../core/viewModel';

export function JourneySheet({ v, core }: { v: ViewModel; core: Lull }) {
  return (
    <>
      <div class="section">
        <span class="label">Journey</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {v.journeys.map(j => (
            <button key={j.id} class={`pattern-card jcard${j.on ? ' on' : ''}`} onClick={() => core.pickJourney(j.id)}>
              <span>{j.name}</span>
              <span>{j.minutes} min · {j.sub}</span>
            </button>
          ))}
        </div>
        <span class="note">Each journey plays once, from start to end. Most come back up and close with the gong; Dream doesn’t, it fades into whatever sound is playing.</span>
      </div>
      <div class="section">
        <span class="label">Listening on</span>
        <div class="chips">
          {v.outputs.map(o => (
            <button key={o.value} class={`chip${o.on ? ' on' : ''}`} onClick={() => core.setJourneyOutput(o.value)}>{o.label}</button>
          ))}
        </div>
        <span class="note">
          {v.output === 'headphones'
            ? 'Each ear hears its own tone, and the slow beat forms between them. Only works on headphones.'
            : 'Both tones in both ears, so the beat is in the air. Works on any speaker, or headphones.'}
        </span>
      </div>
      <div class="section">
        <span class="label">Sound underneath</span>
        <div class="sound-card">
          <span class="mix-text">
            <span class="sound-card-name">{v.mixLabel}</span>
            <span class="note">Change it on the Sleep screen</span>
          </span>
          <button class="pill-solid" onClick={() => core.togglePlay()}>{v.playing ? 'Pause' : 'Play'}</button>
        </div>
      </div>
      <span class="note">Journeys are tuned toward a state of mind; they can’t switch one on. Keep them quiet, under your other sounds, and never listen while driving.</span>
    </>
  );
}

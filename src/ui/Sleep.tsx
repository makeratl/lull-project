import type { ViewModel } from '../core/viewModel';

export function SheetHint({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button class="hint" onClick={onClick}>
      <span class="chev" />
      <span class="txt">{label}</span>
    </button>
  );
}

export function Sleep({ v, togglePlay, goDim, openSheet, active }: { v: ViewModel; togglePlay: () => void; goDim: () => void; openSheet: () => void; active: boolean }) {
  return (
    <section class="screen sleep" aria-label="Sleep" inert={!active}>
      <h1 class="greeting">{v.greeting}</h1>
      <div class="moon-wrap">
        <div
          class={`halo${v.playing ? ' on' : ''}`}
          style={{ animation: v.playing ? `lullBreath ${v.haloPeriod}s ease-in-out infinite` : 'none' }}
        />
        <button class="moon" onClick={togglePlay} aria-label={v.playing ? 'Pause' : 'Play'}>
          {v.playing ? (
            <span class="pause"><span /><span /></span>
          ) : (
            <span class="play" />
          )}
        </button>
      </div>
      <div class="nowplaying">
        <span class="mix-label">{v.mixLabel}</span>
        <span class="status">{v.status}</span>
        <div class="dim-slot">
          {v.playing && <button class="pill-outline" onClick={goDim}>Dim screen</button>}
        </div>
      </div>
      <SheetHint label="Sounds & timer" onClick={openSheet} />
    </section>
  );
}

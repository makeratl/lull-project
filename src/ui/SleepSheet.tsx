import type { Lull } from '../core/lull';
import type { ViewModel } from '../core/viewModel';
import { Fold } from './Fold';

const num = (e: Event) => Number((e.target as HTMLInputElement).value);
const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

type Sound = ViewModel['sounds'][number];

/**
 * The Sleep sheet, a mixer over a library:
 * timer (folded) · Tonight (only what's on, with levels) · Mixes · the library by group · playback (folded).
 * The account lives in its own menu, opened from the wordmark.
 */
export function SleepSheet({ v, core }: { v: ViewModel; core: Lull }) {
  return (
    <>
      <Fold id="timer" title="Sleep timer" summary={v.timerSummary}>
        <div class="chips">
          {v.timers.map(t => (
            <button key={t.value} class={`chip${t.on ? ' on' : ''}`} onClick={() => core.setTimer(t.value)}>{t.label}</button>
          ))}
        </div>
        <div class="fade-row">
          <span>Fade out over</span>
          {v.fades.map(f => (
            <button key={f.value} class={`chip small${f.on ? ' on' : ''}`} onClick={() => core.setFade(f.value)}>{f.label}</button>
          ))}
        </div>
      </Fold>

      <div class="section">
        <span class="label">Tonight</span>
        {v.tonight.length ? (
          <div class="mixer">
            {v.tonight.map(s => (
              <div key={s.id} class="mixer-row">
                <div class="mixer-top">
                  <span class="mixer-art" style={{ backgroundImage: `url(${s.art})` }} />
                  <span class="mixer-name">{s.name}</span>
                  <span class="mixer-pct">{s.pct}</span>
                  <button class="x" aria-label={`Turn off ${s.name}`} onClick={() => core.toggleSound(s.id)}>×</button>
                </div>
                <input type="range" min={0} max={100} value={s.pct} onInput={e => core.setLevel(s.id, num(e) / 100)} aria-label={`${s.name} volume`} />
                {s.id === 'ocean' && (
                  <div class="mixer-sub">
                    <div class="row-between">
                      <span class="note">Wave rhythm</span>
                      <span class="note">{v.waveLabel}</span>
                    </div>
                    <input type="range" min={5} max={20} step={1} value={v.waveSlider} onInput={e => core.setWave(25 - num(e))} aria-label="Wave rhythm" />
                    <div class="range-ends"><span>Slow swells</span><span>Shoreline</span></div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <span class="note">Nothing on yet. Pick a sound below.</span>
        )}
      </div>

      <div class="section tight">
        <div class="row-between">
          <span class="label">Mixes</span>
          <button class="link" onClick={() => core.saveMix()}>Save this mix</button>
        </div>
        <div class="mix-strip">
          {v.mixes.map(m => (
            <div key={m.index} class={`mix-chip${m.on ? ' on' : ''}`}>
              <button class="mix-chip-btn" onClick={() => core.applyMix(m.mix)} aria-pressed={m.on}>
                <span class="mix-name">{m.name}</span>
                <span class="note">{m.summary}</span>
              </button>
              <button class="x" aria-label={`Remove ${m.name}`} onClick={() => core.deleteMix(m.index)}>×</button>
            </div>
          ))}
        </div>
      </div>

      <div class="section library">
        <span class="label">Sounds</span>
        {v.library.map(g => (
          <Fold
            key={g.id}
            id={`lib-${g.id}`}
            open={g.id === 'water'}
            title={g.name}
            summary={g.summary}
            action={g.id === 'yours' && <AddYourOwn core={core} />}
          >
            {g.id === 'yours' && v.fileError && <span class="error" role="alert">{v.fileError}</span>}
            {g.sounds.length ? (
              <div class="art-grid">
                {g.sounds.map(s => <ArtTile key={s.id} s={s} core={core} />)}
              </div>
            ) : (
              <span class="note">Add a recording of your own: a fan at home, a favourite rain track.</span>
            )}
          </Fold>
        ))}
      </div>

      <Fold id="settings" title="Playback">
        <button class="toggle-row" role="switch" aria-checked={v.safeMode} onClick={() => core.setSafeMode(!v.safeMode)}>
          <span class="mix-text">
            <span class="mix-name">Lock-screen safe mode</span>
            <span class="note">Plays a prepared loop, the most reliable way to keep going with the screen locked. Changes take a moment to apply.</span>
          </span>
          <span class={`toggle${v.safeMode ? ' on' : ''}`} />
        </button>
        {isAndroid && (
          <span class="note">
            If sound stops overnight, set Chrome’s battery usage to “Unrestricted” in Android settings.
          </span>
        )}
      </Fold>
    </>
  );
}

/** A sound in the library: its painting, name and note. Tap to turn it on or off. */
function ArtTile({ s, core }: { s: Sound; core: Lull }) {
  return (
    <div class={`art-tile${s.on ? ' on' : ''}`} style={{ backgroundImage: `url(${s.art})` }}>
      <button class="art-btn" onClick={() => core.toggleSound(s.id)} aria-pressed={s.on}>
        <span class="art-name-row">
          <span class="dot" />
          <span class="art-name">{s.name}</span>
        </span>
        <span class="art-note">{s.note}</span>
      </button>
      {s.custom && <button class="x art-x" aria-label={`Remove ${s.name}`} onClick={() => core.removeFile(s.id)}>×</button>}
    </div>
  );
}

function AddYourOwn({ core }: { core: Lull }) {
  return (
    <label class="link">
      + Add
      <input
        type="file"
        accept="audio/*"
        style={{ display: 'none' }}
        onChange={e => {
          const input = e.target as HTMLInputElement, f = input.files?.[0];
          input.value = '';
          core.addFile(f);
        }}
      />
    </label>
  );
}

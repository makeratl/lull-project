import type { Lull } from '../core/lull';
import type { ViewModel } from '../core/viewModel';
import type { Me } from '../auth/session';
import { ChangePassword } from '../auth/ChangePassword';

const num = (e: Event) => Number((e.target as HTMLInputElement).value);
const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

export function SleepSheet({ v, core, me, onSignOut, onAdmin }: { v: ViewModel; core: Lull; me: Me; onSignOut: () => void; onAdmin: () => void }) {
  return (
    <>
      <div class="section">
        <span class="label">Sleep timer</span>
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
      </div>

      {v.oceanOn && (
        <div class="card">
          <div class="row-between" style={{ alignItems: 'baseline', gap: '12px' }}>
            <span class="card-title">Wave rhythm</span>
            <span class="card-note">{v.waveLabel}</span>
          </div>
          <input type="range" min={5} max={20} step={1} value={v.waveSlider} onInput={e => core.setWave(25 - num(e))} aria-label="Wave rhythm" />
          <div class="range-ends"><span>Slow swells</span><span>Shoreline</span></div>
        </div>
      )}

      <div class="section">
        <div class="row-between">
          <span class="label">Sounds</span>
          <label class="link">
            + Add your own
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
        </div>
        {v.fileError && <span class="error" role="alert">{v.fileError}</span>}
        <div class="grid">
          {v.sounds.map(s => (
            <div key={s.id} class={`tile${s.on ? ' on' : ''}`}>
              <div class="tile-top">
                <button class="tile-btn" onClick={() => core.toggleSound(s.id)} aria-pressed={s.on}>
                  <span class="tile-name-row">
                    <span class="dot" />
                    <span class="tile-name">{s.name}</span>
                  </span>
                  <span class="note">{s.note}</span>
                </button>
                {s.custom && <button class="x" aria-label={`Remove ${s.name}`} onClick={() => core.removeFile(s.id)}>×</button>}
              </div>
              <input type="range" min={0} max={100} value={s.pct} onInput={e => core.setLevel(s.id, num(e) / 100)} aria-label={`${s.name} volume`} />
            </div>
          ))}
        </div>
      </div>

      <div class="section tight">
        <div class="row-between">
          <span class="label">Mixes</span>
          <button class="link" onClick={() => core.saveMix()}>Save this mix</button>
        </div>
        <div class="mix-list">
          {v.mixes.map(m => (
            <div key={m.index} class="mix-row">
              <button class={`mix-btn${m.on ? ' on' : ''}`} onClick={() => core.applyMix(m.mix)}>
                <span class="dot" />
                <span class="mix-text">
                  <span class="mix-name">{m.name}</span>
                  <span class="note">{m.summary}</span>
                </span>
              </button>
              <button class="x big" aria-label={`Remove ${m.name}`} onClick={() => core.deleteMix(m.index)}>×</button>
            </div>
          ))}
        </div>
      </div>

      <div class="section">
        <span class="label">Playback</span>
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
      </div>

      <div class="section">
        <span class="label">Account</span>
        <div class="row-between" style={{ gap: '12px' }}>
          <span class="mix-text">
            <span class="mix-name">{me.name}</span>
            <span class="note">{me.email}</span>
          </span>
          <button class="btn-quiet" onClick={onSignOut}>Sign out</button>
        </div>
        <ChangePassword email={me.email} />
        {me.role === 'admin' && <button class="link" onClick={onAdmin}>Invite &amp; admin</button>}
      </div>
    </>
  );
}

/**
 * The gong that opens and closes a breathing session.
 *
 * Its own small AudioContext, so it rings over whatever is playing (the live engine or safe mode's
 * <audio> element) and doesn't depend on either. `prime()` must be called inside a tap: that unlocks
 * the context, so the closing gong can ring later without one.
 */
export interface Chime {
  prime(): void;
  ring(): void;
}

export class Gong implements Chime {
  ctx?: AudioContext;
  buf?: AudioBuffer;
  private loading?: Promise<void>;

  constructor(private url = '/sounds/gong.mp3', private level = 0.8) {}

  /** Never throws: a missing gong must not stop a session from starting. */
  prime() {
    try { this.unlock(); } catch { /* no Web Audio: sessions run silently */ }
  }

  private unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      try {
        // Ring through the silent switch on iPhone, like the sleep sounds.
        const nav = navigator as Navigator & { audioSession?: { type: string } };
        if (nav.audioSession) nav.audioSession.type = 'playback';
      } catch { /* not supported */ }
    }
    this.ctx.resume();
    this.loading ||= fetch(this.url)
      .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
      .then(d => this.ctx!.decodeAudioData(d))
      .then(b => { this.buf = b; })
      .catch(() => { this.loading = undefined; });
  }

  /** Ring once. If the sound is still loading (first use), ring as soon as it's ready. */
  ring() {
    const ctx = this.ctx;
    if (!ctx) return;
    const go = () => {
      if (!this.buf) return;
      try { this.strike(ctx, this.buf); } catch { /* context closed or unavailable */ }
    };
    if (this.buf) go();
    else this.loading?.then(go);
  }

  private strike(ctx: AudioContext, buf: AudioBuffer) {
    ctx.resume();
    const s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = buf;
    g.gain.value = this.level;
    s.connect(g);
    g.connect(ctx.destination);
    s.onended = () => g.disconnect();
    s.start();
  }
}

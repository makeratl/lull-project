/** 42:10, or 1:02:03 past an hour. Rounds up so the display never shows 0:00 early. */
export const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(x)}` : `${m}:${p(x)}`;
};

/** The fade can never be longer than half the timer. */
export const fadeSeconds = (timerMin: number, fadeMin: number) => (timerMin ? Math.min(fadeMin * 60, timerMin * 30) : 0);

export const statusLine = (o: { playing: boolean; timer: number; fade: number; remainingMs: number | null }) => {
  if (!o.playing) return o.timer ? `${o.timer} min, then silence` : 'Plays all night';
  if (o.remainingMs == null) return 'Playing all night';
  if (o.remainingMs <= fadeSeconds(o.timer, o.fade) * 1000) return `Fading out · ${fmt(o.remainingMs)}`;
  return `Fades out in ${fmt(o.remainingMs)}`;
};

export const rounds = (n: number) => `${n} ${n === 1 ? 'round' : 'rounds'}`;

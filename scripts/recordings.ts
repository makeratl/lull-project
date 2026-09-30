/**
 * Builds Lull's recorded sounds in public/sounds/ from the Freesound picks in scripts/sounds.json.
 *   npm run sounds:fetch   (once, then listen and choose)
 *   npm run sounds:build
 * Sources are read from $LULL_SOURCES (default ~/Music/lull-sources)/<set>/<id>-*.mp3.
 *
 * - shore.mp3, brook.mp3: a stretch of each recording, its tail crossfaded into its head (the app's own
 *   crossfadeLoop) so it loops without a seam, at -20 LUFS, 96 kbps stereo.
 * - ocean/wave-N.mp3: single breaking waves cut trough to trough from the surf recording. One gain for all
 *   of them, so their sizes stay natural.
 * - gong.mp3: one strike for the start and end of a breathing session, from its onset, faded out as it
 *   rings down, at -22 LUFS.
 * - CREDITS.md from the sources' metadata.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crossfadeLoop } from '../src/core/recipes';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'public', 'sounds');
const SRC = process.env.LULL_SOURCES || join(homedir(), 'Music', 'lull-sources');
const SR = 44100;
const picks = JSON.parse(readFileSync(join(here, 'sounds.json'), 'utf8')) as {
  shore: { set: string; id: number; from: number; seconds: number };
  waves: { set: string; id: number; count: number };
  brook: { set: string; id: number; from: number; seconds: number };
  gong: { set: string; id: number; seconds: number };
};

const source = (set: string, id: number) => {
  const f = readdirSync(join(SRC, set)).find(n => n.startsWith(`${id}-`) && n.endsWith('.mp3'));
  if (!f) throw new Error(`No ${set}/${id}-*.mp3 in ${SRC}; run npm run sounds:fetch`);
  return join(SRC, set, f);
};

/** Decode to stereo float channels at SR. */
const decode = (file: string, from = 0, seconds?: number): Float32Array[] => {
  const args = ['-nostdin', '-v', 'error', '-ss', String(from), ...(seconds ? ['-t', String(seconds)] : []), '-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-'];
  const raw = execFileSync('ffmpeg', args, { maxBuffer: 1 << 30 });
  const all = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4), n = all.length / 2;
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = all[2 * i]; R[i] = all[2 * i + 1]; }
  return [L, R];
};

/** Encode stereo channels to MP3, with a gain and optional edge fades (seconds). */
const encode = (chs: Float32Array[], file: string, gainDb: number, kbps: number, fadeIn = 0, fadeOut = 0) => {
  const n = chs[0].length;
  const af = [`volume=${gainDb.toFixed(2)}dB`];
  if (fadeIn) af.push(`afade=t=in:d=${fadeIn}`);
  if (fadeOut) af.push(`afade=t=out:st=${(n / SR - fadeOut).toFixed(3)}:d=${fadeOut}`);
  execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-i', '-', '-af', af.join(','), '-c:a', 'libmp3lame', '-b:a', `${kbps}k`, file], {
    input: interleave(chs),
  });
};

const interleave = (chs: Float32Array[]) => {
  const n = chs[0].length, inter = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { inter[2 * i] = chs[0][i]; inter[2 * i + 1] = chs[1][i]; }
  return Buffer.from(inter.buffer);
};

/** Integrated loudness (LUFS) of stereo channels, from ffmpeg's ebur128 summary (printed on stderr). */
const loudness = (chs: Float32Array[]) => {
  const r = spawnSync('ffmpeg', ['-nostdin', '-hide_banner', '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-i', '-', '-af', 'ebur128', '-f', 'null', '-'], {
    input: interleave(chs),
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
  const m = /Summary:[\s\S]*?I:\s+(-?[\d.]+) LUFS/.exec(r.stderr);
  if (!m) throw new Error('loudness measurement failed');
  return Number(m[1]);
};

/** A seamless loop: the last `fade` seconds are crossfaded into the head. */
const seamless = (chs: Float32Array[], fade = 2) => {
  const f = Math.round(fade * SR), len = chs[0].length - f;
  return chs.map(c => crossfadeLoop(c, len, f));
};

const TARGET = -20;

// ── loops ──
mkdirSync(OUT, { recursive: true });
for (const name of ['shore', 'brook'] as const) {
  const p = picks[name];
  const loop = seamless(decode(source(p.set, p.id), p.from, p.seconds + 2));
  const gain = TARGET - loudness(loop);
  encode(loop, join(OUT, `${name}.mp3`), gain, 96);
  console.log(`${name}.mp3  ${(loop[0].length / SR).toFixed(1)} s  gain ${gain.toFixed(1)} dB`);
}

// ── waves ──
{
  const p = picks.waves, chs = decode(source(p.set, p.id));
  const n = chs[0].length, hop = Math.round(0.05 * SR), frames = Math.floor(n / hop);
  // RMS envelope in 50 ms frames (dB), smoothed over 0.5 s.
  const env = new Float32Array(frames);
  for (let k = 0; k < frames; k++) {
    let s = 0;
    for (let i = k * hop; i < (k + 1) * hop; i++) s += (chs[0][i] ** 2 + chs[1][i] ** 2) / 2;
    env[k] = 10 * Math.log10(s / hop + 1e-12);
  }
  const sm = env.map((_, k) => {
    let s = 0, c = 0;
    for (let j = Math.max(0, k - 5); j <= Math.min(frames - 1, k + 5); j++) { s += env[j]; c++; }
    return s / c;
  });
  const sec = (k: number) => (k * hop) / SR;
  const argmin = (a: number, b: number) => {
    let m = a;
    for (let k = a; k < b; k++) if (sm[k] < sm[m]) m = k;
    return m;
  };
  // Crests: the loudest point within ±2.5 s, standing at least 6 dB above the troughs either side.
  const crests: { k: number; a: number; b: number; prom: number }[] = [];
  for (let k = 50; k < frames - 50; k++) {
    const w0 = Math.max(0, k - 50), w1 = Math.min(frames, k + 50);
    let isMax = true;
    for (let j = w0; j < w1; j++) if (sm[j] > sm[k]) { isMax = false; break; }
    if (!isMax) continue;
    // Trough before (within 6 s) and after (within 9 s): the wave's natural start and end.
    const a = argmin(Math.max(0, k - 120), k), b = argmin(k + 1, Math.min(frames, k + 180));
    const prom = sm[k] - Math.max(sm[a], sm[b]);
    const len = sec(b - a);
    if (prom >= 6 && len >= 4 && len <= 13) crests.push({ k, a, b, prom });
  }
  // Keep the most distinct, without overlapping cuts.
  const chosen: typeof crests = [];
  for (const c of [...crests].sort((x, y) => y.prom - x.prom)) {
    if (chosen.length >= p.count) break;
    if (chosen.every(o => c.b <= o.a || c.a >= o.b)) chosen.push(c);
  }
  chosen.sort((x, y) => x.k - y.k);
  const cuts = chosen.map(c => chs.map(ch => ch.slice(c.a * hop, c.b * hop)));
  // One gain for all waves: the loudest lands at -16 LUFS, the rest keep their size relative to it.
  const gain = -16 - Math.max(...cuts.map(loudness));
  const dir = join(OUT, 'ocean');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cuts.forEach((c, i) => {
    encode(c, join(dir, `wave-${i + 1}.mp3`), gain, 96, 0.4, 1.2);
    const x = chosen[i];
    console.log(`ocean/wave-${i + 1}.mp3  at ${sec(x.k).toFixed(1)} s  ${sec(x.b - x.a).toFixed(1)} s long  stands ${x.prom.toFixed(1)} dB clear`);
  });
  if (chosen.length < p.count) console.warn(`only ${chosen.length} clean waves found (wanted ${p.count})`);
}

// ── gong ──
{
  const p = picks.gong, chs = decode(source(p.set, p.id));
  // Start just before the strike: the first sample within 40 dB of the peak, less 20 ms.
  let peak = 0;
  for (const c of chs) for (const x of c) peak = Math.max(peak, Math.abs(x));
  let a = 0;
  while (a < chs[0].length && Math.abs(chs[0][a]) < peak / 100 && Math.abs(chs[1][a]) < peak / 100) a++;
  a = Math.max(0, a - Math.round(0.02 * SR));
  const cut = chs.map(c => c.slice(a, a + p.seconds * SR));
  const gain = -22 - loudness(cut);
  encode(cut, join(OUT, 'gong.mp3'), gain, 96, 0, 4);
  console.log(`gong.mp3  ${(cut[0].length / SR).toFixed(1)} s  from ${(a / SR).toFixed(2)} s  gain ${gain.toFixed(1)} dB`);
}

// ── credits ──
const meta = (set: string) => JSON.parse(readFileSync(join(SRC, set, 'sources.json'), 'utf8')) as { id: number; title: string; author: string; url: string; license: string }[];
const used = [...new Map([picks.shore, picks.waves, picks.brook, picks.gong].map(p => [p.id, meta(p.set).find(m => m.id === p.id)!])).values()];
writeFileSync(
  join(OUT, 'CREDITS.md'),
  `# Sound credits\n\nRecordings from [Freesound](https://freesound.org), all CC0 (public domain). Thank you.\n\n` +
    used.map(m => `- **${m.title}** by ${m.author}: ${m.url}`).join('\n') +
    `\n\nHaunt's voices were made with Chatterbox and its screams with ACE-Step.\n`,
);
console.log('CREDITS.md');

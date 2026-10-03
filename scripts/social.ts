/**
 * Social banners for sharing Lull (posts, channel headers, link previews).   npx tsx scripts/social.ts
 *
 *   design/social/lull-banner-1600x900.png   16:9: post headers (Patreon, Discord, YouTube community)
 *   design/social/lull-banner-1200x630.png   link-preview size
 *   design/social/lull-banner-1500x500.png   wide channel header (X/Twitter, Bluesky)
 *   design/social/lull-square-1080.png       square: Instagram, Mastodon
 *   public/og.jpg                            the site's link preview (the 1200×630, as a smaller JPEG)
 *
 * The background is a ComfyUI painting (Qwen Lightning 8-step, 16:9: a full moon over a calm sea, moonlit path,
 * sandy shore; seed in git history of design/social/nocturne.jpg), graded toward the app's slate palette with ffmpeg
 * (eq=saturation=0.5:brightness=-0.035:gamma=0.92, colorbalance bs/bm=-0.03). Text is drawn as paths and laid
 * over a soft scrim, so no system fonts are needed.
 */
import sharp from 'sharp';
import opentype from 'opentype.js';
import { mkdirSync, readFileSync } from 'node:fs';

const FONTS = 'node_modules/@fontsource/cormorant-garamond/files';
const font = (file: string) => {
  const b = readFileSync(`${FONTS}/${file}`);
  return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const italic = font('cormorant-garamond-latin-500-italic.woff');
const roman = font('cormorant-garamond-latin-400-normal.woff');

// Text as paths: the same approach as scripts/brand.ts.
const n = (v: number) => (Math.round(v * 100) / 100).toString();
const pathData = (p: opentype.Path) =>
  p.commands
    .map(c =>
      c.type === 'M' || c.type === 'L' ? `${c.type}${n(c.x)} ${n(c.y)}`
      : c.type === 'Q' ? `Q${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)}`
      : c.type === 'C' ? `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}`
      : 'Z',
    )
    .join('');
const text = (f: opentype.Font, s: string, x: number, y: number, size: number, fill: string, align: 'left' | 'middle' = 'left', spacing = 0) => {
  const scale = size / f.unitsPerEm;
  const glyphs = [...s].map(ch => f.charToGlyph(ch));
  const advances = glyphs.map((g, i) => {
    const k = i < glyphs.length - 1 ? f.getKerningValue(g, glyphs[i + 1]) : 0;
    return ((g.advanceWidth ?? 0) + (Number.isFinite(k) ? k : 0)) * scale + (i < glyphs.length - 1 ? spacing * size : 0);
  });
  const width = advances.reduce((a, b) => a + b, 0);
  let cx = align === 'middle' ? x - width / 2 : x;
  const d = glyphs.map((g, i) => { const part = pathData(g.getPath(cx, y, size)); cx += advances[i]; return part; }).join('');
  return `<path d="${d}" fill="${fill}"/>`;
};

const TAG = ['Sleep sounds and guided breathing,', 'quietly, on your phone.'];
const FOOT = 'lull.makeratl.com  ·  by MakerATL';
const BG = 'design/social/nocturne.jpg';

/** Faint film grain over everything, so type and painting sit together. */
const grain = (W: number, H: number) => `
  <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 .8  0 0 0 0 .85  0 0 0 0 .92  0 0 0 .045 0"/></filter>
  <rect width="${W}" height="${H}" filter="url(#grain)"/>`;

/** Darkens toward one side (x from left, or y from bottom), so the words read over the painting. */
const scrim = (W: number, H: number, dir: 'left' | 'bottom', reach: number, strength = 0.78) => {
  const [x2, y1, y2] = dir === 'left' ? ['1', '0', '0'] : ['0', '1', '0'];
  return `
  <linearGradient id="scrim" x1="0" y1="${y1}" x2="${x2}" y2="${y2}">
    <stop offset="0" stop-color="#0b0d12" stop-opacity="${strength}"/>
    <stop offset="${reach * 0.55}" stop-color="#0b0d12" stop-opacity="${strength * 0.6}"/>
    <stop offset="${reach}" stop-color="#0b0d12" stop-opacity="0"/>
  </linearGradient>
  <rect width="${W}" height="${H}" fill="url(#scrim)"/>`;
};

/** Words on the left, over the sky and the dark water; the moon and its path on the right. */
const landscape = (W: number, H: number) => {
  const s = H / 630, left = Math.round(W * 0.075), base = H * 0.42;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${scrim(W, H, 'left', 0.62)}
  ${text(italic, 'Lull', left - 4 * s, base, 180 * s, '#eceff4')}
  ${TAG.map((t, i) => text(roman, t, left, base + (74 + i * 46) * s, 36 * s, '#c3c9d4')).join('')}
  ${text(roman, FOOT, left, H - 56 * s, 24 * s, '#8a91a1', 'left', 0.05)}
  ${grain(W, H)}</svg>`;
};

/** A very wide header: one line of tagline. */
const wide = (W: number, H: number) => {
  const s = H / 500, left = Math.round(W * 0.065), base = H * 0.5;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${scrim(W, H, 'left', 0.62)}
  ${text(italic, 'Lull', left - 3 * s, base, 150 * s, '#eceff4')}
  ${text(roman, `${TAG[0]} ${TAG[1]}`, left, base + 64 * s, 29 * s, '#c3c9d4')}
  ${text(roman, FOOT, left, base + 114 * s, 21 * s, '#8a91a1', 'left', 0.05)}
  ${grain(W, H)}</svg>`;
};

/** Square: the moon and its path above, the words centred below over a scrim. */
const square = (S: number) => {
  const s = S / 1080, cx = S / 2, base = S * 0.7;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">${scrim(S, S, 'bottom', 0.6, 0.9)}
  ${text(italic, 'Lull', cx, base, 200 * s, '#eceff4', 'middle')}
  ${TAG.map((t, i) => text(roman, t, cx, base + (80 + i * 50) * s, 40 * s, '#c3c9d4', 'middle')).join('')}
  ${text(roman, FOOT, cx, S - 64 * s, 25 * s, '#8a91a1', 'middle', 0.05)}
  ${grain(S, S)}</svg>`;
};

/** The painting, cropped to size: `crop` is the source region (in the 1664×928 painting) to fill the frame with. */
const background = (W: number, H: number, crop?: { left: number; top: number; width: number; height: number }) => {
  const img = sharp(BG);
  return (crop ? img.extract(crop) : img).resize(W, H, { fit: 'cover' });
};

const OUT = 'design/social';
mkdirSync(OUT, { recursive: true });
const out = async (name: string, W: number, H: number, svg: string, crop?: Parameters<typeof background>[2]) => {
  const bg = await background(W, H, crop).toBuffer();
  const overlay = await sharp(Buffer.from(svg), { density: 144 }).resize(W, H).png().toBuffer();
  await sharp(bg).composite([{ input: overlay }]).png({ compressionLevel: 9 }).toFile(`${OUT}/${name}.png`);
  console.log(`${OUT}/${name}.png`);
};
await out('lull-banner-1600x900', 1600, 900, landscape(1600, 900));
await out('lull-banner-1200x630', 1200, 630, landscape(1200, 630));
await sharp(`${OUT}/lull-banner-1200x630.png`).jpeg({ quality: 86, mozjpeg: true }).toFile('public/og.jpg');
console.log('public/og.jpg');
// The band from the sky above the moon down past the horizon.
await out('lull-banner-1500x500', 1500, 500, wide(1500, 500), { left: 0, top: 40, width: 1664, height: 555 });
// Centred on the moon's path; the sand at the bottom sits under the scrim.
await out('lull-square-1080', 1080, 1080, square(1080), { left: 690, top: 0, width: 928, height: 928 });

/**
 * Generate every brand asset from src/brand/mark.ts.   npm run brand
 *
 *   public/icons/   icon.svg (favicon), icon-192/512, maskable-192/512, apple-touch-icon (180)
 *   public/brand/   lull-mark.svg (transparent), lull-lockup.svg, lull-stack.svg
 *   design/og-classic.png   the original 1200×630 vector card (the live one, public/og.jpg, comes from scripts/social.ts)
 *
 * Text is converted to paths (opentype.js + the Cormorant Garamond files already in node_modules),
 * so the SVGs look right anywhere and sharp can render them without system fonts.
 */
import sharp from 'sharp';
import opentype from 'opentype.js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { BRAND, markBody, markDefs, markSvg } from '../src/brand/mark';

const FONTS = 'node_modules/@fontsource/cormorant-garamond/files';
const font = (file: string) => {
  const b = readFileSync(`${FONTS}/${file}`);
  return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const italic = font('cormorant-garamond-latin-500-italic.woff');
const roman = font('cormorant-garamond-latin-400-normal.woff');

/** opentype.js 2.0's toPathData() emits NaN for some coordinates; serialize the commands directly. */
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

/**
 * Text as a path, anchored by its centre (align 'middle') or left edge. `spacing` is in em.
 * Laid out glyph by glyph with plain kerning, skipping opentype.js's feature-driven string layout.
 */
const text = (f: opentype.Font, s: string, x: number, y: number, size: number, fill: string, align: 'left' | 'middle' = 'left', spacing = 0) => {
  const scale = size / f.unitsPerEm;
  const glyphs = [...s].map(ch => f.charToGlyph(ch));
  const advances = glyphs.map((g, i) => {
    const k = i < glyphs.length - 1 ? f.getKerningValue(g, glyphs[i + 1]) : 0;
    const kern = Number.isFinite(k) ? k : 0; // some pairs come back NaN
    return ((g.advanceWidth ?? 0) + kern) * scale + (i < glyphs.length - 1 ? spacing * size : 0);
  });
  const width = advances.reduce((a, b) => a + b, 0);
  let cx = align === 'middle' ? x - width / 2 : x;
  const d = glyphs
    .map((g, i) => {
      const part = pathData(g.getPath(cx, y, size));
      cx += advances[i];
      return part;
    })
    .join('');
  return { svg: `<path d="${d}" fill="${fill}"/>`, width };
};

mkdirSync('public/brand', { recursive: true });
const png = async (svg: string, size: number, out: string, h = size) => {
  await sharp(Buffer.from(svg), { density: 300 }).resize(size, h).png({ compressionLevel: 9 }).toFile(out);
  console.log(out);
};

// ─── icons ───
const icon = markSvg({ id: 'i' });
writeFileSync('public/icons/icon.svg', icon);
await png(icon, 192, 'public/icons/icon-192.png');
await png(icon, 512, 'public/icons/icon-512.png');
await png(icon, 180, 'public/icons/apple-touch-icon.png');
// Launchers crop maskable icons to a circle: keep the mark inside the central 80%.
const maskable = markSvg({ id: 'k', scale: 0.78 });
await png(maskable, 192, 'public/icons/maskable-192.png');
await png(maskable, 512, 'public/icons/maskable-512.png');

// ─── mark and lockups (transparent) ───
writeFileSync('public/brand/lull-mark.svg', markSvg({ id: 'm', bg: false }));

{
  // Side by side: mark cropped to its content, then the italic wordmark.
  const word = text(italic, 'Lull', 0, 0, 300, BRAND.line);
  const w = 440 + word.width + 40;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 420">
  <defs>${markDefs('l')}</defs>
  <g transform="translate(-40 -60)">${markBody('l')}</g>
  <g transform="translate(440 300)">${word.svg}</g>
</svg>`;
  writeFileSync('public/brand/lull-lockup.svg', svg);
  console.log('public/brand/lull-lockup.svg');
}
{
  const word = text(italic, 'Lull', 256, 560, 170, BRAND.line, 'middle');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 600">
  <defs>${markDefs('s')}</defs>
  <g transform="translate(0 -20)">${markBody('s')}</g>
  ${word.svg}
</svg>`;
  writeFileSync('public/brand/lull-stack.svg', svg);
  console.log('public/brand/lull-stack.svg');
}

// ─── social card: 1200×630 ───
{
  const W = 1200, H = 630;
  // The scene: a wide horizon, the moon resting on it, reflection below. Words on the left.
  const cx = 860, hy = 360, r = 150;
  const refl = [320, 240, 150, 70]
    .map((w, i) => `<line x1="${cx - w / 2}" x2="${cx + w / 2}" y1="${hy + 44 + i * 30}" y2="${hy + 44 + i * 30}" stroke="${BRAND.line}" stroke-width="10" stroke-linecap="round" opacity="${BRAND.reflection.opacity[i]}"/>`)
    .join('');
  const word = text(italic, 'Lull', 96, 300, 190, '#e8ebf1');
  const line1 = text(roman, 'Ocean, rain and gentle noise', 100, 390, 40, '#b9bfca');
  const line2 = text(roman, 'for falling asleep.', 100, 440, 40, '#b9bfca');
  const url = text(roman, 'lull.makeratl.com', 100, 548, 26, '#7d8494', 'left', 0.06);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
  <defs>
    ${markDefs('o')}
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0e1117"/><stop offset=".55" stop-color="#141821"/><stop offset="1" stop-color="#0c0e13"/>
    </linearGradient>
    <radialGradient id="glow" cx="${cx}" cy="${hy - 40}" r="360" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${BRAND.line}" stop-opacity=".16"/><stop offset="1" stop-color="${BRAND.line}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="hz" x1="${cx - 420}" y1="0" x2="${cx - 150}" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${BRAND.line}" stop-opacity="0"/><stop offset="1" stop-color="${BRAND.line}" stop-opacity=".7"/>
    </linearGradient>
    <clipPath id="above"><rect x="0" y="0" width="${W}" height="${hy}"/></clipPath>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <circle cx="${cx}" cy="${hy - 40}" r="${r}" fill="url(#o-m)" clip-path="url(#above)"/>
  <rect x="${cx - 420}" y="${hy - 5}" width="${W - cx + 440}" height="10" fill="url(#hz)"/>
  ${refl}
  ${word.svg}${line1.svg}${line2.svg}${url.svg}
</svg>`;
  writeFileSync('design/og.svg', svg);
  await png(svg, W, 'design/og-classic.png', H);
}

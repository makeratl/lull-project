/**
 * The Lull mark: the moon resting on still water, its reflection breaking up below.
 * The one source for the app icons, favicon, lockups, social card, sign-in pages and the opening.
 * Geometry is in a 512 box; `id` keeps gradient ids unique when several marks share a page.
 */
export const BRAND = {
  bg: '#11141b',
  moonHi: '#f5f7fb',
  moonMid: '#cfd8e6',
  moonLo: '#aeb9cc',
  line: '#cdd8ea',
  /** The moon: centre and radius. Its lower part is hidden below the horizon. */
  moon: { cx: 256, cy: 232, r: 120 },
  horizon: { y: 318, x0: 60, x1: 452 },
  /** Reflection strokes: width, then vertical step and opacities. */
  reflection: { y: 350, step: 24, widths: [200, 150, 96, 44], opacity: [0.5, 0.34, 0.2, 0.12] },
  stroke: 9,
} as const;

export interface MarkOptions {
  id?: string;
  /** Paint the night background square. */
  bg?: boolean;
  /** Scale about the centre (e.g. 0.8 keeps a maskable icon inside the safe zone). */
  scale?: number;
}

export const markDefs = (id: string) => `
  <radialGradient id="${id}-m" cx="38%" cy="34%" r="70%">
    <stop offset="0" stop-color="${BRAND.moonHi}"/><stop offset=".58" stop-color="${BRAND.moonMid}"/><stop offset="1" stop-color="${BRAND.moonLo}"/>
  </radialGradient>
  <radialGradient id="${id}-g" cx="50%" cy="50%" r="50%">
    <stop offset=".45" stop-color="${BRAND.line}" stop-opacity=".16"/><stop offset="1" stop-color="${BRAND.line}" stop-opacity="0"/>
  </radialGradient>
  <clipPath id="${id}-c"><rect x="-2000" y="-2000" width="4512" height="${2000 + BRAND.horizon.y}"/></clipPath>`;

/** The mark's shapes, without the outer <svg>. */
export const markBody = (id: string) => {
  const { moon: m, horizon: h, reflection: r, stroke } = BRAND;
  const strokes = r.widths
    .map((w, i) => `<line x1="${256 - w / 2}" x2="${256 + w / 2}" y1="${r.y + i * r.step}" y2="${r.y + i * r.step}" stroke="${BRAND.line}" stroke-width="${stroke}" stroke-linecap="round" opacity="${r.opacity[i]}"/>`)
    .join('');
  return `
  <circle cx="256" cy="250" r="200" fill="url(#${id}-g)"/>
  <circle cx="${m.cx}" cy="${m.cy}" r="${m.r}" fill="url(#${id}-m)" clip-path="url(#${id}-c)"/>
  <line x1="${h.x0}" x2="${h.x1}" y1="${h.y}" y2="${h.y}" stroke="${BRAND.line}" stroke-width="${stroke}" stroke-linecap="round" opacity=".75"/>
  ${strokes}`;
};

export const markSvg = ({ id = 'lull', bg = true, scale = 1 }: MarkOptions = {}) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>${markDefs(id)}</defs>
  ${bg ? `<rect width="512" height="512" fill="${BRAND.bg}"/>` : ''}
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${markBody(id)}</g>
</svg>`;

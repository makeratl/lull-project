/**
 * Lull logo marks: "moon on still water". Pure functions returning SVG markup, shared by the
 * design lab page and (once one is chosen) the asset generator. Coordinates are in a 512 box.
 */
export const C = {
  bg: '#11141b',
  bg2: '#161a23',
  moonHi: '#f5f7fb',
  moonMid: '#cfd8e6',
  moonLo: '#aeb9cc',
  line: '#cdd8ea',
};

const moonDefs = id => `
  <radialGradient id="${id}-m" cx="38%" cy="34%" r="70%">
    <stop offset="0" stop-color="${C.moonHi}"/><stop offset=".58" stop-color="${C.moonMid}"/><stop offset="1" stop-color="${C.moonLo}"/>
  </radialGradient>
  <radialGradient id="${id}-g" cx="50%" cy="50%" r="50%">
    <stop offset=".45" stop-color="${C.line}" stop-opacity=".16"/><stop offset="1" stop-color="${C.line}" stop-opacity="0"/>
  </radialGradient>`;

/** A soft swell across the full width: one long, low wave. */
const wave = (y, amp, x0 = 56, x1 = 456) => {
  const w = x1 - x0, q = w / 4;
  return `M${x0} ${y} C${x0 + q * 0.6} ${y - amp} ${x0 + q * 1.4} ${y - amp} ${x0 + q * 2} ${y} S${x0 + q * 3.4} ${y + amp} ${x1} ${y}`;
};

/** Broken reflection strokes under the moon, narrowing as they fall. */
const reflection = (cx, y, widths, gap = 22, op = [0.5, 0.34, 0.2, 0.12]) =>
  widths
    .map((w, i) => `<line x1="${cx - w / 2}" x2="${cx + w / 2}" y1="${y + i * gap}" y2="${y + i * gap}" stroke="${C.line}" stroke-width="9" stroke-linecap="round" opacity="${op[i] ?? 0.1}"/>`)
    .join('');

export const MARKS = {
  /** A: the full moon above a gentle swell, its reflection breaking below. */
  float: {
    name: 'Floating',
    note: 'Full moon above a gentle swell; the reflection breaks up below. Closest to the play button.',
    svg: (id = 'a', bg = true) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>${moonDefs(id)}</defs>
  ${bg ? `<rect width="512" height="512" fill="${C.bg}"/>` : ''}
  <circle cx="256" cy="206" r="190" fill="url(#${id}-g)"/>
  <circle cx="256" cy="206" r="112" fill="url(#${id}-m)"/>
  <path d="${wave(362, 14)}" fill="none" stroke="${C.line}" stroke-width="9" stroke-linecap="round" opacity=".7"/>
  ${reflection(256, 398, [150, 104, 62, 28])}
</svg>`,
  },

  /** B: the moon resting on the horizon, its lower edge meeting the water. */
  rest: {
    name: 'Resting',
    note: 'The moon sits on the waterline, as if settling for the night. Calmer and more horizon-like.',
    svg: (id = 'b', bg = true) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>${moonDefs(id)}
    <clipPath id="${id}-c"><rect x="0" y="0" width="512" height="318"/></clipPath>
  </defs>
  ${bg ? `<rect width="512" height="512" fill="${C.bg}"/>` : ''}
  <circle cx="256" cy="250" r="200" fill="url(#${id}-g)"/>
  <circle cx="256" cy="232" r="120" fill="url(#${id}-m)" clip-path="url(#${id}-c)"/>
  <line x1="60" x2="452" y1="318" y2="318" stroke="${C.line}" stroke-width="9" stroke-linecap="round" opacity=".75"/>
  ${reflection(256, 350, [200, 150, 96, 44], 24)}
</svg>`,
  },

  /** C: the moon with a soft shadowed limb over one wave crest, a single reflection. Most graphic. */
  crest: {
    name: 'Crest',
    note: 'A shaded moon over one wave crest and a single long reflection. Most graphic; reads best very small.',
    svg: (id = 'c', bg = true) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>${moonDefs(id)}
    <radialGradient id="${id}-s" cx="78%" cy="74%" r="60%">
      <stop offset="0" stop-color="#3c4860" stop-opacity=".55"/><stop offset="1" stop-color="#3c4860" stop-opacity="0"/>
    </radialGradient>
  </defs>
  ${bg ? `<rect width="512" height="512" fill="${C.bg}"/>` : ''}
  <circle cx="256" cy="212" r="180" fill="url(#${id}-g)"/>
  <circle cx="256" cy="212" r="116" fill="url(#${id}-m)"/>
  <circle cx="256" cy="212" r="116" fill="url(#${id}-s)"/>
  <path d="M86 372 C166 340 214 336 256 352 S350 384 426 358" fill="none" stroke="${C.line}" stroke-width="11" stroke-linecap="round" opacity=".8"/>
  ${reflection(256, 408, [120, 56], 24, [0.4, 0.2])}
</svg>`,
  },
};

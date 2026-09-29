/** Render the moon icon to the PNG sizes the manifest and iOS need.  npm run icons */
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const svg = readFileSync('public/icons/icon.svg');
// Maskable icons get cropped to a circle by the launcher: shrink the moon into the safe zone.
const maskable = Buffer.from(svg.toString().replace('r="150"', 'r="120"').replace('r="230"', 'r="190"'));

const out = async (src: Buffer, size: number, name: string) => {
  await sharp(src, { density: 300 }).resize(size, size).png().toFile(`public/icons/${name}`);
  console.log(name);
};

await out(svg, 192, 'icon-192.png');
await out(svg, 512, 'icon-512.png');
await out(maskable, 192, 'maskable-192.png');
await out(maskable, 512, 'maskable-512.png');
await out(svg, 180, 'apple-touch-icon.png');

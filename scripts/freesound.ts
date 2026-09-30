/**
 * Shortlist CC0 field recordings from Freesound for Lull's water sounds, and download their previews to listen to.
 *   npm run sounds:fetch                 all sets
 *   npm run sounds:fetch -- surf         one set
 * Needs FREESOUND_API_KEY in .env.local (https://freesound.org/apiv2/apply).
 * Writes to $LULL_SOURCES (default ~/Music/lull-sources)/<set>/<id>-<slug>.mp3, plus sources.json.
 * The HQ preview (128 kbps MP3) is enough: everything is re-encoded by scripts/water.sh anyway.
 */
import { config } from 'dotenv';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

config({ path: ['.env.local', '.env'], quiet: true });
const key = process.env.FREESOUND_API_KEY;
if (!key) throw new Error('Set FREESOUND_API_KEY in .env.local (https://freesound.org/apiv2/apply)');
const root = process.env.LULL_SOURCES || join(homedir(), 'Music', 'lull-sources');

// Anything that would break the spell at 3 a.m.
const UNWANTED = /\b(sea)?gulls?\b|\bbirds?\b|birdsong|\bvoices?\b|\btalk|\bpeople\b|\bkids?\b|\bchild|\bmusic|\bdogs?\b|\bboats?\b|\bmotor|\bengine|\btraffic\b|\bcars?\b|\bplanes?\b|\bwind-?noise|\brain\b|\bthunder|underwater|hydrophone/i;

const SETS: Record<string, { queries: string[]; duration: [number, number] }> = {
  surf: { queries: ['ocean waves beach', 'waves breaking shore', 'surf beach waves'], duration: [60, 900] },
  stream: { queries: ['stream brook water', 'creek water flowing', 'babbling brook'], duration: [60, 900] },
};
const KEEP = 8;

interface Hit {
  id: number;
  name: string;
  username: string;
  license: string;
  duration: number;
  url: string;
  tags: string[];
  num_downloads: number;
  avg_rating: number;
  previews: Record<string, string>;
}

const search = async (query: string, [lo, hi]: [number, number]) => {
  const u = new URL('https://freesound.org/apiv2/search/text/');
  u.searchParams.set('query', query);
  u.searchParams.set('filter', `license:"Creative Commons 0" duration:[${lo} TO ${hi}]`);
  u.searchParams.set('fields', 'id,name,username,license,duration,url,tags,num_downloads,avg_rating,previews');
  u.searchParams.set('sort', 'score');
  u.searchParams.set('page_size', '40');
  const r = await fetch(u, { headers: { Authorization: `Token ${key}` } });
  if (!r.ok) throw new Error(`Freesound ${r.status}: ${await r.text()}`);
  return ((await r.json()) as { results: Hit[] }).results;
};

const slug = (s: string) => s.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

const wanted = process.argv.slice(2);
for (const [set, spec] of Object.entries(SETS)) {
  if (wanted.length && !wanted.includes(set)) continue;
  const seen = new Map<number, Hit>();
  for (const q of spec.queries) for (const h of await search(q, spec.duration)) if (!seen.has(h.id)) seen.set(h.id, h);
  const picks = [...seen.values()]
    .filter(h => !UNWANTED.test(h.name) && !h.tags.some(t => UNWANTED.test(t)))
    // Popular and well rated first: a rough proxy for clean, well-made recordings.
    .sort((a, b) => Math.log1p(b.num_downloads) * (1 + b.avg_rating) - Math.log1p(a.num_downloads) * (1 + a.avg_rating))
    .slice(0, KEEP);
  const dir = join(root, set);
  mkdirSync(dir, { recursive: true });
  const meta = [];
  for (const h of picks) {
    const file = `${h.id}-${slug(h.name)}.mp3`;
    if (!existsSync(join(dir, file))) {
      const r = await fetch(h.previews['preview-hq-mp3']);
      if (!r.ok) { console.warn(`skip ${h.id}: preview ${r.status}`); continue; }
      writeFileSync(join(dir, file), Buffer.from(await r.arrayBuffer()));
    }
    meta.push({ id: h.id, file, title: h.name, author: h.username, url: h.url, license: h.license, duration: Math.round(h.duration), downloads: h.num_downloads, rating: h.avg_rating });
    console.log(`${set}  ${String(Math.round(h.duration)).padStart(4)} s  ${file}  (${h.username})`);
  }
  writeFileSync(join(dir, 'sources.json'), JSON.stringify(meta, null, 2) + '\n');
}
console.log(`\nListen in ${root}, then put the chosen ids in scripts/sounds.json.`);

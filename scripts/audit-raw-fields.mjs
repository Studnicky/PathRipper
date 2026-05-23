// Survey what's still landing in raw_fields per _type after step #1 + #2.
// raw_fields is a "we saw this key but didn't structure it" sink — high counts
// or unfamiliar keys per type signal extraction gaps.
import { readdirSync, readFileSync } from 'node:fs';
import { load } from 'cheerio';
import { parseAonHtml } from '../plugins/aonprd/parse.task.ts';

const rawDir = './output-live/aonprd/aonprd/raw';
const allFiles = readdirSync(rawDir).filter((f) => f.endsWith('.html'));

// Group by URL kind (Monsters.aspx, Feats.aspx, etc.) — type the page produces.
const byKind = new Map();
for (const f of allFiles) {
  const m = /^([A-Za-z]+)\.aspx/.exec(f);
  if (!m) continue;
  const kind = m[1];
  if (!byKind.has(kind)) byKind.set(kind, []);
  byKind.get(kind).push(f);
}

// Sample up to N records per kind, accumulate raw_fields key frequencies.
const SAMPLE_N = 30;
const stats = new Map(); // _type → Map<key, count>
const counts = new Map(); // _type → records

for (const [kind, files] of byKind) {
  for (const f of files.slice(0, SAMPLE_N)) {
    const html = readFileSync(`${rawDir}/${f}`, 'utf8');
    const url = `https://2e.aonprd.com/${f.replace('.html', '').replace('-ID-', '.aspx?ID=')}`;
    let r;
    try { r = parseAonHtml(html, url); } catch { continue; }
    const t = r._type;
    counts.set(t, (counts.get(t) ?? 0) + 1);
    if (!stats.has(t)) stats.set(t, new Map());
    const m = stats.get(t);
    for (const k of Object.keys(r.raw_fields ?? {})) {
      m.set(k, (m.get(k) ?? 0) + 1);
    }
  }
}

// Print: per _type, total records and top 20 raw_fields keys by frequency.
console.log(`=== raw_fields key frequency per _type (sample) ===`);
const sortedTypes = [...stats.entries()].sort((a, b) => (counts.get(b[0]) ?? 0) - (counts.get(a[0]) ?? 0));
for (const [type, keys] of sortedTypes) {
  const n = counts.get(type) ?? 0;
  console.log(`\n[${type}] n=${n}`);
  const sorted = [...keys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  for (const [key, count] of sorted) {
    const pct = ((count / n) * 100).toFixed(0);
    console.log(`  ${pct.padStart(3)}%  ${count.toString().padStart(3)}  ${key}`);
  }
}

import { readdirSync, readFileSync } from 'node:fs';
import { load } from 'cheerio';
import { parseAonHtml } from '../plugins/aonprd/parse.task.ts';

const rawDir = './output-live/aonprd/aonprd/raw';
const monsters = readdirSync(rawDir).filter((f) => f.startsWith('Monsters.aspx-ID-') && f.endsWith('.html'));

const sample = monsters.slice(0, 100);
let recoveredCount = 0;
let totalAbilities = 0;
const samples = [];

for (const name of sample) {
  const html = readFileSync(`${rawDir}/${name}`, 'utf8');
  const url = `https://2e.aonprd.com/${name.replace('.html', '').replace('-ID-', '.aspx?ID=')}`;
  const r = parseAonHtml(html, url);
  if (r._type !== 'monster') continue;
  const topNames = r.top_abilities.map((a) => a.name);
  if (topNames.length > 0) {
    recoveredCount++;
    totalAbilities += topNames.length;
    if (samples.length < 12) samples.push(`${r.name}: [${topNames.join(', ')}]`);
  }
}

console.log(`Out of ${sample.length} monsters: ${recoveredCount} have ≥1 top_ability (was 0 before fix).`);
console.log(`Total abilities recovered: ${totalAbilities}`);
console.log(`Sample:`);
for (const s of samples) console.log(`  ${s}`);

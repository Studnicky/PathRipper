import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import { extractCommon } from '../plugins/aonprd/common.ts';

const html = readFileSync(
  './output-live/aonprd/aonprd/raw/Archetypes.aspx-ID-100.html',
  'utf8',
);
const $ = load(html);
const common = extractCommon($, 'https://2e.aonprd.com/Archetypes.aspx?ID=100');
if (common === null) {
  console.log('extractCommon returned null');
  process.exit(1);
}
console.log(`sections: ${common.sections.length}`);
for (const s of common.sections) {
  const bodyLen = s.body_text.length;
  const preview = s.body_text.slice(0, 80).replace(/\s+/g, ' ');
  console.log(`  [${s.level}] ${s.heading} -> body_text=${bodyLen}b  "${preview}${bodyLen > 80 ? '...' : ''}"`);
}

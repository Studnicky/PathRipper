/**
 * verify-i18n-sample.mjs
 *
 * Smoke test for the Track 4b i18n ripper extension.
 *
 * Fetches wikitext for 10 sample Bulbapedia articles via the MediaWiki API,
 * runs extractOtherNames on each, and reports the names_intl entries found.
 * Also writes updated JSON files to /tmp/bulbapedia-i18n-sample/ for inspection.
 *
 * Usage: node scripts/verify-i18n-sample.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Import the compiled plugin (compiled from plugins/bulbapedia/parse.task.ts)
const { extractOtherNames } = await import('../plugins/bulbapedia/parse.task.js');

const API_URL = 'https://bulbapedia.bulbagarden.net/w/api.php';
const RIPPER_OUTPUT = '/Users/studs/Workspace/ripper/output/bulbapedia/bulbapedia';
const OUT_DIR = '/tmp/bulbapedia-i18n-sample';

// The 10 sample articles: Bulbapedia title → output file slug
const SAMPLES = [
  { title: 'Pikachu (Pokémon)',      slug: 'pikachu-pokmon'     },
  { title: 'Charizard (Pokémon)',    slug: 'charizard-pokmon'   },
  { title: 'Mewtwo (Pokémon)',       slug: 'mewtwo-pokmon'      },
  { title: 'Bulbasaur (Pokémon)',    slug: 'bulbasaur-pokmon'   },
  { title: 'Charmander (Pokémon)',   slug: 'charmander-pokmon'  },
  { title: 'Tackle (move)',          slug: 'tackle-move'        },
  { title: 'Thunderbolt (move)',     slug: 'thunderbolt-move'   },
  { title: 'Master Ball',           slug: 'master-ball'        },
  { title: 'Poké Ball',             slug: 'pok-ball'           },
  { title: 'Static (Ability)',       slug: 'static-ability'     },
];

async function fetchWikitext(title) {
  const params = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'revisions',
    rvprop: 'content',
    rvslots: 'main',
    format: 'json',
    formatversion: '2',
  });
  const url = `${API_URL}?${params.toString()}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'PokemontologyI18nVerifier/1.0 (a.j.studnicky@gmail.com)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${title}`);
  const json = await res.json();
  const page = json?.query?.pages?.[0];
  if (page?.missing) throw new Error(`Page not found: ${title}`);
  return page?.revisions?.[0]?.slots?.main?.content ?? '';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

mkdirSync(OUT_DIR, { recursive: true });

console.log('Track 4b i18n ripper sample verification\n');
console.log(`Output dir: ${OUT_DIR}\n`);

let totalNonEnglish = 0;
const bcpKeysObserved = new Set();
const results = [];

for (const { title, slug } of SAMPLES) {
  process.stdout.write(`Fetching "${title}"... `);

  let wikitext;
  try {
    wikitext = await fetchWikitext(title);
    process.stdout.write(`${wikitext.length} chars. `);
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
    results.push({ slug, title, names_intl: {}, error: err.message });
    continue;
  }

  const namesIntl = extractOtherNames(wikitext);
  const count = Object.keys(namesIntl).length;
  totalNonEnglish += count;
  Object.keys(namesIntl).forEach(k => bcpKeysObserved.add(k));

  console.log(`names_intl: ${count} entries [${Object.keys(namesIntl).join(', ')}]`);

  // Read existing output JSON and merge names_intl
  let existing;
  try {
    existing = JSON.parse(readFileSync(join(RIPPER_OUTPUT, `${slug}.json`), 'utf-8'));
  } catch {
    existing = { _type: 'unknown', title };
  }

  const updated = { ...existing, names_intl: namesIntl };
  writeFileSync(join(OUT_DIR, `${slug}.json`), JSON.stringify(updated, null, 2), 'utf-8');
  results.push({ slug, title, names_intl: namesIntl });

  await sleep(1100); // respect rate limit
}

console.log('\n── Summary ──────────────────────────────────────────────');
console.log(`Articles processed: ${results.length}/10`);
console.log(`Total non-English entries across all articles: ${totalNonEnglish}`);
console.log(`Average per article: ${(totalNonEnglish / results.length).toFixed(1)}`);
console.log(`BCP-47 keys observed in wild: ${[...bcpKeysObserved].sort().join(', ')}`);
console.log(`\nFiles with ≥ 5 non-English entries:`);
for (const r of results) {
  const count = Object.keys(r.names_intl).length;
  const mark = count >= 5 ? '✓' : (r.error ? 'ERR' : '✗');
  console.log(`  ${mark} ${r.slug}: ${count} entries`);
}
console.log(`\nUpdated JSON samples written to: ${OUT_DIR}`);

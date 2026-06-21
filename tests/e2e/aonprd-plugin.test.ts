// Lane 11 follow-up — exercises the AON HTML adapter + the aonprd plugin
// end-to-end against the live 2e.aonprd.com site. CI never runs this; the
// plugin extraction logic is the real test of the project's plugin contract.
//
// Run locally:                npm run test:e2e
// Plugin smoke only:          npm run test:e2e -- --test-name-pattern='aonprd plugin smoke'
// Full pipeline traversal:    npm run test:e2e -- --test-name-pattern='full pipeline'
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { HtmlScraper }  from '../../src/scrapers/HtmlScraper.js';
import { LinkLister }   from '../../src/crawlers/LinkLister.js';
import { ScraperCache } from '../../src/modules/cache/ScraperCache.js';
import { DAGDocument }  from '@studnicky/dagonizer';
import { runDag }       from '../../src/run/runDag.js';
import { parseAonHtml } from '../../plugins/aonprd/parse.task.js';
import { ParsedOutput } from '../helpers/ParsedOutput.js';
import type { SpellOutput }   from '../../plugins/aonprd/concepts/spell/index.js';
import type { MonsterOutput } from '../../plugins/aonprd/concepts/monster/types.js';
import type { WeaponOutput }  from '../../plugins/aonprd/concepts/weapon.js';
import type { RunStateType, RunCrawlerType } from '../../src/types/RunState.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CRAWLER_STATE_PATH = resolve(__dirname, 'fixtures/aonprd-crawler.state.json');
const SCRAPE_DAG_PATH    = resolve(__dirname, 'fixtures/aonprd-scrape.dag.jsonld');
const REPO_ROOT          = resolve(__dirname, '..', '..');

// A curated set of stable URLs across every page-type the plugin supports.
const PLUGIN_PROBES: ReadonlyArray<{ url: string; expectType: string }> = [
  { url: 'https://2e.aonprd.com/Spells.aspx?ID=1',     expectType: 'spell' },
  { url: 'https://2e.aonprd.com/Feats.aspx?ID=1',      expectType: 'feat' },
  { url: 'https://2e.aonprd.com/Monsters.aspx?ID=1',   expectType: 'monster' },
  { url: 'https://2e.aonprd.com/Equipment.aspx?ID=1',  expectType: 'equipment' },
  { url: 'https://2e.aonprd.com/Weapons.aspx?ID=1',    expectType: 'weapon' },
  { url: 'https://2e.aonprd.com/Conditions.aspx?ID=1', expectType: 'condition' },
  { url: 'https://2e.aonprd.com/Backgrounds.aspx?ID=1',expectType: 'background' },
  { url: 'https://2e.aonprd.com/Traits.aspx?ID=1',     expectType: 'trait' },
];

describe('AONPRD plugin e2e (local only)', () => {
  it('aonprd plugin smoke — fetch and parse one of every page type', async () => {
    const crawlerState = JSON.parse(readFileSync(CRAWLER_STATE_PATH, 'utf-8')) as {
      baseUrl: string; rateLimitMs: number; jitterMs: number;
      maxRetries?: number; retryBaseDelayMs?: number; retryMaxDelayMs?: number;
      headers?: Record<string, string>;
    };
    const scraper = HtmlScraper.create({
      baseUrl:          crawlerState.baseUrl,
      rateLimitMs:      crawlerState.rateLimitMs,
      jitterMs:         crawlerState.jitterMs,
      maxRetries:       crawlerState.maxRetries,
      retryBaseDelayMs: crawlerState.retryBaseDelayMs,
      retryMaxDelayMs:  crawlerState.retryMaxDelayMs,
      headers:          crawlerState.headers,
    });

    process.stdout.write(`\n  smoke: probing ${PLUGIN_PROBES.length.toString()} page types\n`);
    for (const probe of PLUGIN_PROBES) {
      const page   = await scraper.fetchPage(probe.url);
      const result = await parseAonHtml(page.html, page.url) as { name?: string; source?: { book: string | null; page: number | null } };
      const name = result.name ?? '?';
      const src  = result.source !== undefined ? `${result.source.book ?? '?'} pg. ${(result.source.page ?? 0).toString()}` : '?';

      process.stdout.write(`    • ${probe.expectType.padEnd(10)}  ${name.padEnd(28)}  ${src}\n`);

      assert.ok(name !== '' && name !== '?',
        `${probe.url}: parser produced empty name`);
      assert.ok(result.source !== undefined && result.source.book !== null,
        `${probe.url}: missing source.book`);
    }
  });

  it('spell deep extraction — Abyssal Plague', async () => {
    const crawlerState = JSON.parse(readFileSync(CRAWLER_STATE_PATH, 'utf-8')) as {
      baseUrl: string; rateLimitMs: number; jitterMs: number;
      headers?: Record<string, string>;
    };
    const scraper = HtmlScraper.create({
      baseUrl:     crawlerState.baseUrl,
      rateLimitMs: crawlerState.rateLimitMs,
      jitterMs:    crawlerState.jitterMs,
      headers:     crawlerState.headers,
    });
    const page = await scraper.fetchPage('https://2e.aonprd.com/Spells.aspx?ID=1');
    const rawSpell: unknown = await parseAonHtml(page.html, page.url);
    const result    = ParsedOutput.as<SpellOutput>(rawSpell as Record<string, unknown>);

    process.stdout.write(`\n  spell: ${result.name} (rank ${(result.rank ?? -1).toString()}, traditions ${result.traditions.join('+')})\n`);
    process.stdout.write(`    traits: ${result.traits.join(', ')}\n`);
    process.stdout.write(`    save:   ${result.saving_throw?.raw ?? '—'}; range ${result.range ?? '—'}; target ${result.targets ?? '—'}\n`);
    process.stdout.write(`    affliction: ${result.affliction !== null ? `${result.affliction.name} (${result.affliction.type ?? '?'}), ${result.affliction.stages.length.toString()} stages` : 'none'}\n`);

    assert.equal(result.name, 'Abyssal Plague');
    assert.equal(result.rank, 5);
    assert.ok(result.traditions.length >= 1, 'expected at least one tradition');
    assert.ok(result.traits.length >= 3, `expected ≥3 traits, got ${result.traits.length.toString()}`);
    assert.ok(result.saving_throw !== null && /Fortitude/i.test(result.saving_throw.raw ?? ''),
      'expected Fortitude save');
    assert.ok(result.affliction !== null, 'expected affliction subentry');
    assert.ok(result.affliction.stages.length >= 2, 'expected ≥2 affliction stages');
    assert.ok(result.outcomes.success !== null, 'expected Success tier');
  });

  it('monster deep extraction — Phantasmal Minion', async () => {
    const crawlerState = JSON.parse(readFileSync(CRAWLER_STATE_PATH, 'utf-8')) as {
      baseUrl: string; rateLimitMs: number; jitterMs: number;
      headers?: Record<string, string>;
    };
    const scraper = HtmlScraper.create({
      baseUrl:     crawlerState.baseUrl,
      rateLimitMs: crawlerState.rateLimitMs,
      jitterMs:    crawlerState.jitterMs,
      headers:     crawlerState.headers,
    });
    const page = await scraper.fetchPage('https://2e.aonprd.com/Monsters.aspx?ID=1');
    const rawMonster: unknown = await parseAonHtml(page.html, page.url);
    const result    = ParsedOutput.as<MonsterOutput>(rawMonster as Record<string, unknown>);

    process.stdout.write(`\n  monster: ${result.name} (Creature ${(result.level ?? 0).toString()}, ${result.size ?? '?'})\n`);
    process.stdout.write(`    AC ${(result.ac.value ?? 0).toString()}; Fort ${(result.saves.fort ?? 0).toString()} Ref ${(result.saves.ref ?? 0).toString()} Will ${(result.saves.will ?? 0).toString()}; HP ${(result.hp.value ?? 0).toString()}\n`);
    process.stdout.write(`    perception: ${result.perception.modifier ?? '?'}; senses: ${result.perception.senses.join(', ')}\n`);
    process.stdout.write(`    immunities: ${result.immunities.join(', ')}\n`);

    assert.equal(result.name, 'Phantasmal Minion');
    assert.equal(result.level, -1);
    assert.equal(result.size, 'Medium');
    assert.ok(result.ac.value !== null, 'AC must parse');
    assert.ok(result.hp.value !== null, 'HP must parse');
    assert.ok(result.saves.fort !== null && result.saves.ref !== null && result.saves.will !== null,
      'all three saves must parse');
    assert.ok(result.immunities.length >= 1, 'expected ≥1 immunity');
    assert.ok(result.abilities.str !== null, 'ability scores must parse');
  });

  it('weapon deep extraction — id 1', async () => {
    const crawlerState = JSON.parse(readFileSync(CRAWLER_STATE_PATH, 'utf-8')) as {
      baseUrl: string; rateLimitMs: number; jitterMs: number;
      headers?: Record<string, string>;
    };
    const scraper = HtmlScraper.create({
      baseUrl:     crawlerState.baseUrl,
      rateLimitMs: crawlerState.rateLimitMs,
      jitterMs:    crawlerState.jitterMs,
      headers:     crawlerState.headers,
    });
    const page = await scraper.fetchPage('https://2e.aonprd.com/Weapons.aspx?ID=1');
    const rawWeapon: unknown = await parseAonHtml(page.html, page.url);
    const result    = ParsedOutput.as<WeaponOutput>(rawWeapon as Record<string, unknown>);

    process.stdout.write(`\n  weapon: ${result.name}\n`);
    process.stdout.write(`    damage ${result.damage?.dice ?? '—'} ${result.damage?.type ?? '—'}; bulk ${(result.bulk ?? '—').toString()}; hands ${result.hands ?? '—'}\n`);
    process.stdout.write(`    category ${result.category ?? '—'}; group ${result.group?.name ?? '—'}\n`);

    assert.ok(result.name !== '', 'weapon must have a name');
    assert.ok(result.damage !== null && result.damage.dice !== '', 'damage must parse');
    assert.ok(result.category !== null, 'category must parse');
  });

  it('full pipeline — LinkLister + runDag + plugin → typed JSON outputs', async () => {
    const crawlerState = JSON.parse(readFileSync(CRAWLER_STATE_PATH, 'utf-8')) as { crawler: RunCrawlerType };
    const crawler  = crawlerState.crawler;
    const cacheDir = await mkdtemp(resolve(tmpdir(), 'ripper-aonprd-listcache-'));
    const cache    = ScraperCache.create({ dir: cacheDir, mode: 'read-write' });
    const lister = LinkLister.create({
      domain:      new RegExp(crawler.domain),
      target:      new RegExp(crawler.target),
      delimiter:   new RegExp(crawler.delimiter),
      rateLimitMs: crawler.rateLimitMs,
      jitterMs:    crawler.jitterMs,
      maxPages:    5,
      cache,
    });
    const links = await lister.buildList(['https://2e.aonprd.com/Conditions.aspx']);
    const sample = [
      '/Conditions.aspx?ID=1',
      '/Spells.aspx?ID=1',
      '/Feats.aspx?ID=1',
      '/Monsters.aspx?ID=1',
      '/Weapons.aspx?ID=1',
    ];
    process.stdout.write(`\n  full pipeline: ${links.length.toString()} URLs collected, parsing ${sample.length.toString()} deterministic samples\n`);

    const outDir = await mkdtemp(resolve(tmpdir(), 'ripper-aonprd-e2e-'));
    try {
      const entryDag = DAGDocument.load(readFileSync(SCRAPE_DAG_PATH, 'utf-8'));
      const absoluteUrls = sample.map((path) => path.startsWith('http') ? path : `https://2e.aonprd.com${path}`);
      const state = {
        output:  { basePath: outDir, splitByTaskName: false },
        baseUrl: 'https://2e.aonprd.com',
        headers: { 'User-Agent': 'ripperoni-e2e/2.0 (+https://github.com/Studnicky/ripper)' },
        urls:    absoluteUrls,
      } satisfies RunStateType;

      await runDag({ dag: entryDag, state, outDir, configDir: REPO_ROOT });

      // splitByTaskName: false keeps plugin JSON flat under <outDir>/aonprd/<slug>.json
      // (pluginTaskName resolves to the 'aonprd:page' scatter-body ref, but the
      // explicit false disables per-task subfoldering).
      const targetDir = resolve(outDir, 'aonprd');
      const files     = (await readdir(targetDir)).filter((file) => file.endsWith('.json') && file !== 'failures.json');
      assert.ok(files.length === sample.length,
        `expected ${sample.length.toString()} JSON files in aonprd/, got ${files.length.toString()}`);
      for (const file of files) {
        const json = JSON.parse(await readFile(resolve(targetDir, file), 'utf-8')) as {
          name?: string; source?: { book: string | null }; _raw?: unknown;
        };
        process.stdout.write(`    • ${file}  →  name=${json.name ?? '?'}\n`);
        assert.ok(json.name !== undefined && json.name !== '', `${file}: missing name`);
        assert.ok(json.source !== undefined && json.source.book !== null,
          `${file}: missing source.book`);
        assert.equal(json._raw, undefined, `${file}: _raw must NOT be embedded in plugin JSON`);
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});

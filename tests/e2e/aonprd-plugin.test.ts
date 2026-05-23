// Lane 11 follow-up — exercises the AON HTML adapter + the aonprd plugin
// end-to-end against the live 2e.aonprd.com site. CI never runs this; the
// plugin extraction logic is the real test of the project's plugin contract.
//
// Run locally:                npm run test:e2e
// Plugin smoke only:          npm run test:e2e -- --test-name-pattern='aonprd plugin smoke'
// Full pipeline traversal:    npm run test:e2e -- --test-name-pattern='full pipeline'
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { HtmlScraper }  from '../../src/scrapers/HtmlScraper.js';
import { LinkLister }   from '../../src/crawlers/LinkLister.js';
import { runHtml }     from '../../src/run/runHtml.js';
import { RipperConfig } from '../../src/config/RipperConfig.js';
import { ScraperCache } from '../../src/modules/cache/ScraperCache.js';
import { parseAonHtml } from '../../plugins/aonprd/parse.task.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE   = resolve(__dirname, 'fixtures/pathripper-legacy.config.json');

// A curated set of stable URLs across every page-type the plugin supports.
const PLUGIN_PROBES: ReadonlyArray<{ url: string; expect_type: string }> = [
  { url: 'https://2e.aonprd.com/Spells.aspx?ID=1',     expect_type: 'spell' },
  { url: 'https://2e.aonprd.com/Feats.aspx?ID=1',      expect_type: 'feat' },
  { url: 'https://2e.aonprd.com/Monsters.aspx?ID=1',   expect_type: 'monster' },
  { url: 'https://2e.aonprd.com/Equipment.aspx?ID=1',  expect_type: 'equipment' },
  { url: 'https://2e.aonprd.com/Weapons.aspx?ID=1',    expect_type: 'weapon' },
  { url: 'https://2e.aonprd.com/Conditions.aspx?ID=1', expect_type: 'condition' },
  { url: 'https://2e.aonprd.com/Backgrounds.aspx?ID=1',expect_type: 'background' },
  { url: 'https://2e.aonprd.com/Traits.aspx?ID=1',     expect_type: 'trait' },
];

describe('PathRipper legacy AONPRD plugin e2e (local only)', () => {
  it('aonprd plugin smoke — fetch and parse one of every page type', async () => {
    const fx = await RipperConfig.load(FIXTURE);
    const t  = fx.targets!['aonprd']!;
    const scraper = HtmlScraper.create({
      baseUrl:          t.baseUrl,
      rateLimitMs:      t.rateLimitMs,
      jitterMs:         t.jitterMs,
      maxRetries:       t.maxRetries,
      retryBaseDelayMs: t.retryBaseDelayMs,
      retryMaxDelayMs:  t.retryMaxDelayMs,
      headers:          t.headers,
    });

    process.stdout.write(`\n  smoke: probing ${PLUGIN_PROBES.length.toString()} page types\n`);
    for (const probe of PLUGIN_PROBES) {
      const page   = await scraper.fetchPage(probe.url);
      const result = await parseAonHtml(page.html, page.url) as { _type: string; name?: string; source?: { book: string | null; page: number | null } };
      const name = result.name ?? '?';
      const src  = result.source !== undefined ? `${result.source.book ?? '?'} pg. ${(result.source.page ?? 0).toString()}` : '?';
      process.stdout.write(`    • ${probe.expect_type.padEnd(10)}  ${name.padEnd(28)}  ${src}\n`);

      assert.equal(result._type, probe.expect_type,
        `${probe.url}: expected _type='${probe.expect_type}', got '${result._type}'`);
      assert.ok(name !== '' && name !== '?',
        `${probe.url}: parser produced empty name`);
      assert.ok(result.source !== undefined && result.source.book !== null,
        `${probe.url}: missing source.book`);
    }
  });

  it('spell deep extraction — Abyssal Plague', async () => {
    const fx = await RipperConfig.load(FIXTURE);
    const t  = fx.targets!['aonprd']!;
    const scraper = HtmlScraper.create({
      baseUrl:     t.baseUrl,
      rateLimitMs: t.rateLimitMs,
      jitterMs:    t.jitterMs,
      headers:     t.headers,
    });
    const page = await scraper.fetchPage('https://2e.aonprd.com/Spells.aspx?ID=1');
    const r    = await parseAonHtml(page.html, page.url);
    if (r._type !== 'spell') throw new Error(`expected spell, got ${r._type}`);

    process.stdout.write(`\n  spell: ${r.name} (rank ${(r.rank ?? -1).toString()}, traditions ${r.traditions.join('+')})\n`);
    process.stdout.write(`    traits: ${r.traits.join(', ')}\n`);
    process.stdout.write(`    save:   ${r.saving_throw?.raw ?? '—'}; range ${r.range ?? '—'}; target ${r.targets ?? '—'}\n`);
    process.stdout.write(`    affliction: ${r.affliction !== null ? `${r.affliction.name} (${r.affliction.type ?? '?'}), ${r.affliction.stages.length.toString()} stages` : 'none'}\n`);

    assert.equal(r.name, 'Abyssal Plague');
    assert.equal(r.rank, 5);
    assert.ok(r.traditions.length >= 1, 'expected at least one tradition');
    assert.ok(r.traits.length >= 3, `expected ≥3 traits, got ${r.traits.length.toString()}`);
    assert.ok(r.saving_throw !== null && /Fortitude/i.test(r.saving_throw.raw ?? ''),
      'expected Fortitude save');
    assert.ok(r.affliction !== null, 'expected affliction subentry');
    assert.ok(r.affliction.stages.length >= 2, 'expected ≥2 affliction stages');
    assert.ok(r.outcomes.success !== null, 'expected Success tier');
  });

  it('monster deep extraction — Phantasmal Minion', async () => {
    const fx = await RipperConfig.load(FIXTURE);
    const t  = fx.targets!['aonprd']!;
    const scraper = HtmlScraper.create({
      baseUrl:     t.baseUrl,
      rateLimitMs: t.rateLimitMs,
      jitterMs:    t.jitterMs,
      headers:     t.headers,
    });
    const page = await scraper.fetchPage('https://2e.aonprd.com/Monsters.aspx?ID=1');
    const r    = await parseAonHtml(page.html, page.url);
    if (r._type !== 'monster') throw new Error(`expected monster, got ${r._type}`);

    process.stdout.write(`\n  monster: ${r.name} (Creature ${(r.level ?? 0).toString()}, ${r.size ?? '?'})\n`);
    process.stdout.write(`    AC ${(r.ac.value ?? 0).toString()}; Fort ${(r.saves.fort ?? 0).toString()} Ref ${(r.saves.ref ?? 0).toString()} Will ${(r.saves.will ?? 0).toString()}; HP ${(r.hp.value ?? 0).toString()}\n`);
    process.stdout.write(`    perception: ${r.perception.modifier ?? '?'}; senses: ${r.perception.senses.join(', ')}\n`);
    process.stdout.write(`    immunities: ${r.immunities.join(', ')}\n`);

    assert.equal(r.name, 'Phantasmal Minion');
    assert.equal(r.level, -1);
    assert.equal(r.size, 'Medium');
    assert.ok(r.ac.value !== null, 'AC must parse');
    assert.ok(r.hp.value !== null, 'HP must parse');
    assert.ok(r.saves.fort !== null && r.saves.ref !== null && r.saves.will !== null,
      'all three saves must parse');
    assert.ok(r.immunities.length >= 1, 'expected ≥1 immunity');
    assert.ok(r.abilities.str !== null, 'ability scores must parse');
  });

  it('weapon deep extraction — id 1', async () => {
    const fx = await RipperConfig.load(FIXTURE);
    const t  = fx.targets!['aonprd']!;
    const scraper = HtmlScraper.create({
      baseUrl:     t.baseUrl,
      rateLimitMs: t.rateLimitMs,
      jitterMs:    t.jitterMs,
      headers:     t.headers,
    });
    const page = await scraper.fetchPage('https://2e.aonprd.com/Weapons.aspx?ID=1');
    const r    = await parseAonHtml(page.html, page.url);
    if (r._type !== 'weapon') throw new Error(`expected weapon, got ${r._type}`);

    process.stdout.write(`\n  weapon: ${r.name}\n`);
    process.stdout.write(`    damage ${r.damage?.dice ?? '—'} ${r.damage?.type ?? '—'}; bulk ${(r.bulk ?? '—').toString()}; hands ${r.hands ?? '—'}\n`);
    process.stdout.write(`    category ${r.category ?? '—'}; group ${r.group?.name ?? '—'}\n`);

    assert.ok(r.name !== '', 'weapon must have a name');
    assert.ok(r.damage !== null && r.damage.dice !== '', 'damage must parse');
    assert.ok(r.category !== null, 'category must parse');
  });

  it('full pipeline — LinkLister + RipperRun + plugin → typed JSON outputs', async () => {
    const fx = await RipperConfig.load(FIXTURE);
    const c  = fx.crawlers!['aonprd']!;
    const cacheDir = await mkdtemp(resolve(tmpdir(), 'ripper-aonprd-listcache-'));
    const cache    = ScraperCache.create({ dir: cacheDir, mode: 'read-write' });
    const lister = LinkLister.create({
      domain:      new RegExp(c.domain),
      target:      new RegExp(c.target),
      delimiter:   new RegExp(c.delimiter),
      rateLimitMs: c.rateLimitMs,
      jitterMs:    c.jitterMs,
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
      await runHtml({
        target:    'aonprd',
        paths:     sample,
        outDir,
        configDir: resolve(__dirname, '..', '..'),
        config:    fx,
      });

      const targetDir = resolve(outDir, 'aonprd');
      const pluginDir = resolve(targetDir, 'aonprd:parse');
      const files     = (await readdir(pluginDir)).filter((f: string) => f.endsWith('.json') && f !== 'failures.json');
      assert.ok(files.length === sample.length,
        `expected ${sample.length.toString()} JSON files in aonprd:parse/, got ${files.length.toString()}`);
      for (const f of files) {
        const json = JSON.parse(await readFile(resolve(pluginDir, f), 'utf-8')) as {
          _type: string; name?: string; source?: { book: string | null }; _raw?: unknown;
        };
        process.stdout.write(`    • ${f}  →  _type=${json._type}  name=${json.name ?? '?'}\n`);
        assert.ok(json._type !== undefined, `${f}: missing _type discriminator`);
        assert.ok(json.name !== undefined && json.name !== '', `${f}: missing name`);
        assert.ok(json.source !== undefined && json.source.book !== null,
          `${f}: missing source.book`);
        assert.equal(json._raw, undefined, `${f}: _raw must NOT be embedded in plugin JSON`);
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});

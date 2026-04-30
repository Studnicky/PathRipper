// Lane 11 — local-only e2e. Replaces the original PathRipper Pathfinder scrape:
// constructs a LinkLister from the resurrected legacy config and crawls the live
// site with respectful rate-limiting + jitter. CI never runs this — no workflow
// invokes `test:e2e`.
//
// Run locally:                npm run test:e2e
// Smoke only (fast):          npm run test:e2e -- --test-name-pattern='smoke'
// Full crawl (slower):        npm run test:e2e -- --test-name-pattern='full'

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LinkLister } from '../../src/crawlers/LinkLister.js';
import { RipperConfig } from '../../src/config/RipperConfig.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE   = resolve(__dirname, 'fixtures/pathripper-legacy.config.json');

describe('PathRipper legacy AONPRD e2e (local only)', () => {
  it('smoke — crawl one category and collect at least 5 target URLs', async () => {
    const fx = await RipperConfig.load(FIXTURE);
    const c  = fx.crawlers!['aonprd']!;
    const lister = LinkLister.create({
      domain:      new RegExp(c.domain),
      target:      new RegExp(c.target),
      delimiter:   new RegExp(c.delimiter),
      rateLimitMs: c.rateLimitMs,
      jitterMs:    c.jitterMs,
      maxPages:    20,
    });
    const links = await lister.buildList([c.startUrls[0]!]);
    process.stdout.write(`\n  smoke: collected ${links.length.toString()} target URLs from ${c.startUrls[0] ?? '?'}\n`);
    for (const link of links.slice(0, 5)) process.stdout.write(`    • ${link}\n`);
    if (links.length > 5) process.stdout.write(`    … (${(links.length - 5).toString()} more)\n`);

    assert.ok(links.length >= 5, `expected ≥5 target URLs, got ${links.length.toString()}`);
    for (const link of links) {
      assert.match(link, new RegExp(c.target));
      assert.match(link, new RegExp(c.domain));
    }
  });

  it('full — crawl all 41 categories under the configured maxPages cap', async () => {
    const fx = await RipperConfig.load(FIXTURE);
    const c  = fx.crawlers!['aonprd']!;
    const lister = LinkLister.create({
      domain:      new RegExp(c.domain),
      target:      new RegExp(c.target),
      delimiter:   new RegExp(c.delimiter),
      rateLimitMs: c.rateLimitMs,
      jitterMs:    c.jitterMs,
      maxPages:    c.maxPages,
    });
    const links = await lister.buildList([...c.startUrls]);

    // Distribution by category prefix (e.g., Actions.aspx vs. Spells.aspx).
    const prefixes = new Map<string, number>();
    for (const link of links) {
      const m = /\/([A-Za-z]+)\.aspx/.exec(link);
      if (m === null) continue;
      const key = m[1]!;
      prefixes.set(key, (prefixes.get(key) ?? 0) + 1);
    }

    process.stdout.write(`\n  full: collected ${links.length.toString()} target URLs across ${prefixes.size.toString()} category prefixes\n`);
    const sorted = [...prefixes.entries()].sort(([, a], [, b]) => b - a);
    for (const [name, count] of sorted.slice(0, 10)) {
      process.stdout.write(`    ${name}: ${count.toString()}\n`);
    }
    if (sorted.length > 10) process.stdout.write(`    … (${(sorted.length - 10).toString()} more categories)\n`);

    assert.ok(links.length >= 100, `expected ≥100 target URLs across all categories, got ${links.length.toString()}`);
    assert.ok(prefixes.size >= 5, `expected URLs from ≥5 category prefixes (multi-seed traversal), got ${prefixes.size.toString()}`);
  });
});

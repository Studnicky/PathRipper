// Lane 11 — local-only e2e. Constructs a LinkLister from the aonprd target's
// embedded crawler config and crawls the live site with respectful
// rate-limiting + jitter. CI never runs this — no workflow invokes `test:e2e`.
//
// Run locally:                npm run test:e2e
// Smoke only (fast):          npm run test:e2e -- --test-name-pattern='smoke'
// Full crawl (slower):        npm run test:e2e -- --test-name-pattern='full'

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LinkLister }   from '../../src/crawlers/LinkLister.js';
import { ScraperCache } from '../../src/modules/cache/ScraperCache.js';
import type { RunCrawlerType } from '../../src/types/RunState.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CRAWLER_STATE_PATH = resolve(__dirname, 'fixtures/aonprd-crawler.state.json');

describe('AONPRD crawler e2e (local only)', () => {
  it('smoke — crawl one category and collect at least 5 target URLs', async () => {
    const crawlerState = JSON.parse(readFileSync(CRAWLER_STATE_PATH, 'utf-8')) as { crawler: RunCrawlerType };
    const crawler  = crawlerState.crawler;
    const cacheDir = await mkdtemp(join(tmpdir(), 'ripper-aonprd-smoke-cache-'));
    const cache    = ScraperCache.create({ dir: cacheDir, mode: 'read-write' });
    const lister = LinkLister.create({
      domain:      new RegExp(crawler.domain),
      target:      new RegExp(crawler.target),
      delimiter:   new RegExp(crawler.delimiter),
      rateLimitMs: crawler.rateLimitMs,
      jitterMs:    crawler.jitterMs,
      maxPages:    20,
      cache,
    });
    try {
      const links = await lister.buildList([crawler.startUrls[0]!]);
      process.stdout.write(`\n  smoke: collected ${links.length.toString()} target URLs from ${crawler.startUrls[0] ?? '?'}\n`);
      for (const link of links.slice(0, 5)) process.stdout.write(`    • ${link}\n`);
      if (links.length > 5) process.stdout.write(`    … (${(links.length - 5).toString()} more)\n`);

      assert.ok(links.length >= 5, `expected ≥5 target URLs, got ${links.length.toString()}`);
      for (const link of links) {
        assert.match(link, new RegExp(crawler.target));
        assert.match(link, new RegExp(crawler.domain));
      }
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it('full — crawl all 41 categories under the configured maxPages cap', async () => {
    const crawlerState = JSON.parse(readFileSync(CRAWLER_STATE_PATH, 'utf-8')) as { crawler: RunCrawlerType };
    const crawler  = crawlerState.crawler;
    const cacheDir = await mkdtemp(join(tmpdir(), 'ripper-aonprd-full-cache-'));
    const cache    = ScraperCache.create({ dir: cacheDir, mode: 'read-write' });
    const lister = LinkLister.create({
      domain:      new RegExp(crawler.domain),
      target:      new RegExp(crawler.target),
      delimiter:   new RegExp(crawler.delimiter),
      rateLimitMs: crawler.rateLimitMs,
      jitterMs:    crawler.jitterMs,
      maxPages:    crawler.maxPages,
      cache,
    });
    const links = await lister.buildList([...crawler.startUrls]);

    // Distribution by category prefix (e.g., Actions.aspx vs. Spells.aspx).
    const prefixes = new Map<string, number>();
    for (const link of links) {
      const match = /\/([A-Za-z]+)\.aspx/.exec(link);
      if (match === null) continue;
      const key = match[1]!;
      prefixes.set(key, (prefixes.get(key) ?? 0) + 1);
    }

    process.stdout.write(`\n  full: collected ${links.length.toString()} target URLs across ${prefixes.size.toString()} category prefixes\n`);
    const sorted = [...prefixes.entries()].sort(([, itemA], [, itemB]) => itemB - itemA);
    for (const [name, count] of sorted.slice(0, 10)) {
      process.stdout.write(`    ${name}: ${count.toString()}\n`);
    }
    if (sorted.length > 10) process.stdout.write(`    … (${(sorted.length - 10).toString()} more categories)\n`);

    try {
      assert.ok(links.length >= 100, `expected ≥100 target URLs across all categories, got ${links.length.toString()}`);
      assert.ok(prefixes.size >= 5, `expected URLs from ≥5 category prefixes (multi-seed traversal), got ${prefixes.size.toString()}`);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});

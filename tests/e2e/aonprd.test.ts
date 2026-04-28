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
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { LinkLister } from '../../src/crawlers/LinkLister.js';
import { validateRipperConfig, formatRipperConfigErrors } from '../../src/schemas/internal/RipperConfigSchema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface LegacyFixture {
  readonly crawlers: { readonly aonprd: {
    readonly startUrls: readonly string[];
    readonly domain: string;
    readonly target: string;
    readonly delimiter: string;
    readonly rateLimitMs: number;
    readonly jitterMs: number;
    readonly maxPages: number;
  }; };
}

async function loadFixture(): Promise<LegacyFixture> {
  const path = resolve(__dirname, 'fixtures/pathripper-legacy.config.json');
  const raw  = JSON.parse(await readFile(path, 'utf-8')) as unknown;
  if (!validateRipperConfig(raw)) {
    throw new Error(`Legacy fixture invalid:\n  ${formatRipperConfigErrors()}`);
  }
  return raw as unknown as LegacyFixture;
}

describe('PathRipper legacy AONPRD e2e (local only)', () => {
  it('smoke — crawl one category and collect at least 5 target URLs', async () => {
    const fx = await loadFixture();
    const c  = fx.crawlers.aonprd;
    const lister = new LinkLister({
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
    const fx = await loadFixture();
    const c  = fx.crawlers.aonprd;
    const lister = new LinkLister({
      domain:      new RegExp(c.domain),
      target:      new RegExp(c.target),
      delimiter:   new RegExp(c.delimiter),
      rateLimitMs: c.rateLimitMs,
      jitterMs:    c.jitterMs,
      maxPages:    c.maxPages,
    });
    const links = await lister.buildList(c.startUrls);
    process.stdout.write(`\n  full: collected ${links.length.toString()} target URLs across ${c.startUrls.length.toString()} category seeds\n`);
    for (const link of links.slice(0, 8)) process.stdout.write(`    • ${link}\n`);
    if (links.length > 8) process.stdout.write(`    … (${(links.length - 8).toString()} more)\n`);

    assert.ok(links.length >= 10, `expected ≥10 target URLs across all categories, got ${links.length.toString()}`);
  });
});

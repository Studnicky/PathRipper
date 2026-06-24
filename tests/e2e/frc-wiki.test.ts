// frc-wiki e2e — Forgotten Realms Wiki MediaWiki API.
// Exercises: MediaWikiScraper (wiki vertical) against a live Fandom wiki API.
//
// Run locally:
//   npm run test:e2e -- --test-name-pattern='frc-wiki'
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync }  from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MediaWikiScraper } from '../../src/scrapers/MediaWikiScraper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FRC_STATE = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures/frc/frc.state.json'), 'utf-8'),
) as { apiUrl: string; rateLimitMs: number; jitterMs: number };

// Confirmed present from API probe during test design.
const KNOWN_BEHOLDERS = ['Araunglauth', 'Beholder zombie', 'Beholder mage', 'Arglath'];

describe('frc-wiki e2e — Forgotten Realms Wiki API (local only)', () => {
  it('fetches Beholders category and finds known members', async () => {
    const scraper = await MediaWikiScraper.create({
      apiUrl:      FRC_STATE.apiUrl,
      rateLimitMs: FRC_STATE.rateLimitMs,
      jitterMs:    FRC_STATE.jitterMs,
    });

    const members = await scraper.fetchCategory('Beholders');
    assert.ok(members.length >= 4,
      `expected ≥4 Beholders, got ${members.length.toString()}`);

    process.stdout.write(`\n  frc-wiki: ${members.length.toString()} Beholders in category\n`);
    for (const member of members.slice(0, 5)) {
      process.stdout.write(`    • ${member.title}\n`);
    }

    for (const title of KNOWN_BEHOLDERS) {
      assert.ok(
        members.some((member) => member.title === title),
        `expected "${title}" in Beholders category`,
      );
    }
  });

  it('fetches wikitext for Beholder zombie and Beholder mage', async () => {
    const scraper = await MediaWikiScraper.create({
      apiUrl:      FRC_STATE.apiUrl,
      rateLimitMs: FRC_STATE.rateLimitMs,
    });

    const pages = await scraper.fetchPagesBatch(['Beholder zombie', 'Beholder mage']);
    assert.equal(pages.length, 2, 'expected 2 pages in batch response');

    process.stdout.write('\n');
    for (const page of pages) {
      const lcText = page.wikitext.toLowerCase();
      assert.ok(page.wikitext.length > 100,
        `"${page.title}": wikitext too short (${page.wikitext.length.toString()} chars)`);
      assert.ok(
        lcText.includes('beholder') || lcText.includes('eye tyrant') || lcText.includes('aberration'),
        `"${page.title}": wikitext missing expected D&D content`,
      );
      process.stdout.write(`    • ${page.title}: ${page.wikitext.length.toString()} chars\n`);
    }
  });

  it('fetches the main Beholder article by title', async () => {
    const scraper = await MediaWikiScraper.create({
      apiUrl:      FRC_STATE.apiUrl,
      rateLimitMs: FRC_STATE.rateLimitMs,
    });

    const page = await scraper.fetchPage('Beholder');
    assert.ok(page.wikitext.length > 500,
      `Beholder article too short: ${page.wikitext.length.toString()} chars`);
    assert.ok(
      page.wikitext.includes('Beholder') || page.wikitext.includes('eye tyrant'),
      'Beholder article missing expected content',
    );
    process.stdout.write(`  frc-wiki: "Beholder" article — ${page.wikitext.length.toString()} chars\n`);
  });
});

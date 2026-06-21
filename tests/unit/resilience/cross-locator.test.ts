/**
 * Unit tests for CrossLocatorStrategy (via LinkResolverRegistry).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { LinkResolverRegistry } from '../../../src/resilience/LinkResolve.js';
import type { RipperServices }  from '../../../src/services/RipperServices.js';

// ── Stub HtmlScraper ────────────────────────────────────────────────────────────

const GOOD_CATEGORY = 'Classes';

/**
 * Minimal stub implementing the `fetchPage` method surface used by CrossLocatorStrategy.
 * Throws for any category that is not `GOOD_CATEGORY`; resolves for `GOOD_CATEGORY`.
 */
class StubHtmlScraper {
  public async fetchPage(url: string): Promise<{ url: string; html: string; $: unknown }> {
    if (url.includes(`/${GOOD_CATEGORY}.aspx`)) {
      return { url, html: '<html></html>', $: {} };
    }
    throw new Error(`fetch failed for ${url}`);
  }
}

/** Build a minimal RipperServices stub for CrossLocatorStrategy tests. */
const makeServices = (categorySet: readonly string[]): RipperServices =>
  ({
    log: {
      debug: () => {},
      info:  () => {},
      warn:  () => {},
      error: () => {},
    },
    cache:       null,
    target:      { id: 'test' },
    outDir:      '/tmp',
    dispatcher:  {} as RipperServices['dispatcher'],
    htmlScraper: new StubHtmlScraper() as unknown as RipperServices['htmlScraper'],
    resolve: {
      strategies:  ['crossLocator'],
      categorySet,
    },
  }) as unknown as RipperServices;

// ── Tests ──────────────────────────────────────────────────────────────────────

const strategy = LinkResolverRegistry.get('crossLocator');
assert.ok(strategy !== undefined, 'crossLocator strategy must exist in registry');

describe('CrossLocatorStrategy', () => {
  it('returns sibling category url when fetchPage resolves for a sibling', async () => {
    const services  = makeServices(['Ancestries', 'Classes', 'NPCs']);
    const failedUrl = 'https://aonprd.com/Monsters.aspx?ID=77';

    const result = await strategy.resolve(failedUrl, services);

    assert.equal(result, 'https://aonprd.com/Classes.aspx?ID=77');
  });

  it('returns null when all candidate categories fail', async () => {
    const services  = makeServices(['Ancestries', 'NPCs']);
    const failedUrl = 'https://aonprd.com/Monsters.aspx?ID=77';

    const result = await strategy.resolve(failedUrl, services);

    assert.equal(result, null);
  });

  it('returns null when the url does not match the <Category>.aspx?ID=<n> pattern', async () => {
    const services  = makeServices(['Ancestries', 'Classes', 'NPCs']);
    const failedUrl = 'https://aonprd.com/search?q=goblin';

    const result = await strategy.resolve(failedUrl, services);

    assert.equal(result, null);
  });
});

/**
 * Unit tests for ResolveLinkNode.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Batch }              from '@studnicky/dagonizer';
import { NodeContextBuilder } from '@studnicky/dagonizer/entities';

import { ScrapeState }      from '../../../src/state/ScrapeState.js';
import { ResolveLinkNode }  from '../../../src/nodes/ResolveLinkNode.js';
import { LAST_FAILURE_KEY } from '../../../src/resilience/FailurePolicy.js';
import type { FailureContextType } from '../../../src/resilience/FailurePolicy.js';
import type { RipperServices }     from '../../../src/services/RipperServices.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const FAILED_URL    = 'https://aonprd.com/Monsters.aspx?ID=77';
const CORRECTED_URL = 'https://aonprd.com/Classes.aspx?ID=77';

const GOOD_CATEGORY = 'Classes';

/**
 * Minimal stub: resolves for `GOOD_CATEGORY`, throws for all others.
 */
class StubHtmlScraper {
  public async fetchPage(url: string): Promise<{ url: string; html: string; $: unknown }> {
    if (url.includes(`/${GOOD_CATEGORY}.aspx`)) {
      return { url, html: '<html></html>', $: {} };
    }
    throw new Error(`fetch failed for ${url}`);
  }
}

/** Build a minimal NodeContext for ResolveLinkNode tests. */
const makeContext = (overrides: Partial<RipperServices> = {}) =>
  NodeContextBuilder.of<RipperServices>(
    'test',
    'test',
    new AbortController().signal,
    {
      log: {
        debug: () => {},
        info:  () => {},
        warn:  () => {},
        error: () => {},
      } as unknown as RipperServices['log'],
      cache:      null,
      target:     { id: 'test' },
      outDir:     '/tmp',
      dispatcher: {} as RipperServices['dispatcher'],
      ...overrides,
    } as unknown as RipperServices,
  );

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ResolveLinkNode — happy path', () => {
  it('routes resolved and stashes corrected url in metadata', async () => {
    const state = new ScrapeState();
    state.page  = { targetId: 'test', title: '', url: FAILED_URL };

    const failure: FailureContextType = {
      url:       FAILED_URL,
      status:    404,
      retryable: false,
      attempt:   1,
      phase:     'fetch',
      linkText:  undefined,
    };
    state.setMetadata(LAST_FAILURE_KEY, failure);

    const context = makeContext({
      htmlScraper: new StubHtmlScraper() as unknown as RipperServices['htmlScraper'],
      resolve: {
        strategies:  ['crossLocator'],
        categorySet: ['Ancestries', 'Classes', 'NPCs'],
      },
    });

    const result = await ResolveLinkNode.execute(Batch.of(state), context);

    assert.ok(result.has('resolved'), `expected 'resolved', got ${[...result.keys()].join(', ')}`);
    assert.equal(state.getMetadata<string>('currentUrl'), CORRECTED_URL);
  });
});

describe('ResolveLinkNode — no strategies', () => {
  it('routes unresolved when strategies array is empty', async () => {
    const state = new ScrapeState();
    state.page  = { targetId: 'test', title: '', url: FAILED_URL };

    const context = makeContext({
      resolve: { strategies: [] },
    });

    const result = await ResolveLinkNode.execute(Batch.of(state), context);

    assert.ok(result.has('unresolved'));
  });
});

describe('ResolveLinkNode — budget exhaustion', () => {
  it('routes unresolved after resolve budget (budget=1) is exceeded on 2nd call', async () => {
    // Call 1: succeeds (attempt=1 <= budget=1) → resolved.
    const state1 = new ScrapeState();
    state1.page  = { targetId: 'test', title: '', url: FAILED_URL };

    const failure: FailureContextType = {
      url:       FAILED_URL,
      status:    404,
      retryable: false,
      attempt:   1,
      phase:     'fetch',
      linkText:  undefined,
    };
    state1.setMetadata(LAST_FAILURE_KEY, failure);

    const context = makeContext({
      htmlScraper: new StubHtmlScraper() as unknown as RipperServices['htmlScraper'],
      resolve: {
        strategies:  ['crossLocator'],
        categorySet: ['Ancestries', 'Classes', 'NPCs'],
        budget:      1,
      },
    });

    const result1 = await ResolveLinkNode.execute(Batch.of(state1), context);
    assert.ok(result1.has('resolved'), 'first call within budget should resolve');

    // Call 2 on the same state: attempt becomes 2 > budget=1 → unresolved.
    state1.setMetadata(LAST_FAILURE_KEY, failure);
    const result2 = await ResolveLinkNode.execute(Batch.of(state1), context);
    assert.ok(result2.has('unresolved'), 'second call over budget should be unresolved');
  });
});

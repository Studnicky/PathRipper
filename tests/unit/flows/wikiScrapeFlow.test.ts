// Unit tests for src/flows/wikiScrapeFlow.ts
//
// Verifies topology of wiki phase flows and the resolve-members flow.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  wikiScrapePhaseFlow, WIKI_SCRAPE_PHASE_FLOW,
  wikiRetryPhaseFlow,  WIKI_RETRY_PHASE_FLOW,
  wikiResolveMembersFlow, WIKI_RESOLVE_MEMBERS_FLOW,
  wikiScrapeFlow,
} from '../../../src/flows/wikiScrapeFlow.js';

describe('wikiScrapePhaseFlow', () => {
  it('has correct name and entrypoint', () => {
    assert.equal(wikiScrapePhaseFlow.name,      WIKI_SCRAPE_PHASE_FLOW);
    assert.equal(wikiScrapePhaseFlow.entrypoint, 'scrape-titles');
  });

  it('produces a non-empty node list', () => {
    assert.ok(wikiScrapePhaseFlow.nodes.length > 0);
  });
});

describe('wikiRetryPhaseFlow', () => {
  it('has correct name and entrypoint', () => {
    assert.equal(wikiRetryPhaseFlow.name,      WIKI_RETRY_PHASE_FLOW);
    assert.equal(wikiRetryPhaseFlow.entrypoint, 'retry-titles');
  });

  it('produces a non-empty node list', () => {
    assert.ok(wikiRetryPhaseFlow.nodes.length > 0);
  });
});

describe('wikiResolveMembersFlow', () => {
  it('has correct name and entrypoint', () => {
    assert.equal(wikiResolveMembersFlow.name,      WIKI_RESOLVE_MEMBERS_FLOW);
    assert.equal(wikiResolveMembersFlow.name,      'wikiResolveMembersDAG');
    assert.equal(wikiResolveMembersFlow.entrypoint, 'wiki:choose-mode');
  });

  it('has version 2.0', () => {
    assert.equal(wikiResolveMembersFlow.version, '2.0');
  });

  it('produces a non-empty node list', () => {
    assert.ok(wikiResolveMembersFlow.nodes.length > 0);
  });
});

describe('wikiScrapeFlow (outer)', () => {
  it('has name wikiScrapeDAG', () => {
    assert.equal(wikiScrapeFlow.name, 'wikiScrapeDAG');
  });

  it('has non-empty nodes', () => {
    assert.ok(wikiScrapeFlow.nodes.length > 0);
  });
});

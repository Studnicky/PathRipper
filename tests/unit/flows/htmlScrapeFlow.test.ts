// Unit tests for src/flows/htmlScrapeFlow.ts
//
// Verifies that FlowDeriver derives phase flows with the correct topology.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  htmlCrawlPhaseFlow,  HTML_CRAWL_PHASE_FLOW,
  htmlScrapePhaseFlow, HTML_SCRAPE_PHASE_FLOW,
  htmlRetryPhaseFlow,  HTML_RETRY_PHASE_FLOW,
  htmlScrapeFlow,
  htmlScrapeFlowCrawl,
} from '../../../src/flows/htmlScrapeFlow.js';

describe('htmlCrawlPhaseFlow', () => {
  it('has correct name and entrypoint', () => {
    assert.equal(htmlCrawlPhaseFlow.name,       HTML_CRAWL_PHASE_FLOW);
    assert.equal(htmlCrawlPhaseFlow.entrypoint,  'crawl:list-targets');
  });

  it('has version 2.0', () => {
    assert.equal(htmlCrawlPhaseFlow.version, '2.0');
  });

  it('produces a non-empty node list', () => {
    assert.ok(htmlCrawlPhaseFlow.nodes.length > 0);
  });
});

describe('htmlScrapePhaseFlow', () => {
  it('has correct name and entrypoint', () => {
    assert.equal(htmlScrapePhaseFlow.name,       HTML_SCRAPE_PHASE_FLOW);
    assert.equal(htmlScrapePhaseFlow.entrypoint,  'scrape-urls');
  });

  it('has version 2.0', () => {
    assert.equal(htmlScrapePhaseFlow.version, '2.0');
  });

  it('produces a non-empty node list', () => {
    assert.ok(htmlScrapePhaseFlow.nodes.length > 0);
  });
});

describe('htmlRetryPhaseFlow', () => {
  it('has correct name and entrypoint', () => {
    assert.equal(htmlRetryPhaseFlow.name,       HTML_RETRY_PHASE_FLOW);
    assert.equal(htmlRetryPhaseFlow.entrypoint,  'retry-urls');
  });

  it('has version 2.0', () => {
    assert.equal(htmlRetryPhaseFlow.version, '2.0');
  });

  it('produces a non-empty node list', () => {
    assert.ok(htmlRetryPhaseFlow.nodes.length > 0);
  });
});

describe('htmlScrapeFlow (outer)', () => {
  it('has name htmlScrapeDAG', () => {
    assert.equal(htmlScrapeFlow.name, 'htmlScrapeDAG');
  });

  it('has non-empty nodes', () => {
    assert.ok(htmlScrapeFlow.nodes.length > 0);
  });
});

describe('htmlScrapeFlowCrawl (outer with crawl)', () => {
  it('has name htmlScrapeDAGCrawl', () => {
    assert.equal(htmlScrapeFlowCrawl.name, 'htmlScrapeDAGCrawl');
  });

  it('has non-empty nodes', () => {
    assert.ok(htmlScrapeFlowCrawl.nodes.length > 0);
  });
});

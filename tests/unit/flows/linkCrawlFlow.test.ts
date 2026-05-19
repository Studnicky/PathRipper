// Unit tests for src/flows/linkCrawlFlow.ts
//
// Verifies the trampolined recursive link crawler flow.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLinkCrawlFlow,
  LINK_CRAWL_FLOW_NAME,
  LINK_CRAWL_LEVEL_DAG_NAME,
} from '../../../src/flows/linkCrawlFlow.js';

describe('buildLinkCrawlFlow', () => {
  it('produces outer and level DAGs', () => {
    const { linkCrawlDAG, linkCrawlLevelDAG } = buildLinkCrawlFlow();
    assert.equal(linkCrawlDAG.name,      LINK_CRAWL_FLOW_NAME);
    assert.equal(linkCrawlLevelDAG.name, LINK_CRAWL_LEVEL_DAG_NAME);
    assert.equal(linkCrawlDAG.name,      'linkCrawlDAG');
    assert.equal(linkCrawlLevelDAG.name, 'linkCrawlLevelDAG');
  });

  it('outer DAG has entrypoint crawl:init-frontier', () => {
    const { linkCrawlDAG } = buildLinkCrawlFlow();
    assert.equal(linkCrawlDAG.entrypoint, 'crawl:init-frontier');
  });

  it('level DAG has entrypoint crawl:fetch-and-extract', () => {
    const { linkCrawlLevelDAG } = buildLinkCrawlFlow();
    assert.equal(linkCrawlLevelDAG.entrypoint, 'crawl:fetch-and-extract');
  });

  it('outer DAG has non-empty node list', () => {
    const { linkCrawlDAG } = buildLinkCrawlFlow();
    assert.ok(linkCrawlDAG.nodes.length > 0);
  });

  it('level DAG has non-empty node list', () => {
    const { linkCrawlLevelDAG } = buildLinkCrawlFlow();
    assert.ok(linkCrawlLevelDAG.nodes.length > 0);
  });

  it('outer DAG version is 2.0', () => {
    const { linkCrawlDAG } = buildLinkCrawlFlow();
    assert.equal(linkCrawlDAG.version, '2.0');
  });

  it('level DAG version is 2.0', () => {
    const { linkCrawlLevelDAG } = buildLinkCrawlFlow();
    assert.equal(linkCrawlLevelDAG.version, '2.0');
  });
});

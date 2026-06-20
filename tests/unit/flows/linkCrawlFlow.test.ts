// Unit tests for src/flows/linkCrawlFlow.ts
//
// Verifies the native cyclic-DAG link crawler flow.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLinkCrawlFlow,
  LINK_CRAWL_FLOW_NAME,
} from '../../../src/flows/linkCrawlFlow.js';

/**
 * Returns the `outputs` map for a named placement, or `undefined` if the
 * placement does not exist or has no `outputs` field (terminal nodes).
 */
const outputsOf = (dag: ReturnType<typeof buildLinkCrawlFlow>, placementName: string): Record<string, string> | undefined => {
  const entry = dag.nodes.find((node) => node.name === placementName);
  if (entry === undefined) return undefined;
  if (!('outputs' in entry)) return undefined;
  return entry.outputs as Record<string, string>;
};

describe('buildLinkCrawlFlow', () => {
  it('returns a DAGType directly (not wrapped in an object)', () => {
    const dag = buildLinkCrawlFlow();
    assert.equal(typeof dag, 'object');
    assert.ok(dag !== null);
    assert.ok('name' in dag);
    assert.ok('nodes' in dag);
  });

  it('DAG name matches LINK_CRAWL_FLOW_NAME constant', () => {
    const dag = buildLinkCrawlFlow();
    assert.equal(dag.name, LINK_CRAWL_FLOW_NAME);
    assert.equal(dag.name, 'linkCrawlDAG');
  });

  it('entrypoint is crawl:init-frontier', () => {
    const dag = buildLinkCrawlFlow();
    assert.equal(dag.entrypoint, 'crawl:init-frontier');
  });

  it('version is 2.0', () => {
    const dag = buildLinkCrawlFlow();
    assert.equal(dag.version, '2.0');
  });

  it('has exactly 5 placements: init + fetch + dedupe + exhausted + completed terminal', () => {
    const dag = buildLinkCrawlFlow();
    assert.equal(dag.nodes.length, 5);
  });

  it('crawl:init-frontier ready routes to crawl:fetch-and-extract', () => {
    const dag = buildLinkCrawlFlow();
    const outputs = outputsOf(dag, 'crawl:init-frontier');
    assert.ok(outputs !== undefined, 'crawl:init-frontier must exist');
    assert.equal(outputs['ready'], 'crawl:fetch-and-extract');
  });

  it('crawl:init-frontier empty routes to crawl:exhausted (skip crawl)', () => {
    const dag = buildLinkCrawlFlow();
    const outputs = outputsOf(dag, 'crawl:init-frontier');
    assert.ok(outputs !== undefined);
    assert.equal(outputs['empty'], 'crawl:exhausted');
  });

  it('all four crawl:fetch-and-extract output ports route to crawl:dedupe-and-enqueue', () => {
    const dag = buildLinkCrawlFlow();
    const outputs = outputsOf(dag, 'crawl:fetch-and-extract');
    assert.ok(outputs !== undefined, 'crawl:fetch-and-extract must exist');
    for (const port of ['success', 'empty', 'error', 'permanent']) {
      assert.equal(
        outputs[port],
        'crawl:dedupe-and-enqueue',
        `port "${port}" must route to crawl:dedupe-and-enqueue`,
      );
    }
  });

  it('crawl:dedupe-and-enqueue frontier-ready routes back to crawl:fetch-and-extract (back-edge)', () => {
    const dag = buildLinkCrawlFlow();
    const outputs = outputsOf(dag, 'crawl:dedupe-and-enqueue');
    assert.ok(outputs !== undefined, 'crawl:dedupe-and-enqueue must exist');
    assert.equal(
      outputs['frontier-ready'],
      'crawl:fetch-and-extract',
      'frontier-ready must route back to crawl:fetch-and-extract (the cyclic back-edge)',
    );
  });

  it('crawl:dedupe-and-enqueue frontier-empty routes to crawl:exhausted (loop exit)', () => {
    const dag = buildLinkCrawlFlow();
    const outputs = outputsOf(dag, 'crawl:dedupe-and-enqueue');
    assert.ok(outputs !== undefined);
    assert.equal(outputs['frontier-empty'], 'crawl:exhausted');
  });

  it('crawl:dedupe-and-enqueue budget-exhausted routes to crawl:exhausted (loop exit)', () => {
    const dag = buildLinkCrawlFlow();
    const outputs = outputsOf(dag, 'crawl:dedupe-and-enqueue');
    assert.ok(outputs !== undefined);
    assert.equal(outputs['budget-exhausted'], 'crawl:exhausted');
  });

  it('crawl:exhausted routes success to crawl:completed', () => {
    const dag = buildLinkCrawlFlow();
    const outputs = outputsOf(dag, 'crawl:exhausted');
    assert.ok(outputs !== undefined, 'crawl:exhausted must exist');
    assert.equal(outputs['success'], 'crawl:completed');
  });

  it('crawl:completed is a terminal placement (no outputs field)', () => {
    const dag = buildLinkCrawlFlow();
    const completedEntry = dag.nodes.find((node) => node.name === 'crawl:completed');
    assert.ok(completedEntry !== undefined, 'crawl:completed must exist');
    // TerminalNode placements have no outputs — the presence of the entry is sufficient.
    assert.ok(!('outputs' in completedEntry), 'crawl:completed must be a terminal with no outputs');
  });

  it('no crawl:recurse placement exists in the cyclic DAG', () => {
    const dag = buildLinkCrawlFlow();
    const recurseEntry = dag.nodes.find((node) => node.name === 'crawl:recurse');
    assert.equal(recurseEntry, undefined, 'crawl:recurse must not exist — the loop is a back-edge, not a recurse node');
  });
});

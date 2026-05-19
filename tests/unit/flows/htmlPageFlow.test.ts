// Unit tests for src/flows/htmlPageFlow.ts

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHtmlPageFlow,
  htmlPageFlowName,
} from '../../../src/flows/htmlPageFlow.js';

describe('buildHtmlPageFlow', () => {
  it('produces a DAG with the correct name', () => {
    const flow = buildHtmlPageFlow(['html:fetch', 'aonprd:parse', 'json:write'], 'aonprd');
    assert.equal(flow.name, htmlPageFlowName('aonprd'));
    assert.equal(flow.name, 'htmlPageDAG:aonprd');
  });

  it('has entrypoint html:fetch', () => {
    const flow = buildHtmlPageFlow(['html:fetch', 'json:write'], 'test');
    assert.equal(flow.entrypoint, 'html:fetch');
  });

  it('filters out crawl:list-targets', () => {
    const flow = buildHtmlPageFlow(['crawl:list-targets', 'html:fetch', 'json:write'], 'test');
    assert.equal(flow.entrypoint, 'html:fetch');
  });

  it('throws when no steps remain after filtering', () => {
    assert.throws(
      () => buildHtmlPageFlow(['crawl:list-targets'], 'test'),
      /no steps after filtering/,
    );
  });

  it('produces a non-empty node list', () => {
    const flow = buildHtmlPageFlow(['html:fetch', 'json:write'], 'test');
    assert.ok(flow.nodes.length > 0);
  });
});

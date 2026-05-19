import { describe, it, mock, before } from 'node:test';
import assert from 'node:assert/strict';

import { CliState }  from '../../../../src/state/CliState.js';
import { Logger }    from '../../../../src/modules/logger/logger.js';
import type { NormalizedRipperConfigInterface } from '../../../../src/types/Config.js';

const makeContext = () => ({
  signal:   new AbortController().signal,
  dagName:  'cliScrapeDAG',
  nodeName: 'cli:dispatch-wiki-scrape',
  services: { log: Logger.forComponent('DispatchWikiScrapeNode.test') },
});

const MOCK_CONFIG: NormalizedRipperConfigInterface = {
  output: { basePath: './output', format: 'json', pretty: true },
  mediawiki: {
    mywiki: {
      apiUrl:   'https://wiki.example.com/api.php',
      pipeline: ['wiki:fetch', 'json:write'],
      cache:    { dir: './output/.cache/mywiki', mode: 'read-write' },
    },
  },
};

// Module-level mock: set up once, control per-test via implementation.
const runWikiMock = mock.fn(async () => undefined);

before(() => {
  mock.module('../../../../src/run/runWiki.js', {
    namedExports: { runWiki: runWikiMock },
  });
});

describe('DispatchWikiScrapeNode', () => {
  it('returns error when config is null', async () => {
    const { DispatchWikiScrapeNode } = await import('../../../../src/nodes/cli/DispatchWikiScrapeNode.js');
    const state = new CliState();
    state.config = null;

    const result = await DispatchWikiScrapeNode.execute(state, makeContext());

    assert.equal(result.output, 'error');
    assert.ok(state.errorMessage.length > 0);
  });

  it('returns error when target not found in config.mediawiki', async () => {
    const { DispatchWikiScrapeNode } = await import('../../../../src/nodes/cli/DispatchWikiScrapeNode.js');
    const state = new CliState();
    state.config   = MOCK_CONFIG;
    state.targetId = 'unknown';

    const result = await DispatchWikiScrapeNode.execute(state, makeContext());

    assert.equal(result.output, 'error');
    assert.ok(state.errorMessage.length > 0);
  });

  it('returns success when run completes without error', async () => {
    runWikiMock.mock.resetCalls();
    runWikiMock.mock.mockImplementation(async () => undefined);

    const { DispatchWikiScrapeNode } = await import('../../../../src/nodes/cli/DispatchWikiScrapeNode.js');

    const state = new CliState();
    state.config     = MOCK_CONFIG;
    state.targetId   = 'mywiki';
    state.options    = {};
    state.configPath = '/some/config.json';
    state.outDir     = '/tmp/test-out';

    const result = await DispatchWikiScrapeNode.execute(state, makeContext());

    assert.equal(result.output, 'success');
    assert.equal(state.failedCount, 0);
    assert.equal(state.errorMessage, '');
    assert.equal(runWikiMock.mock.calls.length, 1);
  });

  it('passes category and resumeFailures from state.options', async () => {
    let capturedOpts: unknown;
    runWikiMock.mock.resetCalls();
    runWikiMock.mock.mockImplementation(async (opts: unknown) => { capturedOpts = opts; });

    const { DispatchWikiScrapeNode } = await import('../../../../src/nodes/cli/DispatchWikiScrapeNode.js');

    const state = new CliState();
    state.config     = MOCK_CONFIG;
    state.targetId   = 'mywiki';
    state.options    = { category: 'Monsters', resumeFailures: true };
    state.configPath = '/some/config.json';
    state.outDir     = '/tmp/test-out';

    await DispatchWikiScrapeNode.execute(state, makeContext());

    const opts = capturedOpts as Record<string, unknown>;
    assert.equal(opts['category'], 'Monsters');
    assert.equal(opts['resumeFailures'], true);
  });

  it('returns error when run throws', async () => {
    runWikiMock.mock.resetCalls();
    runWikiMock.mock.mockImplementation(async () => { throw new Error('api unreachable'); });

    const { DispatchWikiScrapeNode } = await import('../../../../src/nodes/cli/DispatchWikiScrapeNode.js');

    const state = new CliState();
    state.config     = MOCK_CONFIG;
    state.targetId   = 'mywiki';
    state.options    = {};
    state.configPath = '/some/config.json';
    state.outDir     = '/tmp/test-out';

    const result = await DispatchWikiScrapeNode.execute(state, makeContext());

    assert.equal(result.output, 'error');
    assert.ok(state.errorMessage.includes('api unreachable'));
  });
});

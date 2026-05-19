import { describe, it, mock, before } from 'node:test';
import assert from 'node:assert/strict';

import { CliState }  from '../../../../src/state/CliState.js';
import { Logger }    from '../../../../src/modules/logger/logger.js';
import type { NormalizedRipperConfigInterface } from '../../../../src/types/Config.js';

const makeContext = () => ({
  signal:   new AbortController().signal,
  dagName:  'cliScrapeDAG',
  nodeName: 'cli:dispatch-html-scrape',
  services: { log: Logger.forComponent('DispatchHtmlScrapeNode.test') },
});

const MOCK_CONFIG: NormalizedRipperConfigInterface = {
  output: { basePath: './output', format: 'json', pretty: true },
  targets: {
    mysite: {
      baseUrl:  'https://example.com',
      pipeline: ['html:fetch', 'json:write'],
      cache:    { dir: './output/.cache/mysite', mode: 'read-write' },
    },
    crawlsite: {
      baseUrl:  'https://example.com',
      pipeline: ['crawl:list-targets', 'html:fetch', 'json:write'],
      cache:    { dir: './output/.cache/crawlsite', mode: 'read-write' },
    },
  },
};

// Module-level mock: set up once, control per-test via implementation.
const runHtmlMock = mock.fn(async () => undefined);

before(() => {
  mock.module('../../../../src/run/runHtml.js', {
    namedExports: { runHtml: runHtmlMock },
  });
});

describe('DispatchHtmlScrapeNode', () => {
  it('returns error when config is null', async () => {
    const { DispatchHtmlScrapeNode } = await import('../../../../src/nodes/cli/DispatchHtmlScrapeNode.js');
    const state = new CliState();
    state.config = null;

    const result = await DispatchHtmlScrapeNode.execute(state, makeContext());

    assert.equal(result.output, 'error');
    assert.ok(state.errorMessage.length > 0);
  });

  it('returns error when target not found in config.targets', async () => {
    const { DispatchHtmlScrapeNode } = await import('../../../../src/nodes/cli/DispatchHtmlScrapeNode.js');
    const state = new CliState();
    state.config   = MOCK_CONFIG;
    state.targetId = 'unknown';
    state.options  = { paths: ['/page1'] };

    const result = await DispatchHtmlScrapeNode.execute(state, makeContext());

    assert.equal(result.output, 'error');
    assert.ok(state.errorMessage.length > 0);
  });

  it('returns error when paths empty and no crawl:list-targets in pipeline', async () => {
    const { DispatchHtmlScrapeNode } = await import('../../../../src/nodes/cli/DispatchHtmlScrapeNode.js');
    const state = new CliState();
    state.config   = MOCK_CONFIG;
    state.targetId = 'mysite';
    state.options  = { paths: [] };

    const result = await DispatchHtmlScrapeNode.execute(state, makeContext());

    assert.equal(result.output, 'error');
    assert.ok(state.errorMessage.includes('--paths required'));
  });

  it('accepts empty paths when pipeline has crawl:list-targets', async () => {
    runHtmlMock.mock.resetCalls();
    runHtmlMock.mock.mockImplementation(async () => undefined);

    const { DispatchHtmlScrapeNode } = await import('../../../../src/nodes/cli/DispatchHtmlScrapeNode.js');

    const state = new CliState();
    state.config     = MOCK_CONFIG;
    state.targetId   = 'crawlsite';
    state.options    = { paths: [] };
    state.configPath = '/some/config.json';
    state.outDir     = '/tmp/test-out';

    const result = await DispatchHtmlScrapeNode.execute(state, makeContext());

    assert.equal(result.output, 'success');
    assert.equal(runHtmlMock.mock.calls.length, 1);
    assert.equal(state.failedCount, 0);
  });

  it('returns success when run completes without error', async () => {
    runHtmlMock.mock.resetCalls();
    runHtmlMock.mock.mockImplementation(async () => undefined);

    const { DispatchHtmlScrapeNode } = await import('../../../../src/nodes/cli/DispatchHtmlScrapeNode.js');

    const state = new CliState();
    state.config     = MOCK_CONFIG;
    state.targetId   = 'mysite';
    state.options    = { paths: ['/page1'] };
    state.configPath = '/some/config.json';
    state.outDir     = '/tmp/test-out';

    const result = await DispatchHtmlScrapeNode.execute(state, makeContext());

    assert.equal(result.output, 'success');
    assert.equal(state.failedCount, 0);
    assert.equal(state.errorMessage, '');
  });

  it('returns error when run throws', async () => {
    runHtmlMock.mock.resetCalls();
    runHtmlMock.mock.mockImplementation(async () => { throw new Error('network failure'); });

    const { DispatchHtmlScrapeNode } = await import('../../../../src/nodes/cli/DispatchHtmlScrapeNode.js');

    const state = new CliState();
    state.config     = MOCK_CONFIG;
    state.targetId   = 'mysite';
    state.options    = { paths: ['/page1'] };
    state.configPath = '/some/config.json';
    state.outDir     = '/tmp/test-out';

    const result = await DispatchHtmlScrapeNode.execute(state, makeContext());

    assert.equal(result.output, 'error');
    assert.ok(state.errorMessage.includes('network failure'));
  });
});

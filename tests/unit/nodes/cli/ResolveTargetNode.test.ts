import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ResolveTargetNode } from '../../../../src/nodes/cli/ResolveTargetNode.js';
import { CliState }          from '../../../../src/state/CliState.js';
import { Logger }            from '../../../../src/modules/logger/logger.js';
import type { NormalizedRipperConfigInterface } from '../../../../src/types/Config.js';

const makeContext = () => ({
  signal:   new AbortController().signal,
  dagName:  'cliScrapeDAG',
  nodeName: 'cli:resolve-target',
  services: { log: Logger.forComponent('ResolveTargetNode.test') },
});

const MOCK_CONFIG: NormalizedRipperConfigInterface = {
  output: { basePath: './output', format: 'json', pretty: true },
  targets: {
    htmlsite: {
      baseUrl:  'https://html.example.com',
      pipeline: ['html:fetch', 'json:write'],
      cache:    { dir: './output/.cache/htmlsite', mode: 'read-write' },
    },
  },
  mediawiki: {
    mywiki: {
      apiUrl:   'https://wiki.example.com/api.php',
      pipeline: ['wiki:fetch', 'json:write'],
      cache:    { dir: './output/.cache/mywiki', mode: 'read-write' },
    },
  },
};

describe('ResolveTargetNode', () => {
  it('returns html and sets targetKind=html for a target in config.targets', async () => {
    const state = new CliState();
    state.command  = 'scrape';
    state.config   = MOCK_CONFIG;
    state.targetId = 'htmlsite';

    const result = await ResolveTargetNode.execute(state, makeContext());

    assert.equal(result.output, 'html');
    assert.equal(state.targetKind, 'html');
    assert.equal(state.errorMessage, '');
  });

  it('returns wiki and sets targetKind=wiki for a target in config.mediawiki', async () => {
    const state = new CliState();
    state.command  = 'scrape';
    state.config   = MOCK_CONFIG;
    state.targetId = 'mywiki';

    const result = await ResolveTargetNode.execute(state, makeContext());

    assert.equal(result.output, 'wiki');
    assert.equal(state.targetKind, 'wiki');
    assert.equal(state.errorMessage, '');
  });

  it('returns not-found and sets errorMessage for an unknown target', async () => {
    const state = new CliState();
    state.command  = 'scrape';
    state.config   = MOCK_CONFIG;
    state.targetId = 'unknown';

    const result = await ResolveTargetNode.execute(state, makeContext());

    assert.equal(result.output, 'not-found');
    assert.ok(state.errorMessage.length > 0);
  });

  it('returns not-found when config is null', async () => {
    const state = new CliState();
    state.command  = 'scrape';
    state.config   = null;
    state.targetId = 'anything';

    const result = await ResolveTargetNode.execute(state, makeContext());

    assert.equal(result.output, 'not-found');
    assert.ok(state.errorMessage.length > 0);
  });

  it('scrape-html command: rejects wiki-only target with not-found', async () => {
    const state = new CliState();
    state.command  = 'scrape-html';
    state.config   = MOCK_CONFIG;
    state.targetId = 'mywiki';

    const result = await ResolveTargetNode.execute(state, makeContext());

    assert.equal(result.output, 'not-found');
    assert.ok(state.errorMessage.length > 0);
  });

  it('scrape-html command: accepts html target with html output', async () => {
    const state = new CliState();
    state.command  = 'scrape-html';
    state.config   = MOCK_CONFIG;
    state.targetId = 'htmlsite';

    const result = await ResolveTargetNode.execute(state, makeContext());

    assert.equal(result.output, 'html');
    assert.equal(state.targetKind, 'html');
  });

  it('scrape-wiki command: rejects html-only target with not-found', async () => {
    const state = new CliState();
    state.command  = 'scrape-wiki';
    state.config   = MOCK_CONFIG;
    state.targetId = 'htmlsite';

    const result = await ResolveTargetNode.execute(state, makeContext());

    assert.equal(result.output, 'not-found');
    assert.ok(state.errorMessage.length > 0);
  });

  it('scrape-wiki command: accepts wiki target with wiki output', async () => {
    const state = new CliState();
    state.command  = 'scrape-wiki';
    state.config   = MOCK_CONFIG;
    state.targetId = 'mywiki';

    const result = await ResolveTargetNode.execute(state, makeContext());

    assert.equal(result.output, 'wiki');
    assert.equal(state.targetKind, 'wiki');
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { NormalizeCacheNode, RAW_CACHE_OFF_ERROR } from '../../../../src/nodes/config/NormalizeCacheNode.js';
import { ConfigLoadState } from '../../../../src/state/ConfigLoadState.js';
import type { RipperConfigInterface } from '../../../../src/types/Config.js';

const makeContext = () => ({
  signal:   new AbortController().signal,
  dagName:  'configLoadDAG',
  nodeName: 'normalize-cache',
  services: undefined,
});

function makeValidated(partial: Partial<RipperConfigInterface>): RipperConfigInterface {
  return {
    output: { basePath: './out' },
    ...partial,
  } as RipperConfigInterface;
}

describe('NormalizeCacheNode', () => {
  it('returns invariant-violated when state.validated is null', async () => {
    const state = new ConfigLoadState();
    // state.validated is null by default

    const result = await NormalizeCacheNode.execute(state, makeContext());

    assert.equal(result.output, 'invariant-violated');
    assert.equal(state.errors.length, 1);
  });

  it('returns success and populates state.normalized for a minimal config', async () => {
    const state = new ConfigLoadState();
    state.validated = makeValidated({});

    const result = await NormalizeCacheNode.execute(state, makeContext());

    assert.equal(result.output, 'success');
    assert.ok(state.normalized !== null);
    assert.equal(state.errors.length, 0);
  });

  it('applies default cache (dir and read-write mode) when targets omit cache', async () => {
    const state = new ConfigLoadState();
    state.validated = makeValidated({
      targets: {
        mywiki: {
          baseUrl:  'https://example.com',
          pipeline: ['html:fetch', 'json:write'],
        } as RipperConfigInterface['targets'] extends Record<string, infer T> ? T : never,
      },
    });

    await NormalizeCacheNode.execute(state, makeContext());

    const cache = state.normalized?.targets?.['mywiki']?.cache;
    assert.equal(cache?.dir, 'output/.cache/mywiki');
    assert.equal(cache?.mode, 'read-write');
  });

  it('retains explicit cache values when provided', async () => {
    const state = new ConfigLoadState();
    state.validated = makeValidated({
      targets: {
        mywiki: {
          baseUrl:  'https://example.com',
          pipeline: ['html:fetch', 'json:write'],
          cache:    { dir: 'custom/dir', mode: 'read-only' },
        } as RipperConfigInterface['targets'] extends Record<string, infer T> ? T : never,
      },
    });

    await NormalizeCacheNode.execute(state, makeContext());

    const cache = state.normalized?.targets?.['mywiki']?.cache;
    assert.equal(cache?.dir, 'custom/dir');
    assert.equal(cache?.mode, 'read-only');
  });

  it('returns invariant-violated with RAW_CACHE_OFF_ERROR when raw+cache-off on a target', async () => {
    const state = new ConfigLoadState();
    state.validated = makeValidated({
      targets: {
        mywiki: {
          baseUrl:  'https://example.com',
          pipeline: ['html:fetch', 'json:write'],
          cache:    { dir: '.cache', mode: 'off' },
          // includeRawContent absent → defaults to true
        } as RipperConfigInterface['targets'] extends Record<string, infer T> ? T : never,
      },
    });

    const result = await NormalizeCacheNode.execute(state, makeContext());

    assert.equal(result.output, 'invariant-violated');
    assert.equal(state.errors.length, 1);
    const err = state.errors[0];
    assert.ok(err !== undefined);
    assert.ok(err.message.includes(RAW_CACHE_OFF_ERROR));
  });

  it('succeeds when cache.mode is off and includeRawContent is false on a target', async () => {
    const state = new ConfigLoadState();
    state.validated = makeValidated({
      targets: {
        mywiki: {
          baseUrl:           'https://example.com',
          pipeline:          ['html:fetch', 'json:write'],
          cache:             { dir: '.cache', mode: 'off' },
          includeRawContent: false,
        } as RipperConfigInterface['targets'] extends Record<string, infer T> ? T : never,
      },
    });

    const result = await NormalizeCacheNode.execute(state, makeContext());

    assert.equal(result.output, 'success');
    assert.equal(state.normalized?.targets?.['mywiki']?.cache.mode, 'off');
  });

  it('applies default cache to mediawiki entries', async () => {
    const state = new ConfigLoadState();
    state.validated = makeValidated({
      mediawiki: {
        bulbapedia: {
          apiUrl:   'https://bulbapedia.bulbagarden.net/w/api.php',
          pipeline: ['wiki:fetch', 'json:write'],
        } as RipperConfigInterface['mediawiki'] extends Record<string, infer T> | undefined ? T : never,
      },
    });

    await NormalizeCacheNode.execute(state, makeContext());

    const cache = state.normalized?.mediawiki?.['bulbapedia']?.cache;
    assert.equal(cache?.dir, 'output/.cache/bulbapedia');
    assert.equal(cache?.mode, 'read-write');
  });
});

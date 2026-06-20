import { describe, it } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { AssertInvariantsNode } from '../../../../src/nodes/config/AssertInvariantsNode.js';
import { ConfigLoadState } from '../../../../src/state/ConfigLoadState.js';
import type { NormalizedRipperConfigInterface } from '../../../../src/types/Config.js';

const makeContext = () => ({
  signal:   new AbortController().signal,
  dagName:  'configLoadDAG',
  nodeName: 'assert-invariants',
  services: undefined,
});

function makeNormalized(partial: Partial<NormalizedRipperConfigInterface>): NormalizedRipperConfigInterface {
  return {
    output: { basePath: './out' },
    ...partial,
  } as NormalizedRipperConfigInterface;
}

describe('AssertInvariantsNode', () => {
  it('returns invariant-violated when state.normalized is null', async () => {
    const state = new ConfigLoadState();
    // state.normalized is null by default

    const result = await AssertInvariantsNode.execute(Batch.of(state), makeContext());

    assert.ok(result.has('invariant-violated'));
    assert.equal(state.errors.length, 1);
  });

  it('returns success for a clean normalized config', async () => {
    const state = new ConfigLoadState();
    state.normalized = makeNormalized({});

    const result = await AssertInvariantsNode.execute(Batch.of(state), makeContext());

    assert.ok(result.has('success'));
    assert.equal(state.errors.length, 0);
  });

  it('returns invariant-violated when a target pipeline references api:fetch', async () => {
    const state = new ConfigLoadState();
    state.normalized = makeNormalized({
      targets: {
        bad: {
          baseUrl:  'https://example.com',
          pipeline: ['api:fetch', 'json:write'],
          cache:    { dir: '.cache', mode: 'read-write' },
        } as unknown as NormalizedRipperConfigInterface['targets'] extends Record<string, infer T> | undefined ? T : never,
      },
    });

    const result = await AssertInvariantsNode.execute(Batch.of(state), makeContext());

    assert.ok(result.has('invariant-violated'));
    const err = state.errors[0];
    assert.ok(err !== undefined);
    assert.ok(err.message.includes('api:fetch'));
    assert.ok(err.message.includes('bad'));
  });

  it('returns invariant-violated when a mediawiki pipeline references api:fetch', async () => {
    const state = new ConfigLoadState();
    state.normalized = makeNormalized({
      mediawiki: {
        wiki: {
          apiUrl:   'https://example.com/w/api.php',
          pipeline: ['api:fetch'],
          cache:    { dir: '.cache', mode: 'read-write' },
        } as unknown as NormalizedRipperConfigInterface['mediawiki'] extends Record<string, infer T> | undefined ? T : never,
      },
    });

    const result = await AssertInvariantsNode.execute(Batch.of(state), makeContext());

    assert.ok(result.has('invariant-violated'));
    const err = state.errors[0];
    assert.ok(err !== undefined);
    assert.ok(err.message.includes('api:fetch'));
  });

  it('succeeds when pipelines do not reference api:fetch', async () => {
    const state = new ConfigLoadState();
    state.normalized = makeNormalized({
      targets: {
        ok: {
          baseUrl:  'https://example.com',
          pipeline: ['html:fetch', 'json:write'],
          cache:    { dir: '.cache', mode: 'read-write' },
        } as unknown as NormalizedRipperConfigInterface['targets'] extends Record<string, infer T> | undefined ? T : never,
      },
    });

    const result = await AssertInvariantsNode.execute(Batch.of(state), makeContext());

    assert.ok(result.has('success'));
    assert.equal(state.errors.length, 0);
  });
});

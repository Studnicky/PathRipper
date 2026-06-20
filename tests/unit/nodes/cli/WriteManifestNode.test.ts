import { describe, it } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { WriteManifestNode } from '../../../../src/nodes/cli/WriteManifestNode.js';
import { CliState }          from '../../../../src/state/CliState.js';
import { Logger }            from '../../../../src/modules/logger/logger.js';

const makeContext = () => ({
  signal:   new AbortController().signal,
  dagName:  'cliScrapeDAG',
  nodeName: 'cli:write-manifest',
  services: { log: Logger.forComponent('WriteManifestNode.test') },
});

describe('WriteManifestNode', () => {
  it('returns skipped when failedCount is 0', async () => {
    const state = new CliState();
    state.failedCount = 0;

    const result = await WriteManifestNode.execute(Batch.of(state), makeContext());

    assert.ok(result.has('skipped'));
  });

  it('returns success when failedCount > 0', async () => {
    const state = new CliState();
    state.failedCount = 3;

    const result = await WriteManifestNode.execute(Batch.of(state), makeContext());

    assert.ok(result.has('success'));
  });
});

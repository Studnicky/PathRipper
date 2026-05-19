import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ExitNode } from '../../../../src/nodes/cli/ExitNode.js';
import { CliState } from '../../../../src/state/CliState.js';
import { Logger }   from '../../../../src/modules/logger/logger.js';

const makeContext = () => ({
  signal:   new AbortController().signal,
  dagName:  'cliScrapeDAG',
  nodeName: 'cli:exit',
  services: { log: Logger.forComponent('ExitNode.test') },
});

describe('ExitNode', () => {
  it('always returns success output', async () => {
    const state = new CliState();

    const result = await ExitNode.execute(state, makeContext());

    assert.equal(result.output, 'success');
  });

  it('sets exitCode=0 when no error and no failures', async () => {
    const state = new CliState();
    state.errorMessage = '';
    state.failedCount  = 0;

    await ExitNode.execute(state, makeContext());

    assert.equal(state.exitCode, 0);
  });

  it('sets exitCode=1 when errorMessage is set', async () => {
    const state = new CliState();
    state.errorMessage = 'something went wrong';
    state.failedCount  = 0;

    await ExitNode.execute(state, makeContext());

    assert.equal(state.exitCode, 1);
  });

  it('sets exitCode=2 when failedCount > 0 and no errorMessage', async () => {
    const state = new CliState();
    state.errorMessage = '';
    state.failedCount  = 5;

    await ExitNode.execute(state, makeContext());

    assert.equal(state.exitCode, 2);
  });

  it('sets exitCode=1 (not 2) when both errorMessage and failedCount are set', async () => {
    const state = new CliState();
    state.errorMessage = 'dispatch failed';
    state.failedCount  = 3;

    await ExitNode.execute(state, makeContext());

    // errorMessage takes priority.
    assert.equal(state.exitCode, 1);
  });
});

// Unit tests for ChooseModeNode.
// Verifies that the correct output port is selected based on state flags and config.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Dagonizer }    from '@noocodex/dagonizer';
import { DAGBuilder }   from '@noocodex/dagonizer/builder';

import { MemberResolutionState } from '../../../../src/state/MemberResolutionState.js';
import { ChooseModeNode }        from '../../../../src/nodes/wiki/ChooseModeNode.js';
import type { RipperServices }      from '../../../../src/services/RipperServices.js';
import { Logger }                from '../../../../src/modules/logger/logger.js';

// ── Shared services ────────────────────────────────────────────────────────────

const SERVICES = {
  log:    Logger.forComponent('ChooseModeNode.test'),
  cache:  null,
  target: { id: 'test', cfg: {} },
  outDir: '/tmp',
} as unknown as RipperServices;

// ── Helper: builds and executes a DAG that records which branch ran ────────────

type ModePort = 'resume-failures' | 'single-category' | 'by-categories' | 'all-pages';

const runChooseMode = async (state: MemberResolutionState): Promise<ModePort[]> => {
  const chosen: ModePort[] = [];
  const dagId = `chooseModeTestDAG:${Math.random().toString(36).slice(2)}`;

  const makeStub = (port: ModePort) => ({
    name:    `stub:cm:${port}` as string,
    outputs: ['ok'] as const,
    async execute(): Promise<{ output: 'ok' }> {
      chosen.push(port);
      return { output: 'ok' };
    },
  });

  const dispatcher = new Dagonizer<MemberResolutionState, RipperServices>({ services: SERVICES });
  dispatcher.registerNode(ChooseModeNode);
  for (const port of ['resume-failures', 'single-category', 'by-categories', 'all-pages'] as ModePort[]) {
    dispatcher.registerNode(makeStub(port));
  }

  dispatcher.registerDAG(
    new DAGBuilder(dagId, '1.0')
      .node('wiki:choose-mode', ChooseModeNode, {
        'resume-failures':  'stub:cm:resume-failures',
        'single-category':  'stub:cm:single-category',
        'by-categories':    'stub:cm:by-categories',
        'all-pages':        'stub:cm:all-pages',
      })
      .node('stub:cm:resume-failures',  makeStub('resume-failures'),  { ok: null })
      .node('stub:cm:single-category',  makeStub('single-category'),  { ok: null })
      .node('stub:cm:by-categories',    makeStub('by-categories'),    { ok: null })
      .node('stub:cm:all-pages',        makeStub('all-pages'),        { ok: null })
      .build(),
  );

  await dispatcher.execute(dagId, state);
  return chosen;
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ChooseModeNode', () => {
  it('selects resume-failures when resumeFailures is true (highest priority)', async () => {
    const state = new MemberResolutionState();
    state.resumeFailures = true;
    state.category       = 'Ships'; // resumeFailures must override
    state.config         = { categories: ['Monsters'] };

    const chosen = await runChooseMode(state);
    assert.deepEqual(chosen, ['resume-failures']);
  });

  it('selects single-category when category is set and resumeFailures is false', async () => {
    const state = new MemberResolutionState();
    state.resumeFailures = false;
    state.category       = 'Ships';
    state.config         = { categories: ['Monsters'] }; // explicit category overrides config

    const chosen = await runChooseMode(state);
    assert.deepEqual(chosen, ['single-category']);
  });

  it('selects by-categories when config.categories is a non-empty array', async () => {
    const state = new MemberResolutionState();
    state.config = { categories: ['Monsters', 'Ships'] };

    const chosen = await runChooseMode(state);
    assert.deepEqual(chosen, ['by-categories']);
  });

  it('selects all-pages when no flags and config.categories is absent', async () => {
    const chosen = await runChooseMode(new MemberResolutionState());
    assert.deepEqual(chosen, ['all-pages']);
  });

  it('selects all-pages when config.categories is an empty array', async () => {
    const state = new MemberResolutionState();
    state.config = { categories: [] };

    const chosen = await runChooseMode(state);
    assert.deepEqual(chosen, ['all-pages']);
  });
});

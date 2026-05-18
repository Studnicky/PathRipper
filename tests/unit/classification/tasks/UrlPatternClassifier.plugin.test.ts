/**
 * @fileoverview Unit tests for the self-registering plugin path of
 * `classify:url-pattern`.
 *
 * @remarks
 * The legacy factory path (`UrlPatternClassifier.create`) is covered by
 * `UrlPatternClassifier.test.ts`. This file exercises the silo path: top-level
 * `TaskRegistry.register` + `TaskRegistry.registerHook` calls, the AJV-backed
 * config validation in `onRunStart`, the cache populated keyed by `ctx.target`,
 * and the per-record task reading from that cache.
 *
 * @module tests/unit/classification/tasks/UrlPatternClassifier.plugin
 * @category Classification
 * @since 0.7.0
 */

import { describe, it, before } from 'node:test';
import assert                    from 'node:assert/strict';

// Side-effect imports — wire the run-wide AJV instance and logger BEFORE the
// plugin module loads so the plugin's `onRunStart` hook is registered AFTER
// `context:ajv` and `context:logger` in the global TaskRegistry's
// insertion-ordered hook map.
import '../../../../src/context/logger.js';
import '../../../../src/context/ajv.js';

import { TaskRegistry }      from '../../../../src/registry/TaskRegistry.js';
import { OutputConfigError } from '../../../../src/errors/OutputConfigError.js';
import type {
  PipelineContextInterface,
  PipelineStateInterface,
  ClassificationProposalInterface,
} from '../../../../src/types/PipelineState.js';
import {
  __resetUrlPatternCacheForTests,
} from '../../../../src/classification/tasks/UrlPatternClassifier.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildState(
  input: Record<string, unknown>,
  target: string,
  existing: ReadonlyArray<ClassificationProposalInterface> = [],
): PipelineStateInterface {
  return {
    targetId:        target,
    source:          { target, path: 'fixture.json' },
    input,
    classification:  null,
    classifications: existing,
    output:          null,
  };
}

type CtxStub = Partial<PipelineContextInterface> & {
  target: string;
  outDir: string;
  config: Record<string, unknown>;
};

async function runContextHooks(stub: CtxStub): Promise<void> {
  for (const [name, fn] of TaskRegistry.onRunStartHooks()) {
    if (
      name === 'context:logger' ||
      name === 'context:ajv' ||
      name === 'classify:url-pattern'
    ) {
      await fn(stub as unknown as PipelineContextInterface);
    }
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('classify:url-pattern plugin — self-registration', () => {
  it('per-record task is registered on the global TaskRegistry', () => {
    assert.ok(
      TaskRegistry.has('classify:url-pattern'),
      'Expected classify:url-pattern to be registered on the global TaskRegistry',
    );
  });

  it('manifest carries proposesClass: true', () => {
    const manifests   = TaskRegistry.manifests();
    const taskManifest = manifests.find(m => m.name === 'classify:url-pattern');
    assert.ok(taskManifest, 'expected classify:url-pattern manifest entry');
    assert.equal(taskManifest.proposesClass, true);
  });

  it('onRunStart hook is registered under the same name', () => {
    const hooks = TaskRegistry.onRunStartHooks();
    const hook  = hooks.find(([name]) => name === 'classify:url-pattern');
    assert.ok(hook, 'expected classify:url-pattern onRunStart hook');
  });
});

describe('classify:url-pattern plugin — onRunStart config validation', () => {
  it('throws OutputConfigError when urlPattern config is malformed', async () => {
    __resetUrlPatternCacheForTests();
    const ctx: CtxStub = {
      target: 'bad-config-target',
      outDir: '/tmp/x',
      config: {
        urlPattern: { patterns: 'not-an-array' }, // wrong type
      },
    };

    await assert.rejects(
      runContextHooks(ctx),
      (err: unknown) => {
        assert.ok(err instanceof OutputConfigError, 'expected OutputConfigError');
        assert.match((err as Error).message, /classify:url-pattern/);
        return true;
      },
    );
  });

  it('throws OutputConfigError when patterns array is empty', async () => {
    __resetUrlPatternCacheForTests();
    const ctx: CtxStub = {
      target: 'empty-patterns-target',
      outDir: '/tmp/x',
      config: { urlPattern: { patterns: [] } },
    };

    await assert.rejects(
      runContextHooks(ctx),
      (err: unknown) => err instanceof OutputConfigError,
    );
  });

  it('throws OutputConfigError naming the pattern index for an invalid regex', async () => {
    __resetUrlPatternCacheForTests();
    const ctx: CtxStub = {
      target: 'bad-regex-target',
      outDir: '/tmp/x',
      config: {
        urlPattern: {
          patterns: [
            { className: 'feat', match: '/Feats\\.aspx', priority: 35 },
            { className: 'bad',  match: '[invalid(',     priority: 35 },
          ],
        },
      },
    };

    await assert.rejects(
      runContextHooks(ctx),
      (err: unknown) => {
        assert.ok(err instanceof OutputConfigError, 'expected OutputConfigError');
        assert.match((err as Error).message, /patterns\[1\]/);
        return true;
      },
    );
  });

  it('skips silently when no urlPattern config is present', async () => {
    __resetUrlPatternCacheForTests();
    const ctx: CtxStub = {
      target: 'no-config-target',
      outDir: '/tmp/x',
      config: {},
    };
    // Should not throw.
    await runContextHooks(ctx);
    assert.ok(true);
  });
});

describe('classify:url-pattern plugin — cache population + per-record scoring', () => {
  const target = 'aonprd-plugin-test';

  before(async () => {
    __resetUrlPatternCacheForTests();
    const ctx: CtxStub = {
      target,
      outDir: '/tmp/x',
      config: {
        urlPattern: {
          patterns: [
            { className: 'feat',  match: '/Feats\\.aspx',  priority: 35 },
            { className: 'spell', match: '/Spells\\.aspx', priority: 35 },
          ],
        },
      },
    };
    await runContextHooks(ctx);
  });

  it('per-record task emits a proposal when the URL matches a pattern', async () => {
    const task = TaskRegistry.get('classify:url-pattern');
    const state: PipelineStateInterface = {
      ...buildState(
        { _source: { url: 'https://2e.aonprd.com/Feats.aspx?ID=750' } },
        target,
      ),
      context: { target } as unknown as PipelineContextInterface,
    };

    let nextCalled = false;
    await task(async () => { nextCalled = true; }, state);

    assert.ok(nextCalled, 'next() must be called');
    assert.equal(state.classifications.length, 1);
    const proposal = state.classifications[0]!;
    assert.equal(proposal.source,    'classify:url-pattern');
    assert.equal(proposal.className, 'feat');
    assert.equal(proposal.priority,  35);
    assert.equal(proposal.confidence, 1);
    assert.ok(
      proposal.reasons.some(r => r.includes('/Feats\\.aspx')),
      'expected reason to include the regex source',
    );
    assert.ok(
      proposal.reasons.some(r => r.startsWith('url=')),
      'expected reason to include the matched URL',
    );
  });

  it('emits multiple proposals when multiple patterns match', async () => {
    // Build a fresh target whose patterns both match the same URL.
    const multiTarget = 'multi-match-target';
    __resetUrlPatternCacheForTests();
    const ctx: CtxStub = {
      target: multiTarget,
      outDir: '/tmp/x',
      config: {
        urlPattern: {
          patterns: [
            { className: 'feat',  match: 'Feats',  priority: 35 },
            { className: 'spell', match: 'Spells', priority: 35 },
          ],
        },
      },
    };
    await runContextHooks(ctx);

    const task = TaskRegistry.get('classify:url-pattern');
    const state: PipelineStateInterface = {
      ...buildState(
        { _source: { url: 'https://2e.aonprd.com/Feats-and-Spells' } },
        multiTarget,
      ),
      context: { target: multiTarget } as unknown as PipelineContextInterface,
    };

    await task(async () => { /* next */ }, state);

    assert.equal(state.classifications.length, 2);
    const classNames = state.classifications.map(p => p.className).sort();
    assert.deepEqual(classNames, ['feat', 'spell']);
  });

  it('falls back to top-level url when _source.url is absent', async () => {
    const fallbackTarget = 'fallback-url-target';
    __resetUrlPatternCacheForTests();
    const ctx: CtxStub = {
      target: fallbackTarget,
      outDir: '/tmp/x',
      config: {
        urlPattern: {
          patterns: [{ className: 'spell', match: '/Spells\\.aspx', priority: 35 }],
        },
      },
    };
    await runContextHooks(ctx);

    const task = TaskRegistry.get('classify:url-pattern');
    const state: PipelineStateInterface = {
      ...buildState(
        { url: 'https://2e.aonprd.com/Spells.aspx?ID=1', _source: { target: 'aonprd' } },
        fallbackTarget,
      ),
      context: { target: fallbackTarget } as unknown as PipelineContextInterface,
    };

    await task(async () => { /* next */ }, state);

    assert.equal(state.classifications.length, 1);
    assert.equal(state.classifications[0]!.className, 'spell');
  });

  it('emits no proposals when the record has no URL', async () => {
    const noUrlTarget = 'no-url-target';
    __resetUrlPatternCacheForTests();
    const ctx: CtxStub = {
      target: noUrlTarget,
      outDir: '/tmp/x',
      config: {
        urlPattern: {
          patterns: [{ className: 'feat', match: '/Feats\\.aspx', priority: 35 }],
        },
      },
    };
    await runContextHooks(ctx);

    const task = TaskRegistry.get('classify:url-pattern');
    const state: PipelineStateInterface = {
      ...buildState({ name: 'Power Attack', level: 1 }, noUrlTarget),
      context: { target: noUrlTarget } as unknown as PipelineContextInterface,
    };

    await task(async () => { /* next */ }, state);

    assert.equal(state.classifications.length, 0);
  });
});

describe('classify:url-pattern plugin — missing cache fails fast', () => {
  it('per-record task throws OutputConfigError when no cache entry for the target', async () => {
    __resetUrlPatternCacheForTests();

    const target = 'never-populated-target';
    const task   = TaskRegistry.get('classify:url-pattern');

    const state: PipelineStateInterface = {
      ...buildState({ _source: { url: 'https://2e.aonprd.com/Feats.aspx' } }, target),
      context: {
        target,
        outDir: '/tmp/x',
        config: {},
      } as unknown as PipelineContextInterface,
    };

    await assert.rejects(
      task(async () => { /* next */ }, state),
      (err: unknown) => {
        assert.ok(err instanceof OutputConfigError, 'expected OutputConfigError');
        assert.match((err as Error).message, /no compiled patterns cached/);
        return true;
      },
    );
  });
});

describe('classify:url-pattern plugin — cache isolation across targets', () => {
  it('two targets see disjoint compiled patterns', async () => {
    __resetUrlPatternCacheForTests();

    const ctxA: CtxStub = {
      target: 'targetA',
      outDir: '/tmp/x',
      config: {
        urlPattern: {
          patterns: [{ className: 'classA', match: 'pathA', priority: 50 }],
        },
      },
    };
    const ctxB: CtxStub = {
      target: 'targetB',
      outDir: '/tmp/x',
      config: {
        urlPattern: {
          patterns: [{ className: 'classB', match: 'pathB', priority: 60 }],
        },
      },
    };
    await runContextHooks(ctxA);
    await runContextHooks(ctxB);

    const task = TaskRegistry.get('classify:url-pattern');

    const stateA: PipelineStateInterface = {
      ...buildState({ _source: { url: 'https://example.com/pathA/here' } }, 'targetA'),
      context: ctxA as unknown as PipelineContextInterface,
    };
    await task(async () => { /* next */ }, stateA);

    const stateB: PipelineStateInterface = {
      ...buildState({ _source: { url: 'https://example.com/pathB/here' } }, 'targetB'),
      context: ctxB as unknown as PipelineContextInterface,
    };
    await task(async () => { /* next */ }, stateB);

    const namesA = stateA.classifications.map(p => p.className);
    const namesB = stateB.classifications.map(p => p.className);
    const prioA  = stateA.classifications.map(p => p.priority);
    const prioB  = stateB.classifications.map(p => p.priority);
    assert.deepEqual(namesA, ['classA']);
    assert.deepEqual(namesB, ['classB']);
    assert.deepEqual(prioA,  [50]);
    assert.deepEqual(prioB,  [60]);
  });
});

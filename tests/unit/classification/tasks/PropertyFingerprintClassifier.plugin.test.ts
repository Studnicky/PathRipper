/**
 * @fileoverview Unit tests for the self-registering plugin path of
 * `classify:property-fingerprint`.
 *
 * @remarks
 * The legacy factory path (`PropertyFingerprintClassifier.create`) is covered
 * by `PropertyFingerprintClassifier.test.ts`. This file exercises the silo
 * path: top-level `TaskRegistry.register` + `TaskRegistry.registerHook` calls,
 * the AJV-backed config validation in `onRunStart`, the cache populated keyed
 * by `ctx.target`, and the per-record task reading from that cache.
 *
 * @module tests/unit/classification/tasks/PropertyFingerprintClassifier.plugin
 * @category Classification
 * @since 0.7.0
 */

import { describe, it, before, after } from 'node:test';
import assert                          from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir }                       from 'node:os';
import { join }                         from 'node:path';

// Side-effect imports — wire the run-wide AJV instance and logger BEFORE the
// plugin module loads so the plugin's `onRunStart` hook is registered AFTER
// `context:ajv` and `context:logger` in the global TaskRegistry's
// insertion-ordered hook map.
import '../../../../src/context/logger.js';
import '../../../../src/context/ajv.js';

import { TaskRegistry }                  from '../../../../src/registry/TaskRegistry.js';
import { OutputConfigError }             from '../../../../src/errors/OutputConfigError.js';
import type {
  PipelineContextInterface,
  PipelineStateInterface,
  ClassificationProposalInterface,
} from '../../../../src/types/PipelineState.js';
import {
  __resetPropertyFingerprintCacheForTests,
} from '../../../../src/classification/tasks/PropertyFingerprintClassifier.js';

// ── Suite-level temp directory ─────────────────────────────────────────────────

let rootDir = '';

before(async () => {
  rootDir = await mkdtemp(join(tmpdir(), 'sq-pfp-plugin-'));
});

after(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildState(input: Record<string, unknown>, target: string): PipelineStateInterface {
  return {
    targetId:        target,
    source:          { target, path: 'fixture.json' },
    input,
    classification:  null,
    classifications: [],
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
      name === 'classify:property-fingerprint'
    ) {
      await fn(stub as unknown as PipelineContextInterface);
    }
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('classify:property-fingerprint plugin — self-registration', () => {
  it('per-record task is registered on the global TaskRegistry', () => {
    assert.ok(
      TaskRegistry.has('classify:property-fingerprint'),
      'Expected classify:property-fingerprint to be registered on the global TaskRegistry',
    );
  });

  it('manifest carries proposesClass: true', () => {
    const manifests = TaskRegistry.manifests();
    const taskManifest = manifests.find(m => m.name === 'classify:property-fingerprint');
    assert.ok(taskManifest, 'expected classify:property-fingerprint manifest entry');
    assert.equal(taskManifest.proposesClass, true);
  });

  it('onRunStart hook is registered under the same name', () => {
    const hooks = TaskRegistry.onRunStartHooks();
    const hook  = hooks.find(([name]) => name === 'classify:property-fingerprint');
    assert.ok(hook, 'expected classify:property-fingerprint onRunStart hook');
  });
});

describe('classify:property-fingerprint plugin — onRunStart config validation', () => {
  it('throws OutputConfigError when propertyFingerprint config is malformed', async () => {
    const ctx: CtxStub = {
      target: 'bad-config-target',
      outDir: '/tmp/x',
      config: {
        propertyFingerprint: { fingerprintsFrom: 123 }, // wrong type
      },
    };

    await assert.rejects(
      runContextHooks(ctx),
      (err: unknown) => {
        assert.ok(err instanceof OutputConfigError, 'expected OutputConfigError');
        assert.match((err as Error).message, /classify:property-fingerprint/);
        return true;
      },
    );
  });

  it('skips silently when no propertyFingerprint config is present', async () => {
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

describe('classify:property-fingerprint plugin — cache population + per-record scoring', () => {
  let fingerprintsPath = '';
  const target         = 'aonprd-plugin-test';

  before(async () => {
    const fpDir = join(rootDir, 'cache-pop');
    await mkdir(fpDir, { recursive: true });
    fingerprintsPath = join(fpDir, 'fingerprints.json');
    await writeFile(
      fingerprintsPath,
      JSON.stringify({
        feat: { keys: ['name', 'level', 'rarity', 'traits', 'action_cost'], weight: 0.95 },
      }),
      'utf-8',
    );
    __resetPropertyFingerprintCacheForTests();
  });

  it('populates the cache and the per-record task emits proposals', async () => {
    const ctx: CtxStub = {
      target,
      outDir: '/tmp/x',
      config: {
        propertyFingerprint: {
          fingerprintsFrom: fingerprintsPath,
          minMatchScore:    0.80,
          priority:         32,
        },
      },
    };

    await runContextHooks(ctx);

    const task = TaskRegistry.get('classify:property-fingerprint');
    const state: PipelineStateInterface = {
      ...buildState(
        { name: 'Power Attack', level: 1, rarity: 'common', traits: [], action_cost: 'two-actions' },
        target,
      ),
      context: ctx as unknown as PipelineContextInterface,
    };

    let nextCalled = false;
    await task(async () => { nextCalled = true; }, state);

    assert.ok(nextCalled, 'next() must be called');
    assert.equal(state.classifications.length, 1);
    const proposal = state.classifications[0]!;
    assert.equal(proposal.source,    'classify:property-fingerprint');
    assert.equal(proposal.className, 'feat');
    assert.ok(
      proposal.reasons.some((r: string) => r.startsWith('fingerprint.score=')),
      'expected fingerprint.score reason',
    );
    assert.ok(
      proposal.reasons.some((r: string) => r.startsWith('fingerprint.shared=')),
      'expected fingerprint.shared reason',
    );
  });
});

describe('classify:property-fingerprint plugin — missing cache fails fast', () => {
  it('per-record task throws OutputConfigError when no cache entry for the target', async () => {
    __resetPropertyFingerprintCacheForTests();

    const target = 'never-populated-target';
    const task   = TaskRegistry.get('classify:property-fingerprint');

    const state: PipelineStateInterface = {
      ...buildState({ name: 'x' }, target),
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
        assert.match((err as Error).message, /no compiled fingerprints cached/);
        return true;
      },
    );
  });
});

describe('classify:property-fingerprint plugin — cache isolation across targets', () => {
  let fpA = '';
  let fpB = '';

  before(async () => {
    const fpDir = join(rootDir, 'isolation');
    await mkdir(fpDir, { recursive: true });
    fpA = join(fpDir, 'a.json');
    fpB = join(fpDir, 'b.json');
    await writeFile(fpA, JSON.stringify({ classA: { keys: ['a', 'b', 'c'] } }), 'utf-8');
    await writeFile(fpB, JSON.stringify({ classB: { keys: ['x', 'y', 'z'] } }), 'utf-8');
    __resetPropertyFingerprintCacheForTests();
  });

  it('two targets see disjoint compiled fingerprints', async () => {
    const ctxA: CtxStub = {
      target: 'targetA',
      outDir: '/tmp/x',
      config: { propertyFingerprint: { fingerprintsFrom: fpA, minMatchScore: 0.5 } },
    };
    const ctxB: CtxStub = {
      target: 'targetB',
      outDir: '/tmp/x',
      config: { propertyFingerprint: { fingerprintsFrom: fpB, minMatchScore: 0.5 } },
    };
    await runContextHooks(ctxA);
    await runContextHooks(ctxB);

    const task = TaskRegistry.get('classify:property-fingerprint');

    const stateA: PipelineStateInterface = {
      ...buildState({ a: 1, b: 2, c: 3 }, 'targetA'),
      context: ctxA as unknown as PipelineContextInterface,
    };
    await task(async () => { /* next */ }, stateA);

    const stateB: PipelineStateInterface = {
      ...buildState({ x: 1, y: 2, z: 3 }, 'targetB'),
      context: ctxB as unknown as PipelineContextInterface,
    };
    await task(async () => { /* next */ }, stateB);

    const namesA = stateA.classifications.map((p: ClassificationProposalInterface) => p.className);
    const namesB = stateB.classifications.map((p: ClassificationProposalInterface) => p.className);
    assert.deepEqual(namesA, ['classA']);
    assert.deepEqual(namesB, ['classB']);
  });
});

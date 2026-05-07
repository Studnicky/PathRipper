/**
 * @fileoverview Quarantine-path landing test for the `classify:conflict`
 *   self-registering plugin (v0.7.0 silo migration, task #17, Amendment A3).
 *
 * @remarks
 * Documents the silo-migration invariant: when `ConflictResolver` is converted
 * to a self-registering plugin that reads `ctx.outDir` and `ctx.target` from
 * the silo at `onRunStart` (instead of taking them as constructor args), the
 * file path of a written quarantine record MUST match the path the
 * pre-migration constructor-arg form produced.
 *
 * Pre-migration {@link QuarantineWriter.forRun} layout (unchanged):
 *
 *   `<rootDir>/<target>/quarantine/<bucket>/<id>.json`
 *
 * This test:
 *
 * 1. Constructs a `ctx` with real `outDir` (`mkdtemp` under `os.tmpdir()`) and
 *    `target: 'foo'`.
 * 2. Drives the self-registered `classify:conflict` `onRunStart` hook to
 *    populate the resolver's cached silo values.
 * 3. Builds a per-record state with two conflicting class proposals at the
 *    same priority but different classNames.
 * 4. Sets `onConflict: 'quarantine'`.
 * 5. Runs the per-record execute via the global `TaskRegistry` task.
 * 6. Asserts the quarantine file lands at the documented pre-migration path
 *    `<ctx.outDir>/<ctx.target>/quarantine/conflicts/<id>.json` where `<id>`
 *    is the SHA-1 derivation
 *    `sha1("${state.source.path}#${state.classifications.length}")`.
 *
 * @category Classification
 * @since 0.7.0
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join }   from 'node:path';
import { tmpdir } from 'node:os';

import AjvModule from 'ajv';

import { TaskRegistry } from '../../../src/registry/TaskRegistry.js';
import type {
  PipelineContextInterface,
  PipelineStateInterface,
  ClassificationProposalInterface,
} from '../../../src/types/PipelineState.js';
import type { AjvCtorType } from '../../../src/types/AjvInterop.js';

// Side-effect import: registers `classify:conflict` `onRunStart` hook + task.
import '../../../src/classification/tasks/ConflictResolver.js';

const Ajv = (AjvModule as unknown as { default?: AjvCtorType }).default
  ?? (AjvModule as unknown as AjvCtorType);

// ── Helpers ─────────────────────────────────────────────────────────────────

let tmpRoot: string;

before(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'conflict-resolver-quarantine-path-'));
});

after(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

/**
 * Builds a stub PipelineContextInterface populated with the slots the
 * `classify:conflict` `onRunStart` hook reads (`config`, `ajv`, `outDir`,
 * `target`).
 */
function buildCtxStub(
  outDir:         string,
  target:         string,
  conflictConfig: unknown,
): PipelineContextInterface {
  const ajv = new Ajv({ allErrors: true, strict: true, useDefaults: false });
  const ctx = {
    target,
    outDir,
    config: conflictConfig === undefined ? {} : { conflict: conflictConfig },
    ajv,
  } as unknown as PipelineContextInterface;
  return ctx;
}

/** Builds a state for the per-record task with the given context attached. */
function buildStateWithCtx(
  ctx:             PipelineContextInterface,
  classifications: ReadonlyArray<ClassificationProposalInterface>,
  sourcePath:      string,
): PipelineStateInterface {
  return {
    targetId:        ctx.target,
    source:          { target: ctx.target, path: sourcePath },
    input:           { _type: 'unknown' },
    classification:  null,
    classifications,
    output:          null,
    context:         ctx,
  };
}

/** Tracks whether `next()` was called. */
function makeNext(): { called: boolean; fn: () => Promise<void> } {
  const handle = { called: false, fn: async (): Promise<void> => { handle.called = true; } };
  return handle;
}

/** Looks up the global `classify:conflict` `onRunStart` hook. */
function findConflictHook(): (ctx: PipelineContextInterface) => void | Promise<void> {
  const hook = TaskRegistry.onRunStartHooks().find(([n]) => n === 'classify:conflict');
  assert.ok(hook, '`classify:conflict` onRunStart hook should be registered at module load');
  return hook[1];
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('classify:conflict — self-registered plugin manifest', () => {
  it('registers an onRunStart hook on the global TaskRegistry', () => {
    const names = TaskRegistry.onRunStartHooks().map(([n]) => n);
    assert.ok(names.includes('classify:conflict'), 'expected classify:conflict hook to be registered');
  });

  it('registers the per-record task on the global TaskRegistry', () => {
    assert.equal(TaskRegistry.has('classify:conflict'), true);
  });

  it('manifest does NOT carry proposesClass: true (resolver consumes proposals)', () => {
    const manifest = TaskRegistry.manifests().find(m => m.name === 'classify:conflict');
    assert.ok(manifest, 'expected classify:conflict manifest to be present');
    assert.notEqual(manifest.proposesClass, true);
  });
});

describe('classify:conflict — quarantine-path landing (Amendment A3)', () => {
  it('quarantines a conflict tie at <ctx.outDir>/<ctx.target>/quarantine/conflicts/<id>.json', async () => {
    const target     = 'foo';
    const sourcePath = 'amendment-a3-record.json';

    // 1. Construct ctx with real outDir + target.
    const ctx = buildCtxStub(tmpRoot, target, {
      onConflict: 'quarantine',
      onUnknown:  'skip',
      evidence:   true,
    });

    // 2. Drive onRunStart so the resolver caches the silo values.
    const hook = findConflictHook();
    await hook(ctx);

    // 3. Build per-record state with two conflicting class proposals at the
    //    same priority but different classNames.
    const proposals: ReadonlyArray<ClassificationProposalInterface> = [
      {
        source:     'classify:rules',
        className:  'feat',
        priority:   10,
        confidence: 1,
        reasons:    ['_type=feat'],
      },
      {
        source:     'classify:url-pattern',
        className:  'spell',
        priority:   10,
        confidence: 1,
        reasons:    ['url contains /spell/'],
      },
    ];
    const state = buildStateWithCtx(ctx, proposals, sourcePath);

    // 4. Run the per-record task via the global TaskRegistry (`onConflict: 'quarantine'`
    //    was set in step 1).
    const task = TaskRegistry.get('classify:conflict');
    const next = makeNext();
    await task(next.fn, state);

    // 5. Compute the expected quarantine path using the SAME id derivation as
    //    QuarantineWriter / the resolver (sha1 of `${path}#${proposalCount}`).
    const expectedId = createHash('sha1')
      .update(`${sourcePath}#${proposals.length}`)
      .digest('hex');
    const expectedPath = join(
      tmpRoot,        // ctx.outDir
      target,         // ctx.target
      'quarantine',
      'conflicts',
      `${expectedId}.json`,
    );

    // 6. Assert the file lands at exactly the pre-migration path shape.
    const fileStat = await stat(expectedPath);
    assert.ok(fileStat.isFile(), `expected quarantine file at ${expectedPath}`);

    // Sanity check: the bucket and id in the persisted record match.
    const content = await readFile(expectedPath, 'utf8');
    const record  = JSON.parse(content) as Record<string, unknown>;
    assert.strictEqual(record['bucket'], 'conflicts');
    assert.strictEqual(record['id'],     expectedId);
    assert.strictEqual(record['target'], target);
    assert.strictEqual(record['classification'], null);

    // state.classification stays null (quarantine path is a graceful side-effect).
    assert.strictEqual(state.classification, null);
    assert.strictEqual(next.called, true);
  });

  it('reads ctx.outDir + ctx.target FROM THE SILO AT onRunStart, not from constructor args', async () => {
    // Two contexts with different outDirs — the per-record task must route
    // each record's quarantine write to the path captured at THAT context's
    // onRunStart, not to a process-global value.
    const targetA = 'alpha';
    const targetB = 'beta';

    const outDirA = await mkdtemp(join(tmpRoot, 'silo-a-'));
    const outDirB = await mkdtemp(join(tmpRoot, 'silo-b-'));

    const ctxA = buildCtxStub(outDirA, targetA, {
      onConflict: 'quarantine',
      onUnknown:  'skip',
      evidence:   true,
    });
    const ctxB = buildCtxStub(outDirB, targetB, {
      onConflict: 'quarantine',
      onUnknown:  'skip',
      evidence:   true,
    });

    const hook = findConflictHook();
    await hook(ctxA);
    await hook(ctxB);

    const tieProposals: ReadonlyArray<ClassificationProposalInterface> = [
      { source: 'classify:rules', className: 'apple',  priority: 5, confidence: 1, reasons: ['a'] },
      { source: 'classify:rules', className: 'banana', priority: 5, confidence: 1, reasons: ['b'] },
    ];

    const sourcePath = 'silo-isolation.json';
    const expectedId = createHash('sha1')
      .update(`${sourcePath}#${tieProposals.length}`)
      .digest('hex');

    const stateA = buildStateWithCtx(ctxA, tieProposals, sourcePath);
    const stateB = buildStateWithCtx(ctxB, tieProposals, sourcePath);

    const task = TaskRegistry.get('classify:conflict');
    await task(async () => { /* noop next */ }, stateA);
    await task(async () => { /* noop next */ }, stateB);

    const pathA = join(outDirA, targetA, 'quarantine', 'conflicts', `${expectedId}.json`);
    const pathB = join(outDirB, targetB, 'quarantine', 'conflicts', `${expectedId}.json`);

    assert.ok((await stat(pathA)).isFile(), `expected ctxA quarantine at ${pathA}`);
    assert.ok((await stat(pathB)).isFile(), `expected ctxB quarantine at ${pathB}`);
  });
});

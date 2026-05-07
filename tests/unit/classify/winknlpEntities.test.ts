/**
 * @fileoverview Unit tests for the `classify:winknlp-entities` self-registering
 * plugin module — verifies side-effect registration on `TaskRegistry`,
 * `onRunStart` AJV validation + model compile, and per-record proposal
 * emission via the cached compiled state.
 *
 * @module tests/unit/classify/winknlpEntities
 * @category Classification
 * @since 0.7.0
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { TaskRegistry }   from '../../../src/registry/TaskRegistry.js';
import { OutputConfigError } from '../../../src/errors/OutputConfigError.js';
import type {
  PipelineContextInterface,
  PipelineStateInterface,
}                          from '../../../src/types/PipelineState.js';

// Required by the plugin's onRunStart hook (populates ctx.ajv, ctx.logger).
import '../../../src/context/index.js';
// Plugin under test — side-effect registers the hook + per-record task.
import '../../../src/classify/winknlpEntities.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

type Stub = Partial<PipelineContextInterface> & {
  target: string;
  outDir: string;
  config: Record<string, unknown>;
};

async function runOnRunStart(stub: Stub): Promise<void> {
  for (const [, fn] of TaskRegistry.onRunStartHooks()) {
    await fn(stub as unknown as PipelineContextInterface);
  }
}

function buildState(
  ctx: PipelineContextInterface,
  input: Record<string, unknown>,
): PipelineStateInterface {
  return {
    targetId:        'unit-target',
    source:          { target: 'unit-target', path: 'fixture.json' },
    input,
    classification:  null,
    classifications: [],
    output:          null,
    context:         ctx,
  };
}

// ── Suite: registration shape ─────────────────────────────────────────────────

describe('classify:winknlp-entities — self-registration', () => {
  it('registers an onRunStart hook on the TaskRegistry', () => {
    const names = TaskRegistry.onRunStartHooks().map(([n]) => n);
    assert.ok(names.includes('classify:winknlp-entities'),
      'classify:winknlp-entities onRunStart hook must be registered');
  });

  it('registers a per-record task on the TaskRegistry with proposesClass: true', () => {
    assert.ok(TaskRegistry.has('classify:winknlp-entities'),
      'classify:winknlp-entities task must be registered');
    const manifest = TaskRegistry.manifests().find(m => m.name === 'classify:winknlp-entities' && m.phase === undefined);
    assert.ok(manifest, 'per-record manifest must be present');
    assert.equal(manifest.proposesClass, true, 'must declare proposesClass: true');
  });
});

// ── Suite: onRunStart compile + per-record emission ──────────────────────────

describe('classify:winknlp-entities — onRunStart + per-record', () => {
  let stub: Stub;

  before(async () => {
    stub = {
      target: 'unit-target',
      outDir: './graphs',
      config: {
        winknlpEntities: {
          patterns: [
            {
              name:      'feat-action-cost',
              patterns:  ['two actions'],
              className: 'feat',
              priority:  28,
            },
            {
              name:      'spell-somatic',
              patterns:  ['somatic component'],
              className: 'spell',
              priority:  30,
            },
          ],
          fields: ['description', 'summary'],
        },
      },
    };
    await runOnRunStart(stub);
  });

  it('per-record task emits a proposal when a configured pattern matches', async () => {
    const ctx = stub as unknown as PipelineContextInterface;
    const state = buildState(ctx, {
      description: 'This feat costs two actions to activate.',
    });

    const task = TaskRegistry.get('classify:winknlp-entities');
    let nextCalled = false;
    await task(async () => { nextCalled = true; }, state);

    assert.ok(nextCalled, 'next() must be called');
    assert.equal(state.classifications.length, 1);
    const [p] = state.classifications;
    assert.ok(p !== undefined);
    assert.equal(p.source,     'classify:winknlp-entities');
    assert.equal(p.className,  'feat');
    assert.equal(p.priority,   28);
    assert.equal(p.confidence, 1);
    assert.ok(p.reasons.includes('winknlp:pattern=feat-action-cost'));
    assert.ok(p.reasons.includes('winknlp:field=description'));
    assert.ok(p.reasons.some(r => r.startsWith('winknlp:matched=')));
  });

  it('multiple patterns + multiple fields each yield a proposal', async () => {
    const ctx = stub as unknown as PipelineContextInterface;
    const state = buildState(ctx, {
      description: 'This feat costs two actions to activate.',
      summary:     'Casting requires a somatic component.',
    });

    const task = TaskRegistry.get('classify:winknlp-entities');
    await task(async () => {}, state);

    assert.equal(state.classifications.length, 2);
    const sources = state.classifications.map(p => p.className).sort();
    assert.deepEqual(sources, ['feat', 'spell']);
    const fields = state.classifications.flatMap(p => p.reasons.filter(r => r.startsWith('winknlp:field='))).sort();
    assert.deepEqual(fields, ['winknlp:field=description', 'winknlp:field=summary']);
  });

  it('record without configured field produces no proposal', async () => {
    const ctx = stub as unknown as PipelineContextInterface;
    const state = buildState(ctx, { name: 'no-prose-here' });

    const task = TaskRegistry.get('classify:winknlp-entities');
    await task(async () => {}, state);

    assert.equal(state.classifications.length, 0);
  });

  it('empty prose value produces no proposal', async () => {
    const ctx = stub as unknown as PipelineContextInterface;
    const state = buildState(ctx, { description: '' });

    const task = TaskRegistry.get('classify:winknlp-entities');
    await task(async () => {}, state);

    assert.equal(state.classifications.length, 0);
  });
});

// ── Suite: optional-config no-op semantics ────────────────────────────────────

describe('classify:winknlp-entities — optional-config silence', () => {
  it('onRunStart no-ops when ctx.config.winknlpEntities is absent', async () => {
    const stub: Stub = {
      target: 'no-config-target',
      outDir: './graphs',
      config: {},
    };
    // Should not throw.
    await runOnRunStart(stub);

    // Per-record task still runs but emits nothing.
    const ctx = stub as unknown as PipelineContextInterface;
    const state = buildState(ctx, { description: 'two actions of effort.' });
    const task = TaskRegistry.get('classify:winknlp-entities');
    let nextCalled = false;
    await task(async () => { nextCalled = true; }, state);

    assert.ok(nextCalled);
    assert.equal(state.classifications.length, 0);
  });
});

// ── Suite: malformed config ───────────────────────────────────────────────────

describe('classify:winknlp-entities — malformed config', () => {
  it('throws OutputConfigError on schema-validation failure', async () => {
    const stub: Stub = {
      target: 'bad-config-target',
      outDir: './graphs',
      config: {
        winknlpEntities: {
          // patterns required + minItems:1; this violates the schema.
          patterns: [],
        },
      },
    };

    await assert.rejects(
      runOnRunStart(stub),
      (err: unknown) => {
        assert.ok(err instanceof OutputConfigError, 'must be OutputConfigError');
        assert.match((err as Error).message, /classify:winknlp-entities/);
        return true;
      },
    );
  });

  it('schema-validation error message names the classifier source', async () => {
    // The AJV `minLength: 1` constraint on pattern strings prevents most
    // shape-level malformations from reaching `learnCustomEntities`. The
    // resulting OutputConfigError must still be attributed to the
    // `classify:winknlp-entities` source so operators can locate the cause.
    const stub: Stub = {
      target: 'attribution-target',
      outDir: './graphs',
      config: {
        winknlpEntities: {
          patterns: [
            {
              name:      'bad-pattern',
              patterns:  [''], // violates minLength:1
              className: 'feat',
            },
          ],
        },
      },
    };

    await assert.rejects(
      runOnRunStart(stub),
      (err: unknown) => {
        assert.ok(err instanceof OutputConfigError, 'must be OutputConfigError');
        assert.match((err as Error).message, /classify:winknlp-entities/);
        return true;
      },
    );
  });
});

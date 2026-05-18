import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { TaskRegistry } from '../../../src/registry/TaskRegistry.js';
import type { PipelineContextInterface } from '../../../src/types/PipelineState.js';

// Side-effect import: registers all six `context:*` `onRunStart` hooks on the
// global TaskRegistry in the deterministic order documented in
// `src/context/index.ts`. We import the bundle once at module load and never
// `TaskRegistry.reset()` in this file — resetting would clear the hooks but
// would not re-trigger Node's ESM cache to re-execute the side-effect imports.
import '../../../src/context/index.js';

/**
 * Minimal stub that lets each `onRunStart` hook treat the value as
 * `PipelineContextInterface` while letting test code assign whatever it
 * needs. The plugins narrow it to a mutable view internally.
 */
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

describe('context lifecycle plugins — Amendment A6 import order', () => {
  it('plugins register in the documented deterministic order', () => {
    const names = TaskRegistry.onRunStartHooks().map(([n]) => n);
    // Filter to context:* names so any unrelated hooks registered by sibling
    // test files do not perturb this assertion.
    const contextNames = names.filter(n => n.startsWith('context:'));
    assert.deepEqual(contextNames, [
      'context:logger',
      'context:ajv',
      'context:run-time',
      'context:dataset',
      'context:prefixes',
      'context:ontology',
    ]);
  });
});

describe('context lifecycle plugins — onRunStart populates the silo', () => {
  let aonprdStub: Stub;

  before(async () => {
    aonprdStub = {
      target: 'aonprd',
      outDir: './graphs',
      config: {
        ontology: {
          baseIri: 'https://squashage.dev/vocabulary/aonprd#',
        },
        graphs: {
          feat:  'https://squashage.dev/graph/aonprd/feat',
          spell: 'https://squashage.dev/graph/aonprd/spell',
        },
      },
    };
    await runOnRunStart(aonprdStub);
  });

  it('ctx.logger populated with a forComponent factory', () => {
    assert.ok(aonprdStub.logger);
    assert.equal(typeof aonprdStub.logger?.forComponent, 'function');
  });

  it('ctx.ajv populated with a compile-capable instance', () => {
    assert.ok(aonprdStub.ajv);
    assert.equal(typeof aonprdStub.ajv?.compile, 'function');
  });

  it('ctx.runStartTime is a frozen ISO 8601 string', () => {
    assert.equal(typeof aonprdStub.runStartTime, 'string');
    assert.match(aonprdStub.runStartTime!, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('ctx.factory, ctx.dataset, ctx.builder populated', () => {
    assert.ok(aonprdStub.factory);
    assert.equal(typeof aonprdStub.factory?.namedNode, 'function');
    assert.ok(aonprdStub.dataset);
    assert.equal(typeof aonprdStub.dataset?.size, 'number');
    assert.ok(aonprdStub.builder);
  });

  it('ctx.prefixes, ctx.iri, ctx.graphs populated', () => {
    assert.ok(aonprdStub.prefixes);
    assert.ok(aonprdStub.iri);
    assert.ok(aonprdStub.graphs);
    assert.equal(aonprdStub.graphs?.['feat']?.value,  'https://squashage.dev/graph/aonprd/feat');
    assert.equal(aonprdStub.graphs?.['spell']?.value, 'https://squashage.dev/graph/aonprd/spell');
  });
});

describe('context:ontology — optional-key no-op semantics', () => {
  it('no-ops when config.ontology is absent', async () => {
    const stub: Stub = {
      target: 'aonprd',
      outDir: './graphs',
      config: { /* no ontology block */ },
    };

    await runOnRunStart(stub);

    assert.equal(stub.jt, undefined, 'ctx.jt left absent when no ontology config');
    // Other slots still populated.
    assert.ok(stub.logger);
    assert.ok(stub.ajv);
    assert.ok(stub.factory);
  });

  it('no-ops when ontology.engine is not json-tology', async () => {
    const stub: Stub = {
      target: 'aonprd',
      outDir: './graphs',
      config: { ontology: { engine: 'map' } },
    };

    await runOnRunStart(stub);

    assert.equal(stub.jt, undefined, 'ctx.jt left absent when engine !== json-tology');
  });
});

describe('context lifecycle plugins — idempotency', () => {
  it('re-running does not overwrite existing slots', async () => {
    const stub: Stub = {
      target: 'aonprd',
      outDir: './graphs',
      config: {},
    };

    await runOnRunStart(stub);

    const firstAjv         = stub.ajv;
    const firstDataset     = stub.dataset;
    const firstRunStart    = stub.runStartTime;

    await runOnRunStart(stub);

    assert.equal(stub.ajv,          firstAjv,      'ctx.ajv preserved');
    assert.equal(stub.dataset,      firstDataset,  'ctx.dataset preserved');
    assert.equal(stub.runStartTime, firstRunStart, 'ctx.runStartTime preserved');
  });
});

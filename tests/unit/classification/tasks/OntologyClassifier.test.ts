/**
 * @fileoverview Unit tests for {@link OntologyClassifier}.
 *
 * @remarks
 * Covers: constructor validation (empty classes throws), known className
 * passes without validation proposals, unknown className emits one
 * `__validation__` proposal with the correct reason format, multiple unknown
 * classNames each emit their own validation proposal, metadata-sentinel
 * proposals (`__source__`, `__validation__`, `unknown`) are ignored, and
 * `next()` is always called.
 *
 * @category Classification
 * @since 0.1.0
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Side-effect import: registers the `classify:ontology` task and its
// `onRunStart` hook on the global TaskRegistry.
import {
  OntologyClassifier,
  TASK_NAME,
  CONFIG_NAMESPACE,
  ontologyClassifierConfigSchema,
} from '../../../../src/classification/tasks/OntologyClassifier.js';
import type { OntologyConfigInterface } from '../../../../src/classification/tasks/OntologyClassifier.js';
import { OutputConfigError } from '../../../../src/errors/OutputConfigError.js';
import { TaskRegistry } from '../../../../src/registry/TaskRegistry.js';
import type { PipelineContextInterface, PipelineStateInterface, ClassificationProposalInterface } from '../../../../src/types/PipelineState.js';

// Side-effect import: registers `context:ajv` so we can drive a real ctx.ajv
// for the onRunStart hook tests below.
import '../../../../src/context/ajv.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Builds a minimal PipelineStateInterface for testing. */
function buildState(
  classifications: ReadonlyArray<ClassificationProposalInterface> = [],
): PipelineStateInterface {
  return {
    targetId:        'test-target',
    source:          { target: 'test-target', path: 'fixture.json' },
    input:           {},
    classification:  null,
    classifications,
    output:          null,
  };
}

/** Tracks whether `next()` was called; check `.called` after execution. */
function makeNext(): { called: boolean; fn: () => Promise<void> } {
  const handle = { called: false, fn: async (): Promise<void> => { handle.called = true; } };
  return handle;
}

/** Minimal class map with two known classes. */
const knownClassMap: OntologyConfigInterface = {
  classes: {
    feat:  'https://squashage.dev/vocabulary/aonprd#Feat',
    spell: 'https://squashage.dev/vocabulary/aonprd#Spell',
  },
};

/** Builds a concrete proposal for testing. */
function makeProposal(
  className: string,
  source:    string = 'classify:rules',
): ClassificationProposalInterface {
  return {
    source,
    className,
    priority:   10,
    confidence: 1,
    reasons:    [`${className} matched`],
  };
}

// ── Constructor tests ─────────────────────────────────────────────────────────

describe('OntologyClassifier — constructor', () => {
  it('constructs successfully with at least one class entry', () => {
    const classifier = new OntologyClassifier(knownClassMap);
    assert.ok(classifier instanceof OntologyClassifier);
  });

  it('exposes a bound execute function', () => {
    const classifier = new OntologyClassifier(knownClassMap);
    assert.strictEqual(typeof classifier.execute, 'function');
  });

  it('throws OutputConfigError when classes map is empty', () => {
    assert.throws(
      () => new OntologyClassifier({ classes: {} }),
      (err: unknown) => {
        assert.ok(err instanceof OutputConfigError, `Expected OutputConfigError, got ${String(err)}`);
        assert.match(err.message, /at least one entry/);
        return true;
      },
    );
  });
});

// ── Known className ───────────────────────────────────────────────────────────

describe('OntologyClassifier — known className', () => {
  it('emits no validation proposals when the proposal className is in the class map', async () => {
    const classifier = new OntologyClassifier(knownClassMap);
    const state = buildState([makeProposal('feat')]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    // The existing proposal remains; no new validation proposals added.
    assert.strictEqual(state.classifications.length, 1);
    assert.strictEqual(state.classifications[0]?.className, 'feat');
  });

  it('calls next() when all proposals are known', async () => {
    const classifier = new OntologyClassifier(knownClassMap);
    const state = buildState([makeProposal('spell')]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(next.called, true);
  });

  it('handles multiple known proposals without emitting validation proposals', async () => {
    const classifier = new OntologyClassifier(knownClassMap);
    const state = buildState([
      makeProposal('feat', 'classify:rules'),
      makeProposal('spell', 'classify:structural'),
    ]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(state.classifications.length, 2);
    assert.ok(
      state.classifications.every((p) => p.className !== '__validation__'),
      'No __validation__ proposals should be emitted',
    );
  });
});

// ── Unknown className ─────────────────────────────────────────────────────────

describe('OntologyClassifier — unknown className', () => {
  it('emits one __validation__ proposal when the proposal className is not in the map', async () => {
    const classifier = new OntologyClassifier(knownClassMap);
    const state = buildState([makeProposal('legendary-feat')]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    const validationProposals = state.classifications.filter(
      (p) => p.className === '__validation__',
    );
    assert.strictEqual(validationProposals.length, 1);
  });

  it('validation proposal has source classify:ontology', async () => {
    const classifier = new OntologyClassifier(knownClassMap);
    const state = buildState([makeProposal('item')]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    const validationProposal = state.classifications.find(
      (p) => p.className === '__validation__',
    );
    assert.ok(validationProposal !== undefined);
    assert.strictEqual(validationProposal.source, 'classify:ontology');
  });

  it('validation proposal has priority 0, confidence 1', async () => {
    const classifier = new OntologyClassifier(knownClassMap);
    const state = buildState([makeProposal('item')]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    const validationProposal = state.classifications.find(
      (p) => p.className === '__validation__',
    );
    assert.ok(validationProposal !== undefined);
    assert.strictEqual(validationProposal.priority,   0);
    assert.strictEqual(validationProposal.confidence, 1);
  });

  it('validation proposal reason includes the unknown className and originating source', async () => {
    const classifier = new OntologyClassifier(knownClassMap);
    const state = buildState([makeProposal('legendary-feat', 'classify:rules')]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    const validationProposal = state.classifications.find(
      (p) => p.className === '__validation__',
    );
    assert.ok(validationProposal !== undefined);
    assert.strictEqual(validationProposal.reasons.length, 1);
    assert.strictEqual(
      validationProposal.reasons[0],
      'ontology-unknown: legendary-feat (from classify:rules)',
    );
  });

  it('calls next() when unknown proposals are flagged', async () => {
    const classifier = new OntologyClassifier(knownClassMap);
    const state = buildState([makeProposal('item')]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(next.called, true);
  });
});

// ── Multiple unknown classNames ───────────────────────────────────────────────

describe('OntologyClassifier — multiple unknown classNames', () => {
  it('emits one __validation__ proposal per unknown className', async () => {
    const classifier = new OntologyClassifier(knownClassMap);
    const state = buildState([
      makeProposal('item',    'classify:rules'),
      makeProposal('ability', 'classify:structural'),
    ]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    const validationProposals = state.classifications.filter(
      (p) => p.className === '__validation__',
    );
    assert.strictEqual(validationProposals.length, 2);
  });

  it('each validation proposal carries the originating source in its reason', async () => {
    const classifier = new OntologyClassifier(knownClassMap);
    const state = buildState([
      makeProposal('item',    'classify:rules'),
      makeProposal('ability', 'classify:structural'),
    ]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    const validationProposals = state.classifications.filter(
      (p) => p.className === '__validation__',
    );
    const reasons = validationProposals.map((p) => p.reasons[0]);
    assert.ok(
      reasons.some((r) => r?.includes('item') && r.includes('classify:rules')),
      'should flag item from classify:rules',
    );
    assert.ok(
      reasons.some((r) => r?.includes('ability') && r.includes('classify:structural')),
      'should flag ability from classify:structural',
    );
  });

  it('preserves known proposals alongside validation proposals', async () => {
    const classifier = new OntologyClassifier(knownClassMap);
    const state = buildState([
      makeProposal('feat',  'classify:rules'),
      makeProposal('item',     'classify:structural'),
    ]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    // 2 original + 1 validation
    assert.strictEqual(state.classifications.length, 3);
    assert.ok(
      state.classifications.some((p) => p.className === 'feat'),
      'known proposal preserved',
    );
    assert.ok(
      state.classifications.some((p) => p.className === '__validation__'),
      'validation proposal added',
    );
  });
});

// ── Metadata sentinels ────────────────────────────────────────────────────────

describe('OntologyClassifier — metadata sentinels ignored', () => {
  it('ignores __source__ sentinel proposals', async () => {
    const classifier = new OntologyClassifier(knownClassMap);
    const state = buildState([makeProposal('__source__', 'classify:source')]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    // No validation proposals emitted for the sentinel.
    assert.strictEqual(
      state.classifications.filter((p) => p.className === '__validation__').length,
      0,
    );
  });

  it('ignores __validation__ sentinel proposals', async () => {
    const classifier = new OntologyClassifier(knownClassMap);
    const state = buildState([makeProposal('__validation__', 'classify:ontology')]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    // Still only one proposal — no new validation added for the sentinel.
    assert.strictEqual(state.classifications.length, 1);
  });

  it('ignores unknown sentinel proposals', async () => {
    const classifier = new OntologyClassifier(knownClassMap);
    const state = buildState([makeProposal('unknown', 'classify:rules')]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(
      state.classifications.filter((p) => p.className === '__validation__').length,
      0,
    );
  });

  it('emits no proposals and calls next() on empty classifications', async () => {
    const classifier = new OntologyClassifier(knownClassMap);
    const state = buildState([]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(state.classifications.length, 0);
    assert.strictEqual(next.called, true);
  });
});

// ── Self-registration (silo migration: TASK + onRunStart hook) ────────────────

describe('OntologyClassifier — self-registration on the global TaskRegistry', () => {
  it('registers the classify:ontology per-record task at module load', () => {
    assert.strictEqual(
      TaskRegistry.has(TASK_NAME),
      true,
      'classify:ontology task must be registered at module load',
    );
    assert.strictEqual(typeof TaskRegistry.get(TASK_NAME), 'function');
  });

  it('registers an onRunStart hook under the classify:ontology name', () => {
    const hookNames = TaskRegistry.onRunStartHooks().map(([n]) => n);
    assert.ok(
      hookNames.includes(TASK_NAME),
      `Expected an onRunStart hook named ${TASK_NAME}; got ${JSON.stringify(hookNames)}`,
    );
  });

  it('does NOT declare proposesClass (this classifier validates, never votes)', () => {
    const manifests = TaskRegistry.manifests();
    const taskManifest = manifests.find(m => m.name === TASK_NAME && m.phase === undefined);
    // The hook manifest entry will overwrite the task manifest under the same
    // name, so we may only see the phase: 'onRunStart' entry. Either way, the
    // validator must NOT carry proposesClass: true.
    const candidates = manifests.filter(m => m.name === TASK_NAME);
    assert.ok(candidates.length >= 1, 'classify:ontology must have at least one manifest entry');
    for (const m of candidates) {
      assert.notStrictEqual(
        m.proposesClass,
        true,
        `classify:ontology must not declare proposesClass: true (entry: ${JSON.stringify(m)})`,
      );
    }
    // Touch taskManifest to keep TS happy when the hook overwrite path elides it.
    void taskManifest;
  });

  it('exports an AJV schema fragment for the ontologyClassifier config namespace', () => {
    assert.strictEqual(typeof ontologyClassifierConfigSchema, 'object');
    assert.strictEqual(CONFIG_NAMESPACE, 'ontologyClassifier');
    assert.strictEqual(TASK_NAME, 'classify:ontology');
  });
});

// ── Self-registered onRunStart hook: config validation + class map freeze ─────

/** Builds a minimal context stub with a real AJV instance for hook tests. */
async function buildCtxStub(config: Record<string, unknown>): Promise<PipelineContextInterface> {
  const stub: Partial<PipelineContextInterface> & {
    target: string;
    outDir: string;
    config: Record<string, unknown>;
  } = {
    target: 'test-target',
    outDir: './graphs',
    config,
  };
  // Drive the context:ajv hook to populate stub.ajv.
  const ajvHook = TaskRegistry.onRunStartHooks().find(([n]) => n === 'context:ajv')?.[1];
  assert.ok(ajvHook, 'context:ajv hook must be registered for these tests');
  await ajvHook(stub as unknown as PipelineContextInterface);
  return stub as unknown as PipelineContextInterface;
}

/** Drives the classify:ontology onRunStart hook against a built ctx stub. */
async function runClassifyOntologyOnRunStart(ctx: PipelineContextInterface): Promise<void> {
  const hook = TaskRegistry.onRunStartHooks().find(([n]) => n === TASK_NAME)?.[1];
  assert.ok(hook, 'classify:ontology onRunStart hook must be registered');
  await hook(ctx);
}

describe('OntologyClassifier — onRunStart hook config validation', () => {
  beforeEach(() => {
    OntologyClassifier.resetForTests();
  });

  it('accepts a valid ontologyClassifier config block', async () => {
    const ctx = await buildCtxStub({
      [CONFIG_NAMESPACE]: {
        classes: {
          feat:  'https://squashage.dev/vocabulary/aonprd#Feat',
          spell: 'https://squashage.dev/vocabulary/aonprd#Spell',
        },
      },
    });
    await runClassifyOntologyOnRunStart(ctx);
    // No throw == accepted.
  });

  it('throws OutputConfigError when the namespace is missing entirely', async () => {
    const ctx = await buildCtxStub({});
    await assert.rejects(
      () => runClassifyOntologyOnRunStart(ctx),
      (err: unknown) => {
        assert.ok(err instanceof OutputConfigError, `Expected OutputConfigError, got ${String(err)}`);
        assert.match(err.message, /missing config namespace "ontologyClassifier"/);
        return true;
      },
    );
  });

  it('throws OutputConfigError when classes is empty', async () => {
    const ctx = await buildCtxStub({
      [CONFIG_NAMESPACE]: { classes: {} },
    });
    await assert.rejects(
      () => runClassifyOntologyOnRunStart(ctx),
      (err: unknown) => {
        assert.ok(err instanceof OutputConfigError, `Expected OutputConfigError, got ${String(err)}`);
        assert.match(err.message, /invalid "ontologyClassifier" config/);
        return true;
      },
    );
  });

  it('throws OutputConfigError when a class IRI is not a URI', async () => {
    const ctx = await buildCtxStub({
      [CONFIG_NAMESPACE]: { classes: { feat: 'not a uri at all' } },
    });
    await assert.rejects(
      () => runClassifyOntologyOnRunStart(ctx),
      (err: unknown) => {
        assert.ok(err instanceof OutputConfigError, `Expected OutputConfigError, got ${String(err)}`);
        return true;
      },
    );
  });

  it('throws OutputConfigError when classes has additional non-string entry', async () => {
    const ctx = await buildCtxStub({
      [CONFIG_NAMESPACE]: { classes: { feat: 123 } },
    });
    await assert.rejects(
      () => runClassifyOntologyOnRunStart(ctx),
      (err: unknown) => {
        assert.ok(err instanceof OutputConfigError, `Expected OutputConfigError, got ${String(err)}`);
        return true;
      },
    );
  });
});

// ── Self-registered task: end-to-end through onRunStart + per-record dispatch ─

describe('OntologyClassifier — registered task drives the cached class map', () => {
  beforeEach(() => {
    OntologyClassifier.resetForTests();
  });

  it('per-record task uses the class map populated by onRunStart', async () => {
    const ctx = await buildCtxStub({
      [CONFIG_NAMESPACE]: {
        classes: {
          feat: 'https://squashage.dev/vocabulary/aonprd#Feat',
        },
      },
    });
    await runClassifyOntologyOnRunStart(ctx);

    const task = TaskRegistry.get(TASK_NAME);
    const state = buildState([
      makeProposal('feat',     'classify:rules'),     // known
      makeProposal('mystery',  'classify:structural'), // unknown
    ]);
    const next = makeNext();

    await task(next.fn, state);

    const validations = state.classifications.filter(p => p.className === '__validation__');
    assert.strictEqual(validations.length, 1, 'one validation proposal for the unknown class');
    assert.strictEqual(validations[0]?.source, 'classify:ontology');
    assert.strictEqual(next.called, true);
  });

  it('per-record task throws fail-fast when invoked before onRunStart populates the map', async () => {
    OntologyClassifier.resetForTests();
    const task = TaskRegistry.get(TASK_NAME);
    const state = buildState([makeProposal('feat')]);
    const next = makeNext();

    await assert.rejects(
      () => task(next.fn, state),
      (err: unknown) => {
        assert.ok(err instanceof OutputConfigError, `Expected OutputConfigError, got ${String(err)}`);
        assert.match(err.message, /onRunStart populated the class map|ontologyClassifier\.classes/);
        return true;
      },
    );
  });
});

// ── Backward-compatibility: engine undefined uses legacy classes map ───────────

describe('OntologyClassifier — engine: undefined still uses legacy classes map', () => {
  it('proves engine: undefined still uses the legacy classes map for classification', async () => {
    // A config WITHOUT any ontology.engine field; only classification.ontology.classes.
    // This matches the v0.4.0 behavior: OntologyClassifier receives the classes map
    // from the classification config, not from a JsonTologyOntology instance.
    const legacyClassMap: OntologyConfigInterface = {
      classes: {
        feat:  'https://squashage.dev/vocabulary/aonprd#Feat',
        spell: 'https://squashage.dev/vocabulary/aonprd#Spell',
      },
    };
    const classifier = new OntologyClassifier(legacyClassMap);

    // A proposal for a known class in the legacy map passes without validation proposals.
    const state = buildState([makeProposal('feat', 'classify:rules')]);
    const next  = makeNext();

    await classifier.execute(next.fn, state);

    // No __validation__ proposals emitted: the legacy map recognized the class.
    assert.strictEqual(
      state.classifications.filter((p) => p.className === '__validation__').length,
      0,
      'Legacy classes map must recognize known className without validation proposals',
    );
    assert.strictEqual(next.called, true);
  });
});

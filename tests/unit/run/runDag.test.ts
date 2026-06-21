// Unit tests for runDag.
//
// Verifies that `runDag` can load a tiny synthetic DAG (built with DAGBuilder,
// round-tripped through DAGDocument.serialize → DAGDocument.load), execute it
// against a minimal RunState, and complete without touching the network.
//
// Single-DAG case: one TerminalNode — no plugin modules loaded because no
// SingleNode or ScatterNode placements exist. Minimal in-process smoke test.
//
// Bundle case: a two-DAG bundle — a child DAG (terminal-only) embedded in an
// outer DAG via embeddedDAG. The outer DAG is the root; the child must be
// registered first. Verifies bundle-format loading, root detection,
// topological registration order, and dispatch of the root.

import { describe, it } from 'node:test';
import assert            from 'node:assert/strict';
import { mkdtemp, rm }  from 'node:fs/promises';
import { tmpdir }        from 'node:os';
import { join }          from 'node:path';

import { DAGBuilder, DAGDocument } from '@studnicky/dagonizer';

import { runDag }            from '../../../src/run/runDag.js';
import { ScrapeState }       from '../../../src/state/ScrapeState.js';
import type { RunStateType } from '../../../src/types/RunState.js';

// ── DAG fixtures ───────────────────────────────────────────────────────────────

const SMOKE_DAG_NAME = 'test:smoke-dag';
const CHILD_DAG_NAME = 'test:bundle-child';
const OUTER_DAG_NAME = 'test:bundle-outer';

/**
 * Minimal single DAG for smoke testing: one TerminalNode as the entrypoint.
 *
 * No plugin nodes are referenced, so `registerFromDags` returns an empty set
 * and no module resolution occurs. This verifies the full `runDag` flow
 * (proxy-services construction, built-in registration, DAG registration,
 * dispatch, post-processing) without network or plugin I/O.
 *
 * Round-trip via `DAGDocument.serialize` → `DAGDocument.ofValue` validates
 * the serialization boundary, which is what a real `.dag.jsonld` file exercises.
 */
class SmokeDag {
  static build() {
    const dag = new DAGBuilder(SMOKE_DAG_NAME, '1.0')
      .terminal('done', { outcome: 'completed' })
      .build();

    return DAGDocument.ofValue(JSON.parse(DAGDocument.serialize(dag)) as unknown);
  }
}

/**
 * Two-DAG bundle: a child DAG (terminal-only) embedded by an outer DAG via
 * `embeddedDAG`. The outer DAG is the root; the child is a leaf.
 *
 * Bundle file format: a JSON array of two serialized DAGDocument objects.
 * Each element is exactly what `DAGDocument.serialize` emits.
 *
 * Registration order requirement: the child must be registered before the
 * outer DAG (dagonizer validates cross-DAG references at registerDAG time).
 * `runDag` discovers the root (outer, unreferenced), topologically sorts
 * leaves-first, and registers in that order.
 */
class BundleDags {
  static build() {
    // Child DAG: single terminal node, completes immediately.
    const childDag = new DAGBuilder(CHILD_DAG_NAME, '1.0')
      .terminal('child-done', { outcome: 'completed' })
      .build();

    // Outer DAG: embeds the child, then terminates.
    const outerDag = new DAGBuilder(OUTER_DAG_NAME, '1.0')
      .embeddedDAG('invoke-child', CHILD_DAG_NAME, {
        success: 'outer-done',
        error:   'outer-done',
      })
      .terminal('outer-done', { outcome: 'completed' })
      .build();

    // Serialize both to JSON objects (as a real .dag.jsonld bundle would be).
    const childJson = JSON.parse(DAGDocument.serialize(childDag)) as unknown;
    const outerJson = JSON.parse(DAGDocument.serialize(outerDag)) as unknown;

    // Validate through DAGDocument to get DAGType values.
    return [
      DAGDocument.ofValue(childJson),
      DAGDocument.ofValue(outerJson),
    ];
  }
}

// ── RunState fixture ───────────────────────────────────────────────────────────

const MINIMAL_STATE: RunStateType = {
  output: { basePath: '/tmp/ripper-rundag-test' },
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('runDag', () => {
  it('dispatches a terminal-only single-DAG bundle to completion without network or plugins', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'ripper-rundag-'));
    try {
      const dag = SmokeDag.build();
      assert.equal(dag.name, SMOKE_DAG_NAME, 'DAGDocument round-trip should preserve dag name');
      assert.equal(dag.entrypoint, 'done', 'entrypoint should be the terminal placement');

      await assert.doesNotReject(async () => {
        await runDag({ dags: [dag], state: MINIMAL_STATE, outDir, configDir: '.' });
      });
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it('does not write failures.json when no pages fail', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'ripper-rundag-'));
    try {
      const dag = SmokeDag.build();
      await runDag({ dags: [dag], state: MINIMAL_STATE, outDir, configDir: '.' });

      const { access } = await import('node:fs/promises');
      const failuresPath = join(outDir, 'failures.json');
      await assert.rejects(
        async () => access(failuresPath),
        'failures.json should not exist when failedAfterRetry is empty',
      );
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it('resolves within 2 s for a stub DAG (no network)', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'ripper-rundag-'));
    try {
      const dag   = SmokeDag.build();
      const start = Date.now();
      await runDag({ dags: [dag], state: MINIMAL_STATE, outDir, configDir: '.' });
      assert.ok(Date.now() - start < 2000, 'runDag should complete quickly for a terminal-only DAG');
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it('ScrapeState.params defaults to undefined in the legacy path', () => {
    // Non-breaking guard: new field must not affect legacy ScrapeState construction.
    const s = new ScrapeState();
    assert.equal(s.params, undefined, 'params should be undefined by default');
  });

  it('dispatches a two-DAG bundle: registers child before outer and dispatches the root', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'ripper-rundag-bundle-'));
    try {
      // Build both DAGs — outer references child via embeddedDAG.
      // Pass them in reverse order (outer first, child second) to verify that
      // runDag reorders them correctly (child must be registered first).
      const [childDag, outerDag] = BundleDags.build();

      assert.equal(childDag?.name, CHILD_DAG_NAME, 'child DAG name preserved');
      assert.equal(outerDag?.name, OUTER_DAG_NAME, 'outer DAG name preserved');

      // Pass outer first to prove runDag topologically reorders, not relies on input order.
      const bundle = [outerDag!, childDag!];

      await assert.doesNotReject(async () => {
        await runDag({ dags: bundle, state: MINIMAL_STATE, outDir, configDir: '.' });
      }, 'two-DAG bundle with embeddedDAG should execute without error');

      // No failures expected from a pure terminal-only bundle.
      const { access } = await import('node:fs/promises');
      const failuresPath = join(outDir, 'failures.json');
      await assert.rejects(
        async () => access(failuresPath),
        'failures.json should not exist for a bundle with no scrape failures',
      );
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

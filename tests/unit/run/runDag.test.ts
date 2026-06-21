// Unit tests for runDag.
//
// Verifies that `runDag` can load a tiny synthetic DAG (built with DAGBuilder,
// round-tripped through DAGDocument.serialize → DAGDocument.load), execute it
// against a minimal RunState, and complete without touching the network.
//
// The DAG contains only a TerminalNode: no plugin modules are loaded because no
// SingleNode or ScatterNode placements exist. This is the minimal in-process
// smoke test — no network, no file system reads beyond the outDir mkdir.

import { describe, it } from 'node:test';
import assert            from 'node:assert/strict';
import { mkdtemp, rm }  from 'node:fs/promises';
import { tmpdir }        from 'node:os';
import { join }          from 'node:path';

import { DAGBuilder, DAGDocument } from '@studnicky/dagonizer';

import { runDag }            from '../../../src/run/runDag.js';
import { ScrapeState }       from '../../../src/state/ScrapeState.js';
import type { RunStateType } from '../../../src/types/RunState.js';

// RunDagOptions namespace is not needed in the test — RunStateType is sufficient.

// ── DAG fixture ────────────────────────────────────────────────────────────────

const SMOKE_DAG_NAME = 'test:smoke-dag';

/**
 * Minimal DAG for smoke testing: one TerminalNode as the entrypoint.
 *
 * No plugin nodes are referenced, so `registerFromDag` returns an empty set
 * and no module resolution occurs. This verifies the full `runDag` flow
 * (proxy-services construction, built-in registration, DAG registration,
 * dispatch, post-processing) without network or plugin I/O.
 *
 * Round-trip via `DAGDocument.serialize` → `DAGDocument.load` validates
 * the serialization boundary, which is what a real `.dag.jsonld` file exercises.
 */
class SmokeDag {
  static build() {
    const dag = new DAGBuilder(SMOKE_DAG_NAME, '1.0')
      .terminal('done', { outcome: 'completed' })
      .build();

    return DAGDocument.load(DAGDocument.serialize(dag));
  }
}

// ── RunState fixture ───────────────────────────────────────────────────────────

const MINIMAL_STATE: RunStateType = {
  output: { basePath: '/tmp/ripper-rundag-test' },
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('runDag', () => {
  it('dispatches a terminal-only DAG to completion without network or plugins', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'ripper-rundag-'));
    try {
      const dag = SmokeDag.build();
      assert.equal(dag.name, SMOKE_DAG_NAME, 'DAGDocument round-trip should preserve dag name');
      assert.equal(dag.entrypoint, 'done', 'entrypoint should be the terminal placement');

      await assert.doesNotReject(async () => {
        await runDag({ dag, state: MINIMAL_STATE, outDir, configDir: '.' });
      });
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it('does not write failures.json when no pages fail', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'ripper-rundag-'));
    try {
      const dag = SmokeDag.build();
      await runDag({ dag, state: MINIMAL_STATE, outDir, configDir: '.' });

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
      await runDag({ dag, state: MINIMAL_STATE, outDir, configDir: '.' });
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
});

/**
 * @fileoverview Unit tests for {@link SquashageOrchestrator}.
 *
 * @remarks
 * Exercises the run-wide context construction, per-record pipeline dispatch,
 * drain-then-finalize lifecycle, and {@link RunResultInterface} computation
 * across four scenarios:
 *
 * 1. Happy path: 2 input `.json` files, a fixture:squash task that emits one
 *    quad per record, verified by parsing the Turtle output.
 * 2. Failure case: pipeline references an unregistered task; `TaskRegistry.get`
 *    throws `ExternalSchemaError` before any record is processed.
 * 3. Empty input directory: `recordCount === 0`, output file is empty/written.
 * 4. Missing target: `SquashageConfigError` is thrown before the walk phase.
 *
 * @category Orchestrator
 * @since 0.1.0
 */

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  readFile,
  access,
} from 'node:fs/promises';
import { tmpdir }        from 'node:os';
import { join }          from 'node:path';

import { SquashageOrchestrator } from '../../../src/orchestrators/SquashageOrchestrator.js';
import { TaskRegistry }          from '../../../src/registry/TaskRegistry.js';
import { ExternalSchemaError }   from '../../../src/errors/ExternalSchemaError.js';
import { SquashageConfigError }  from '../../../src/errors/SquashageConfigError.js';
import { dataFactory }           from '../../../src/rdf/DataFactory.js';
import { Parser }                from '../../../src/rdf/Parser.js';
import type { SquashageConfigInterface } from '../../../src/config/SquashageConfig.js';
import type { PipelineStateInterface }   from '../../../src/types/PipelineState.js';
import type { NextFnInterface }          from '../../../src/types/Pipeline.js';

// ---------------------------------------------------------------------------
// Fixture task registration
// ---------------------------------------------------------------------------

/** Name for the per-test squash fixture task. */
const FIXTURE_TASK_NAME = 'fixture:squash';

/**
 * Registers `fixture:squash` — emits one quad per record into the shared dataset.
 * Called once at suite setup; idempotent due to TaskRegistry overwriting existing tasks.
 */
function registerFixtureTask(): void {
  TaskRegistry.register(
    FIXTURE_TASK_NAME,
    async (next: NextFnInterface, state: PipelineStateInterface): Promise<void> => {
      const ctx = state.context;
      if (ctx !== undefined) {
        const subject   = dataFactory.namedNode(`https://example.org/record/${state.source.path.replace(/[^a-z0-9]/gi, '_')}`);
        const predicate = dataFactory.namedNode('https://schema.org/name');
        const object    = typeof state.input['name'] === 'string'
          ? dataFactory.literal(state.input['name'])
          : dataFactory.literal('unknown');
        ctx.dataset.add(dataFactory.quad(subject, predicate, object));
      }
      await next();
    },
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a minimal SquashageConfigInterface for testing. */
const buildConfig = (
  inputDir:    string,
  outputPath:  string,
  pipeline:    string[] = ['json:read', FIXTURE_TASK_NAME, 'rdfjs:finalize'],
): SquashageConfigInterface => ({
  input: { basePath: inputDir, format: 'json' },
  targets: {
    target1: {
      input:    inputDir,
      pipeline,
      output:   { kind: 'file', path: outputPath },
    },
  },
});

// ---------------------------------------------------------------------------
// Suite-level setup
// ---------------------------------------------------------------------------

let workDir = '';

before(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'squashage-orchestrator-'));
  registerFixtureTask();
});

after(async () => {
  await rm(workDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SquashageOrchestrator', () => {

  describe('run — happy path (2 JSON records)', () => {
    let runDir = '';

    before(async () => {
      runDir = join(workDir, 'happy');
      await mkdir(runDir, { recursive: true });

      await writeFile(join(runDir, 'record1.json'),
        JSON.stringify({ _type: 'thing', name: 'Alpha' }),
        'utf8',
      );
      await writeFile(join(runDir, 'record2.json'),
        JSON.stringify({ _type: 'thing', name: 'Beta' }),
        'utf8',
      );
    });

    it('returns recordCount === 2, succeeded === 2, failed === 0', async () => {
      const outDir = join(workDir, 'happy-out');
      await mkdir(outDir, { recursive: true });
      const outPath = join(outDir, 'out.ttl');
      const config  = buildConfig(runDir, outPath);

      const result = await SquashageOrchestrator.run(config, 'target1', { outDir });

      assert.equal(result.recordCount, 2);
      assert.equal(result.succeeded,   2);
      assert.equal(result.failed,      0);
    });

    it('outputPath exists on disk', async () => {
      const outDir  = join(workDir, 'happy-out2');
      await mkdir(outDir, { recursive: true });
      const outPath = join(outDir, 'out.ttl');
      const config  = buildConfig(runDir, outPath);

      await SquashageOrchestrator.run(config, 'target1', { outDir });

      await access(outPath);  // throws if not found
    });

    it('output Turtle file parses back to exactly 2 quads', async () => {
      const outDir  = join(workDir, 'happy-parse');
      await mkdir(outDir, { recursive: true });
      const outPath = join(outDir, 'out.ttl');
      const config  = buildConfig(runDir, outPath);

      await SquashageOrchestrator.run(config, 'target1', { outDir });

      const text = await readFile(outPath, 'utf8');
      const { quads } = await Parser.parse(text, { format: 'turtle' });
      assert.equal(quads.length, 2);
    });

    it('quarantine is all zeros', async () => {
      const outDir  = join(workDir, 'happy-quarantine');
      await mkdir(outDir, { recursive: true });
      const outPath = join(outDir, 'out.ttl');
      const config  = buildConfig(runDir, outPath);

      const result = await SquashageOrchestrator.run(config, 'target1', { outDir });

      assert.equal(result.quarantine.unknown,    0);
      assert.equal(result.quarantine.conflicts,  0);
      assert.equal(result.quarantine.projection, 0);
      assert.equal(result.quarantine.output,     0);
    });

    it('exitCode is 0', async () => {
      const outDir  = join(workDir, 'happy-exit');
      await mkdir(outDir, { recursive: true });
      const outPath = join(outDir, 'out.ttl');
      const config  = buildConfig(runDir, outPath);

      const result = await SquashageOrchestrator.run(config, 'target1', { outDir });

      assert.equal(result.exitCode, 0);
    });
  });

  describe('run — failure: unregistered task throws ExternalSchemaError', () => {
    it('throws ExternalSchemaError when pipeline contains broken:task', async () => {
      const outDir  = join(workDir, 'broken-task');
      await mkdir(outDir, { recursive: true });
      const outPath = join(outDir, 'out.ttl');
      const config  = buildConfig(outDir, outPath, ['json:read', 'broken:task', 'rdfjs:finalize']);

      await assert.rejects(
        () => SquashageOrchestrator.run(config, 'target1', { outDir }),
        (err: unknown) => err instanceof ExternalSchemaError,
      );
    });
  });

  describe('run — empty input directory', () => {
    it('returns recordCount === 0', async () => {
      const emptyDir = join(workDir, 'empty-in');
      const outDir   = join(workDir, 'empty-out');
      await mkdir(emptyDir, { recursive: true });
      await mkdir(outDir,   { recursive: true });
      const outPath  = join(outDir, 'out.ttl');
      const config   = buildConfig(emptyDir, outPath);

      const result = await SquashageOrchestrator.run(config, 'target1', { outDir });

      assert.equal(result.recordCount, 0);
    });

    it('output file is still created (empty serialization)', async () => {
      const emptyDir = join(workDir, 'empty-in2');
      const outDir   = join(workDir, 'empty-out2');
      await mkdir(emptyDir, { recursive: true });
      await mkdir(outDir,   { recursive: true });
      const outPath  = join(outDir, 'out.ttl');
      const config   = buildConfig(emptyDir, outPath);

      await SquashageOrchestrator.run(config, 'target1', { outDir });

      // File exists (rdfjs:finalize writes even for 0 quads).
      await access(outPath);
    });
  });

  describe('run — missing target throws SquashageConfigError', () => {
    it('throws SquashageConfigError for unknown target', async () => {
      const outDir = join(workDir, 'missing-target');
      await mkdir(outDir, { recursive: true });
      const config = buildConfig(outDir, join(outDir, 'out.ttl'));

      await assert.rejects(
        () => SquashageOrchestrator.run(config, 'does-not-exist', { outDir }),
        (err: unknown) => err instanceof SquashageConfigError,
      );
    });
  });
});

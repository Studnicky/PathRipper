// Unit tests for committed single-orchestration .dag.jsonld fixtures.
//
// Loads each committed .dag.jsonld via DAGDocument.load and asserts:
//   1. The file parses as a single DAGDocument (not an array bundle).
//   2. The DAG has a non-empty name and at least one node.
//   3. RunStateSchema.validate(state) returns null for the companion .state.json.
//
// No dispatcher, no network, no plugin execution.
// These tests are structural guards — they verify every committed fixture is a
// valid single-orchestration document before the runtime consumes it.

import { describe, it } from 'node:test';
import assert            from 'node:assert/strict';
import { readFile }      from 'node:fs/promises';
import { resolve }       from 'node:path';

import { DAGDocument }   from '@studnicky/dagonizer';
import type { DAGType }  from '@studnicky/dagonizer';

import { RunStateSchema } from '../../../src/schemas/internal/RunStateSchema.js';

// ── Repo root (two levels up from tests/unit/run/) ─────────────────────────────

const ROOT = resolve(import.meta.dirname, '..', '..', '..');

// ── DagFixture ────────────────────────────────────────────────────────────────

/**
 * Loads a single-orchestration .dag.jsonld + .state.json pair from disk.
 *
 * The .dag.jsonld must be a single DAGDocument (not a JSON array).
 * DAGDocument.load is used — it rejects array bundles.
 */
class DagFixture {
  static async load(relPath: string): Promise<{ dag: DAGType; state: unknown }> {
    const dagPath   = resolve(ROOT, `${relPath}.dag.jsonld`);
    const statePath = resolve(ROOT, `${relPath}.state.json`);

    const dagRaw   = await readFile(dagPath,   'utf8');
    const stateRaw = await readFile(statePath, 'utf8');

    const dag   = DAGDocument.load(dagRaw);
    const state = JSON.parse(stateRaw) as unknown;

    return { dag, state };
  }
}

// ── Test fixtures ──────────────────────────────────────────────────────────────

const FIXTURES: ReadonlyArray<{ label: string; path: string }> = [
  { label: 'examples/docs-scraper (html no-crawl, docs:page)',           path: 'examples/docs-scraper/ripperoni-docs' },
  { label: 'examples/wiki-docs (wiki, wiki:page)',                        path: 'examples/wiki-docs/ripperoni-wiki' },
  { label: 'tests/e2e/fixtures/aonprd-crawler (html-crawl, aonprd:page)', path: 'tests/e2e/fixtures/aonprd-crawler' },
  { label: 'ripperoni.example (html no-crawl, template)',                 path: 'ripperoni.example' },
  { label: 'aonprd (html-crawl, aonprd:page canonical)',                  path: 'aonprd' },
];

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('dag fixtures — single-orchestration documents', () => {
  for (const fixture of FIXTURES) {
    describe(fixture.label, () => {
      it('loads .dag.jsonld as a single DAGDocument via DAGDocument.load', async () => {
        const { dag } = await DagFixture.load(fixture.path);
        assert.ok(typeof dag.name === 'string' && dag.name.length > 0, `dag.name must be non-empty, got: ${String(dag.name)}`);
        assert.ok(dag.nodes.length > 0, 'DAG must have at least one node');
      });

      it('RunStateSchema.validate(state) returns null', async () => {
        const { state } = await DagFixture.load(fixture.path);
        const errors = RunStateSchema.validate(state);
        assert.equal(errors, null, `RunState validation failed: ${errors ?? ''}`);
      });
    });
  }
});

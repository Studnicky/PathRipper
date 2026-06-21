// Unit tests for generated DAG bundle + RunState pairs.
//
// Loads each committed .dag.jsonld + .state.json pair from disk and asserts:
//   1. The .dag.jsonld parses as a JSON array.
//   2. Each element is a valid DAGDocument (DAGDocument.ofValue does not throw).
//   3. Exactly one root DAG exists (not referenced by any other element in the bundle).
//   4. RunStateSchema.validate(state) returns null.
//
// No dispatcher, no network, no plugin execution.
// These tests are structural guards — they verify the generator output is
// well-formed before the runtime consumes it.

import { describe, it } from 'node:test';
import assert            from 'node:assert/strict';
import { readFile }      from 'node:fs/promises';
import { resolve }       from 'node:path';

import { DAGDocument }   from '@studnicky/dagonizer';
import type { DAGType }  from '@studnicky/dagonizer';

import { RunStateSchema } from '../../../src/schemas/internal/RunStateSchema.js';

// ── Repo root (two levels up from tests/unit/run/) ─────────────────────────────

const ROOT = resolve(import.meta.dirname, '..', '..', '..');

// ── BundleFixture ─────────────────────────────────────────────────────────────

/**
 * Loads and validates a .dag.jsonld + .state.json pair from disk.
 *
 * The .dag.jsonld is a JSON array of serialized DAGDocument objects.
 * Each element is validated through DAGDocument.ofValue.
 *
 * Root detection follows the same logic as runDag: a root DAG is any DAG whose
 * name is not referenced by any other DAG in the bundle (via EmbeddedDAGNode.dag
 * or ScatterNode.body.dag).
 */
class BundleFixture {
  static async load(relPath: string): Promise<{ dags: DAGType[]; state: unknown }> {
    const dagPath   = resolve(ROOT, `${relPath}.dag.jsonld`);
    const statePath = resolve(ROOT, `${relPath}.state.json`);

    const dagRaw   = await readFile(dagPath,   'utf8');
    const stateRaw = await readFile(statePath, 'utf8');

    const dagArray = JSON.parse(dagRaw) as unknown;
    const state    = JSON.parse(stateRaw) as unknown;

    assert.ok(Array.isArray(dagArray), `${relPath}.dag.jsonld must be a JSON array`);

    const dags = (dagArray as unknown[]).map((element, index) => {
      return DAGDocument.ofValue(element as unknown);
    });

    return { dags, state };
  }

  static rootOf(dags: DAGType[]): DAGType {
    const allNames   = new Set(dags.map((d) => d.name));
    const referenced = new Set<string>();

    for (const dag of dags) {
      for (const node of dag.nodes) {
        if (node['@type'] === 'EmbeddedDAGNode') {
          const ref = (node as { dag?: string }).dag;
          if (typeof ref === 'string' && allNames.has(ref)) {
            referenced.add(ref);
          }
        } else if (node['@type'] === 'ScatterNode') {
          const bodyDag = (node as { body?: { dag?: string } }).body?.dag;
          if (typeof bodyDag === 'string' && allNames.has(bodyDag)) {
            referenced.add(bodyDag);
          }
        }
      }
    }

    const roots = dags.filter((d) => !referenced.has(d.name));
    assert.equal(roots.length, 1, `Expected exactly 1 root DAG, found ${roots.length}: [${roots.map((d) => d.name).join(', ')}]`);

    return roots[0] as DAGType;
  }
}

// ── Test pairs ─────────────────────────────────────────────────────────────────

const PAIRS: ReadonlyArray<{ label: string; path: string }> = [
  { label: 'examples/docs-scraper (html no-crawl, docs:parse)',         path: 'examples/docs-scraper/ripperoni-docs' },
  { label: 'examples/wiki-docs (wiki, wiki-docs:parse)',                 path: 'examples/wiki-docs/ripperoni-wiki' },
  { label: 'tests/e2e/fixtures/aonprd-crawler (html-crawl, aonprd:parse)', path: 'tests/e2e/fixtures/aonprd-crawler' },
  { label: 'ripperoni.config.example.json (html no-crawl, example)',    path: 'ripperoni.example' },
  { label: 'aonprd.config.json (html-crawl, aonprd:parse)',             path: 'aonprd' },
];

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('generatedDags', () => {
  for (const pair of PAIRS) {
    describe(pair.label, () => {
      it('parses .dag.jsonld as a valid DAGDocument array', async () => {
        const { dags } = await BundleFixture.load(pair.path);
        assert.ok(dags.length > 0, 'bundle must contain at least one DAG');
        for (const dag of dags) {
          assert.ok(typeof dag.name === 'string' && dag.name.length > 0, `dag.name must be a non-empty string, got: ${dag.name}`);
        }
      });

      it('has exactly one root DAG (unreferenced by others in the bundle)', async () => {
        const { dags } = await BundleFixture.load(pair.path);
        const root = BundleFixture.rootOf(dags);
        assert.ok(typeof root.name === 'string' && root.name.length > 0, 'root.name must be a non-empty string');
      });

      it('RunStateSchema.validate(state) returns null', async () => {
        const { state } = await BundleFixture.load(pair.path);
        const errors = RunStateSchema.validate(state);
        assert.equal(errors, null, `RunState validation failed: ${errors ?? ''}`);
      });
    });
  }
});

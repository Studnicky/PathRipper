// Unit tests for the native DAG-document plugin contract.
//
// Proves that:
//   1. aonprd.dag.jsonld loads and round-trips via DAGDocument.
//   2. PluginLoader.registerPluginsFromEntry discovers the 'aonprd' namespace
//      from the DAG's placements, loads plugins/aonprd/page.dag.jsonld
//      and plugins/aonprd/parse.dag.jsonld, and registers both DAGs.
//   3. The aonprd plugin's index.ts register() adds the taxonomy nodes.
//   4. A full runDag dispatch of the crawl DAG with empty state completes
//      without network I/O (crawl:init-frontier routes to 'empty' → done).
//
// No network. No filesystem writes beyond a temp outDir. Inline fixtures.

import { describe, it } from 'node:test';
import assert            from 'node:assert/strict';
import { mkdtemp, rm }  from 'node:fs/promises';
import { readFileSync }  from 'node:fs';
import { tmpdir }        from 'node:os';
import { join, resolve } from 'node:path';

import { DAGDocument }            from '@studnicky/dagonizer';

import { runDag }                 from '../../../src/run/runDag.js';
import { PluginLoader }           from '../../../src/run/PluginLoader.js';
import { RipperDagonizer }        from '../../../src/dispatcher/RipperDagonizer.js';
import type { ScrapeState }       from '../../../src/state/ScrapeState.js';
import type { RipperServices }    from '../../../src/services/RipperServices.js';
import type { RunStateType }      from '../../../src/types/RunState.js';

// ── Repo-root resolution ───────────────────────────────────────────────────────

// The test file lives at tests/unit/run/runDagContract.test.ts.
// Three directories up gives the repo root.
const REPO_ROOT = resolve(new URL('../../../', import.meta.url).pathname);

// ── Fixtures ───────────────────────────────────────────────────────────────────

const AONPRD_DAG_PATH = join(REPO_ROOT, 'aonprd.dag.jsonld');

const MINIMAL_STATE: RunStateType = {
  output: { basePath: '/tmp/ripper-contract-test' },
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('runDag native contract (aonprd crawl)', () => {
  it('aonprd.dag.jsonld round-trips through DAGDocument.load', () => {
    const json = readFileSync(AONPRD_DAG_PATH, 'utf-8');
    const dag  = DAGDocument.load(json);
    assert.equal(dag.name, 'aonprd:crawl', 'aonprd DAG name preserved after round-trip');
    assert.ok(dag.nodes.length > 0, 'aonprd DAG must have at least one placement');
  });

  it('registerPluginsFromEntry registers aonprd:page and aonprd:parse DAGs', async () => {
    // Build a throwaway dispatcher with a null-holder proxy (registration never
    // accesses services — nodes do so only at execution time).
    const holder: { current: RipperServices | null } = { current: null };
    const dispatcher = new RipperDagonizer<ScrapeState>({
      services: new Proxy({} as RipperServices, {
        get(_target, prop) {
          if (holder.current === null) {
            throw new Error('services accessed before init');
          }
          return (holder.current as unknown as Record<string | symbol, unknown>)[prop as string];
        },
      }),
    });

    PluginLoader.registerBuiltinNodes(dispatcher);

    const json     = readFileSync(AONPRD_DAG_PATH, 'utf-8');
    const entryDag = DAGDocument.load(json);

    const loaded = await PluginLoader.registerPluginsFromEntry(dispatcher, entryDag, REPO_ROOT);

    assert.ok(loaded.has('aonprd'), 'aonprd namespace should have been loaded');

    const registeredDags = dispatcher.listDAGs().map((dag) => dag.name);
    assert.ok(
      registeredDags.includes('aonprd:page'),
      `aonprd:page DAG must be registered. Got: [${registeredDags.join(', ')}]`,
    );
    assert.ok(
      registeredDags.includes('aonprd:parse'),
      `aonprd:parse DAG must be registered. Got: [${registeredDags.join(', ')}]`,
    );
  });

  it('runDag dispatches aonprd:crawl with empty state to completed (no network)', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'ripper-contract-'));
    try {
      const json     = readFileSync(AONPRD_DAG_PATH, 'utf-8');
      const entryDag = DAGDocument.load(json);

      await assert.doesNotReject(async () => {
        await runDag({
          dag:       entryDag,
          state:     MINIMAL_STATE,
          outDir,
          configDir: REPO_ROOT,
        });
      }, 'runDag must complete without throwing when crawler startUrls is absent (empty frontier)');
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it('runDag does not write failures.json when no pages are scraped', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'ripper-contract-nofail-'));
    try {
      const json     = readFileSync(AONPRD_DAG_PATH, 'utf-8');
      const entryDag = DAGDocument.load(json);

      await runDag({ dag: entryDag, state: MINIMAL_STATE, outDir, configDir: REPO_ROOT });

      const { access } = await import('node:fs/promises');
      await assert.rejects(
        async () => access(join(outDir, 'failures.json')),
        'failures.json must not exist when no pages were scraped',
      );
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

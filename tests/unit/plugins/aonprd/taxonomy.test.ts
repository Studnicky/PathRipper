// Unit tests for the Taxonomy compiler.
// Validates the public API of Taxonomy.compile() and the generated nodes.
import { describe, it } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { RoutedBatchBuilder, Timeout } from '@studnicky/dagonizer';
import type { NodeContextType } from '@studnicky/dagonizer';

import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import { Taxonomy, TaxonomyError } from '../../../../plugins/aonprd/taxonomy.js';
import type { ConceptDecl, CapabilityNode } from '../../../../plugins/aonprd/taxonomy.js';

// ─── Stub capability nodes for tests ─────────────────────────────────────────
// Each stub has a distinct name and outputs: ['success', 'error'] — the minimum
// required for Taxonomy.compile to accept them.

function makeStubCap(name: string): CapabilityNode {
  return {
    name,
    outputs:  ['success', 'error'] as const,
    timeout:  Timeout.none(),
    async execute(
      batch: Batch<ScrapeState>,
      _ctx:  NodeContextType,
    ): Promise<ReturnType<typeof RoutedBatchBuilder.of<'success', ScrapeState>>> {
      return RoutedBatchBuilder.of('success', batch);
    },
  };
}

const identityNode     = makeStubCap('extract:identity');
const sourceRefNode    = makeStubCap('extract:source-ref-stub');
const labelPairNode    = makeStubCap('extract:label-pair-stub');
const weaponMechNode   = makeStubCap('extract:weapon-mechanics-stub');
const spellCastNode    = makeStubCap('extract:spell-cast-stub');

// ─── Test 1: Empty taxonomy ───────────────────────────────────────────────────

describe('Taxonomy — empty taxonomy', () => {
  it('compiles without throwing', () => {
    assert.doesNotThrow(() => Taxonomy.compile([]));
  });

  it('buildDAG succeeds on empty taxonomy (primary acceptance)', () => {
    const taxonomy = Taxonomy.compile([]);
    assert.doesNotThrow(() => {
      const dag = taxonomy.buildDAG('test-empty', '0.1');
      assert.equal(typeof dag, 'object', 'buildDAG should return an object');
      assert.ok(dag !== null, 'buildDAG should return a non-null DAG');
      assert.equal(dag.name, 'test-empty');
    });
  });

  it('routeUrl always returns null for empty taxonomy', () => {
    const taxonomy = Taxonomy.compile([]);
    assert.equal(taxonomy.routeUrl('https://2e.aonprd.com/Spells.aspx?ID=1'), null);
    assert.equal(taxonomy.routeUrl('https://2e.aonprd.com/Monsters.aspx?ID=99'), null);
    assert.equal(taxonomy.routeUrl('https://example.com/no-aspx'), null);
  });

  it('chainFor returns empty array for unknown concept', () => {
    const taxonomy = Taxonomy.compile([]);
    assert.deepEqual(taxonomy.chainFor('anything'), []);
  });

  it('conceptIds returns empty array', () => {
    const taxonomy = Taxonomy.compile([]);
    assert.deepEqual(taxonomy.conceptIds(), []);
  });

  it('leafConceptIds returns empty array', () => {
    const taxonomy = Taxonomy.compile([]);
    assert.deepEqual(taxonomy.leafConceptIds(), []);
  });

  it('allNodes contains router and concept-dispatch only for empty taxonomy', () => {
    const taxonomy = Taxonomy.compile([]);
    const names = taxonomy.allNodes().map((node) => node.name);
    assert.ok(names.includes('aonprd:taxonomy-route'),   'must include router');
    assert.ok(names.includes('aonprd:concept-dispatch'), 'must include concept-dispatch');
    assert.equal(names.length, 2, 'empty taxonomy has exactly 2 nodes (router + concept-dispatch)');
  });
});

// ─── Test 2: Router node against empty taxonomy ───────────────────────────────

describe('Taxonomy — router node behaviour (empty taxonomy)', () => {
  it('router node returns unknown for any URL', async () => {
    const taxonomy      = Taxonomy.compile([]);
    const router = taxonomy.allNodes().find((node) => node.name === 'aonprd:taxonomy-route');
    assert.ok(router !== undefined, 'router node must exist');

    const fakeState = {
      page: { url: 'https://2e.aonprd.com/Spells.aspx?ID=1', html: '', targetId: 'aonprd', title: '' },
      getMetadata: () => undefined,
      setMetadata: () => undefined,
      output: null,
    } as unknown as ScrapeState;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await router.execute(Batch.of(fakeState), { services: {} } as any);
    assert.ok(result.has('unknown'));
  });
});

// ─── Test 3: Single-concept taxonomy ─────────────────────────────────────────

describe('Taxonomy — single-concept taxonomy', () => {
  const concepts: readonly ConceptDecl[] = [
    {
      id:           'spell',
      parent:       null,
      urlPaths:     ['spells'],
      capabilities: [spellCastNode],
    },
  ];

  it('compiles without throwing', () => {
    assert.doesNotThrow(() => Taxonomy.compile(concepts));
  });

  it('routeUrl returns concept id for matching URL', () => {
    const taxonomy = Taxonomy.compile(concepts);
    assert.equal(taxonomy.routeUrl('https://2e.aonprd.com/Spells.aspx?ID=1'), 'spell');
  });

  it('routeUrl returns null for non-matching URL', () => {
    const taxonomy = Taxonomy.compile(concepts);
    assert.equal(taxonomy.routeUrl('https://2e.aonprd.com/Monsters.aspx?ID=1'), null);
  });

  it('chainFor returns the root capabilities', () => {
    const taxonomy     = Taxonomy.compile(concepts);
    const chain = taxonomy.chainFor('spell');
    assert.equal(chain.length, 1);
    assert.equal(chain[0]?.name, 'extract:spell-cast-stub');
  });

  it('buildDAG succeeds for single-concept taxonomy', () => {
    // Single-concept topology: router → spell capability → terminal.
    // No concept-dispatch node is created (only one leaf).
    const taxonomy = Taxonomy.compile(concepts);
    assert.doesNotThrow(() => {
      const dag = taxonomy.buildDAG('test-single', '0.1');
      assert.equal(dag.name, 'test-single');
    });
  });

  it('conceptIds includes the concept', () => {
    const taxonomy = Taxonomy.compile(concepts);
    assert.deepEqual(taxonomy.conceptIds(), ['spell']);
  });

  it('leafConceptIds includes the concept', () => {
    const taxonomy = Taxonomy.compile(concepts);
    assert.deepEqual(taxonomy.leafConceptIds(), ['spell']);
  });
});

// ─── Test 4: Three-level inheritance ─────────────────────────────────────────

describe('Taxonomy — three-level inheritance chain', () => {
  // thing (identity, sourceRef) → item (labelPair) → weapon (weaponMech)
  const concepts: readonly ConceptDecl[] = [
    {
      id:           'thing',
      parent:       null,
      capabilities: [identityNode, sourceRefNode],
    },
    {
      id:           'item',
      parent:       'thing',
      capabilities: [labelPairNode],
    },
    {
      id:           'weapon',
      parent:       'item',
      urlPaths:     ['weapons'],
      capabilities: [weaponMechNode],
    },
  ];

  it('compiles without throwing', () => {
    assert.doesNotThrow(() => Taxonomy.compile(concepts));
  });

  it('chainFor("weapon") returns capabilities in root-first order', () => {
    const taxonomy     = Taxonomy.compile(concepts);
    const chain = taxonomy.chainFor('weapon');
    const names = chain.map((node) => node.name);
    assert.deepEqual(names, [
      'extract:identity',
      'extract:source-ref-stub',
      'extract:label-pair-stub',
      'extract:weapon-mechanics-stub',
    ]);
  });

  it('chainFor("item") returns root + item capabilities only', () => {
    const taxonomy     = Taxonomy.compile(concepts);
    const chain = taxonomy.chainFor('item');
    const names = chain.map((node) => node.name);
    assert.deepEqual(names, [
      'extract:identity',
      'extract:source-ref-stub',
      'extract:label-pair-stub',
    ]);
  });

  it('chainFor("thing") returns only root capabilities', () => {
    const taxonomy     = Taxonomy.compile(concepts);
    const chain = taxonomy.chainFor('thing');
    const names = chain.map((node) => node.name);
    assert.deepEqual(names, [
      'extract:identity',
      'extract:source-ref-stub',
    ]);
  });

  it('leafConceptIds contains only weapon (the only concept with urlPaths)', () => {
    const taxonomy = Taxonomy.compile(concepts);
    assert.deepEqual(taxonomy.leafConceptIds(), ['weapon']);
  });

  it('conceptIds contains all three concepts', () => {
    const taxonomy = Taxonomy.compile(concepts);
    assert.ok(taxonomy.conceptIds().includes('thing'));
    assert.ok(taxonomy.conceptIds().includes('item'));
    assert.ok(taxonomy.conceptIds().includes('weapon'));
  });
});

// ─── Test 5: Validation — duplicate-id ───────────────────────────────────────

describe('Taxonomy — validation', () => {
  it('throws duplicate-id when two concepts share an id', () => {
    const concepts: readonly ConceptDecl[] = [
      { id: 'spell', parent: null, capabilities: [] },
      { id: 'spell', parent: 'spell', capabilities: [] },
    ];
    assert.throws(
      () => Taxonomy.compile(concepts),
      (err) => err instanceof TaxonomyError && err.code === 'duplicate-id',
    );
  });

  it('throws orphan-parent when parent id does not exist', () => {
    // 'no-root' is checked first because we have no root concept.
    // Add a root but an orphan child to isolate the 'orphan-parent' error.
    const concepts2: readonly ConceptDecl[] = [
      { id: 'root',  parent: null,          capabilities: [] },
      { id: 'child', parent: 'nonexistent', capabilities: [] },
    ];
    assert.throws(
      () => Taxonomy.compile(concepts2),
      (err) => err instanceof TaxonomyError && err.code === 'orphan-parent',
    );
  });

  it('throws cycle when a concept forms a cycle via parents', () => {
    // We create a valid root plus an artificial cycle by bypassing TS:
    // root → a → b → a is invalid; we simulate by declaring:
    // root (ok), then a (parent: b), b (parent: a) — a/b form a cycle.
    const concepts: readonly ConceptDecl[] = [
      { id: 'root', parent: null,  capabilities: [] },
      { id: 'a',    parent: 'b',   capabilities: [] },
      { id: 'b',    parent: 'a',   capabilities: [] },
    ];
    assert.throws(
      () => Taxonomy.compile(concepts),
      (err) => err instanceof TaxonomyError && err.code === 'cycle',
    );
  });

  it('throws multiple-roots when more than one concept has parent: null', () => {
    const concepts: readonly ConceptDecl[] = [
      { id: 'root1', parent: null, capabilities: [] },
      { id: 'root2', parent: null, capabilities: [] },
    ];
    assert.throws(
      () => Taxonomy.compile(concepts),
      (err) => err instanceof TaxonomyError && err.code === 'multiple-roots',
    );
  });

  it('throws urlpath-on-interior when an interior concept declares urlPaths', () => {
    const concepts: readonly ConceptDecl[] = [
      { id: 'thing',  parent: null,    urlPaths: ['things'], capabilities: [] },
      { id: 'weapon', parent: 'thing', urlPaths: ['weapons'], capabilities: [] },
    ];
    // 'thing' has a child, so it is interior — urlPaths on it should throw
    assert.throws(
      () => Taxonomy.compile(concepts),
      (err) => err instanceof TaxonomyError && err.code === 'urlpath-on-interior',
    );
  });

  it('throws duplicate-url-path when same path appears on two concepts', () => {
    const concepts: readonly ConceptDecl[] = [
      { id: 'thing',  parent: null,    capabilities: [] },
      { id: 'spell',  parent: 'thing', urlPaths: ['spells'], capabilities: [] },
      { id: 'ritual', parent: 'thing', urlPaths: ['spells'], capabilities: [] },
    ];
    assert.throws(
      () => Taxonomy.compile(concepts),
      (err) => err instanceof TaxonomyError && err.code === 'duplicate-url-path',
    );
  });
});

// ─── Test 11: Router node validity ───────────────────────────────────────────

describe('Taxonomy — router node is a valid NodeInterface', () => {
  it('router has correct name', () => {
    const taxonomy      = Taxonomy.compile([]);
    const router = taxonomy.allNodes().find((node) => node.name === 'aonprd:taxonomy-route');
    assert.ok(router !== undefined);
    assert.equal(router.name, 'aonprd:taxonomy-route');
  });

  it('router has correct outputs (leaf concepts + unknown)', () => {
    const concepts: readonly ConceptDecl[] = [
      { id: 'thing',  parent: null,    capabilities: [] },
      { id: 'weapon', parent: 'thing', urlPaths: ['weapons'], capabilities: [] },
      { id: 'spell',  parent: 'thing', urlPaths: ['spells'],  capabilities: [] },
    ];
    const taxonomy      = Taxonomy.compile(concepts);
    const router = taxonomy.allNodes().find((node) => node.name === 'aonprd:taxonomy-route');
    assert.ok(router !== undefined);
    const outputs = [...router.outputs].sort();
    assert.ok(outputs.includes('weapon'));
    assert.ok(outputs.includes('spell'));
    assert.ok(outputs.includes('unknown'));
  });

  it('router execute returns concept id for matched URL', async () => {
    const concepts: readonly ConceptDecl[] = [
      { id: 'thing', parent: null,    capabilities: [] },
      { id: 'spell', parent: 'thing', urlPaths: ['spells'], capabilities: [] },
    ];
    const taxonomy      = Taxonomy.compile(concepts);
    const router = taxonomy.allNodes().find((node) => node.name === 'aonprd:taxonomy-route');
    assert.ok(router !== undefined);

    const fakeState = {
      page: { url: 'https://2e.aonprd.com/Spells.aspx?ID=5', html: '', targetId: '', title: '' },
      getMetadata: () => undefined,
      setMetadata: () => undefined,
      output: null,
    } as unknown as ScrapeState;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await router.execute(Batch.of(fakeState), { services: {} } as any);
    assert.ok(result.has('spell'));
  });

  it('router execute returns unknown for unmatched URL', async () => {
    const concepts: readonly ConceptDecl[] = [
      { id: 'thing', parent: null,    capabilities: [] },
      { id: 'spell', parent: 'thing', urlPaths: ['spells'], capabilities: [] },
    ];
    const taxonomy      = Taxonomy.compile(concepts);
    const router = taxonomy.allNodes().find((node) => node.name === 'aonprd:taxonomy-route');
    assert.ok(router !== undefined);

    const fakeState = {
      page: { url: 'https://2e.aonprd.com/Monsters.aspx?ID=1', html: '', targetId: '', title: '' },
      getMetadata: () => undefined,
      setMetadata: () => undefined,
      output: null,
    } as unknown as ScrapeState;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await router.execute(Batch.of(fakeState), { services: {} } as any);
    assert.ok(result.has('unknown'));
  });
});

// ─── Test 12: buildDAG shape ──────────────────────────────────────────────────

describe('Taxonomy — buildDAG shape', () => {
  it('buildDAG includes router entry with one placement per leaf concept + terminals', () => {
    const concepts: readonly ConceptDecl[] = [
      { id: 'thing',  parent: null,    capabilities: [] },
      { id: 'weapon', parent: 'thing', urlPaths: ['weapons'], capabilities: [] },
      { id: 'spell',  parent: 'thing', urlPaths: ['spells'],  capabilities: [] },
    ];
    const taxonomy = Taxonomy.compile(concepts);
    const dag      = taxonomy.buildDAG('test-dag', '0.1');
    assert.equal(dag.name, 'test-dag');
    assert.ok(dag.nodes.length > 0, 'DAG must have at least one node placement');
    // The router node must be in the DAG placements
    const routerPlacement = dag.nodes.find(
      (node: { name: string }) => node.name === 'aonprd:taxonomy-route',
    );
    assert.ok(routerPlacement !== undefined, 'router placement must exist in DAG');
  });

  it('buildDAG routes unknown to an emit terminal (not aonprd:make-unknown)', () => {
    const taxonomy = Taxonomy.compile([]);
    const dag      = taxonomy.buildDAG('test-empty-dag', '0.1');
    assert.equal(dag.name, 'test-empty-dag');
    // Verify aonprd:make-unknown is NOT a regular node placement in the DAG
    const makeUnknownPlacement = dag.nodes.find(
      (node: { name: string }) => node.name === 'aonprd:make-unknown',
    );
    assert.equal(makeUnknownPlacement, undefined,
      'aonprd:make-unknown must not appear as a node placement; unknown routes to a terminal');
  });

  it('buildDAG does not reference flow:terminate (retired node)', () => {
    const taxonomy = Taxonomy.compile([]);
    const dag      = taxonomy.buildDAG('test-retire-dag', '0.1');
    // flow:terminate is retired — no placement in the DAG by that name
    const terminatePlacement = dag.nodes.find(
      (node: { name: string }) => node.name === 'flow:terminate',
    );
    assert.equal(terminatePlacement, undefined,
      'flow:terminate must not appear in DAG placements (empty-contract node retired)');
  });
});

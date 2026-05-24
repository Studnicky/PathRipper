// Unit tests for the Taxonomy compiler.
// Validates the public API of Taxonomy.compile() and the generated nodes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DAGDeriver } from '@noocodex/dagonizer/derive';
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';

import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';
import { Taxonomy, TaxonomyError } from '../../../../plugins/aonprd/taxonomy.js';
import type { ConceptDecl, CapabilityNode } from '../../../../plugins/aonprd/taxonomy.js';

// ─── Stub capability nodes for tests ─────────────────────────────────────────
// Each stub has a distinct name, outputs: ['success', 'error'], and an inline
// contract — the minimum required for Taxonomy.compile to accept them.

function makeStubCap(name: string): CapabilityNode {
  return {
    name,
    outputs: ['success', 'error'] as const,
    contract: {
      hardRequired: [] as const,
      produces:     [] as const,
    } satisfies OperationContractFragment,
    async execute(
      _state: ScrapeState,
      _ctx:   NodeContextInterface<RipperServices>,
    ): Promise<{ output: 'success' | 'error' }> {
      return { output: 'success' };
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

  it('DAGDeriver.derive succeeds on empty taxonomy (primary acceptance)', () => {
    const t = Taxonomy.compile([]);
    assert.doesNotThrow(() => {
      const dag = DAGDeriver.derive({
        name:        'test-empty',
        version:     '0.1',
        entrypoint:  t.entrypoint(),
        nodes:       t.allNodes() as readonly NodeInterface[],
        annotations: t.annotations(),
      });
      assert.equal(typeof dag, 'object', 'derive should return an object');
      assert.ok(dag !== null, 'derive should return a non-null DAG');
    });
  });

  it('routeUrl always returns null for empty taxonomy', () => {
    const t = Taxonomy.compile([]);
    assert.equal(t.routeUrl('https://2e.aonprd.com/Spells.aspx?ID=1'), null);
    assert.equal(t.routeUrl('https://2e.aonprd.com/Monsters.aspx?ID=99'), null);
    assert.equal(t.routeUrl('https://example.com/no-aspx'), null);
  });

  it('chainFor returns empty array for unknown concept', () => {
    const t = Taxonomy.compile([]);
    assert.deepEqual(t.chainFor('anything'), []);
  });

  it('conceptIds returns empty array', () => {
    const t = Taxonomy.compile([]);
    assert.deepEqual(t.conceptIds(), []);
  });

  it('leafConceptIds returns empty array', () => {
    const t = Taxonomy.compile([]);
    assert.deepEqual(t.leafConceptIds(), []);
  });

  it('allNodes contains router, concept-dispatch, make-unknown, and flow:terminate', () => {
    const t = Taxonomy.compile([]);
    const names = t.allNodes().map((n) => n.name);
    assert.ok(names.includes('aonprd:taxonomy-route'),   'must include router');
    assert.ok(names.includes('aonprd:concept-dispatch'), 'must include concept-dispatch');
    assert.ok(names.includes('aonprd:make-unknown'),     'must include make-unknown');
    assert.ok(names.includes('flow:terminate'),           'must include flow:terminate');
    assert.equal(names.length, 4, 'empty taxonomy has exactly 4 nodes');
  });
});

// ─── Test 2: Router node against empty taxonomy ───────────────────────────────

describe('Taxonomy — router node behaviour (empty taxonomy)', () => {
  it('router node returns unknown for any URL', async () => {
    const t      = Taxonomy.compile([]);
    const router = t.allNodes().find((n) => n.name === 'aonprd:taxonomy-route');
    assert.ok(router !== undefined, 'router node must exist');

    const fakeState = {
      page: { url: 'https://2e.aonprd.com/Spells.aspx?ID=1', html: '', targetId: 'aonprd', title: '' },
      getMetadata: () => undefined,
      setMetadata: () => undefined,
      output: null,
    } as unknown as ScrapeState;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await router.execute(fakeState, { services: {} } as any);
    assert.equal(result.output, 'unknown');
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
    const t = Taxonomy.compile(concepts);
    assert.equal(t.routeUrl('https://2e.aonprd.com/Spells.aspx?ID=1'), 'spell');
  });

  it('routeUrl returns null for non-matching URL', () => {
    const t = Taxonomy.compile(concepts);
    assert.equal(t.routeUrl('https://2e.aonprd.com/Monsters.aspx?ID=1'), null);
  });

  it('chainFor returns the root capabilities', () => {
    const t     = Taxonomy.compile(concepts);
    const chain = t.chainFor('spell');
    assert.equal(chain.length, 1);
    assert.equal(chain[0]?.name, 'extract:spell-cast-stub');
  });

  it('DAGDeriver.derive succeeds on single-concept taxonomy', () => {
    const t = Taxonomy.compile(concepts);
    assert.doesNotThrow(() => {
      DAGDeriver.derive({
        name:        'test-single',
        version:     '0.1',
        entrypoint:  t.entrypoint(),
        nodes:       t.allNodes() as readonly NodeInterface[],
        annotations: t.annotations(),
      });
    });
  });

  it('conceptIds includes the concept', () => {
    const t = Taxonomy.compile(concepts);
    assert.deepEqual(t.conceptIds(), ['spell']);
  });

  it('leafConceptIds includes the concept', () => {
    const t = Taxonomy.compile(concepts);
    assert.deepEqual(t.leafConceptIds(), ['spell']);
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
    const t     = Taxonomy.compile(concepts);
    const chain = t.chainFor('weapon');
    const names = chain.map((n) => n.name);
    assert.deepEqual(names, [
      'extract:identity',
      'extract:source-ref-stub',
      'extract:label-pair-stub',
      'extract:weapon-mechanics-stub',
    ]);
  });

  it('chainFor("item") returns root + item capabilities only', () => {
    const t     = Taxonomy.compile(concepts);
    const chain = t.chainFor('item');
    const names = chain.map((n) => n.name);
    assert.deepEqual(names, [
      'extract:identity',
      'extract:source-ref-stub',
      'extract:label-pair-stub',
    ]);
  });

  it('chainFor("thing") returns only root capabilities', () => {
    const t     = Taxonomy.compile(concepts);
    const chain = t.chainFor('thing');
    const names = chain.map((n) => n.name);
    assert.deepEqual(names, [
      'extract:identity',
      'extract:source-ref-stub',
    ]);
  });

  it('leafConceptIds contains only weapon (the only concept with urlPaths)', () => {
    const t = Taxonomy.compile(concepts);
    assert.deepEqual(t.leafConceptIds(), ['weapon']);
  });

  it('conceptIds contains all three concepts', () => {
    const t = Taxonomy.compile(concepts);
    assert.ok(t.conceptIds().includes('thing'));
    assert.ok(t.conceptIds().includes('item'));
    assert.ok(t.conceptIds().includes('weapon'));
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
    const concepts: readonly ConceptDecl[] = [
      { id: 'child', parent: 'nonexistent', capabilities: [] },
    ];
    // This also triggers 'no-root' before 'orphan-parent'; 'no-root' is checked first
    // because we have no root concept. Let's add a root but an orphan child.
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

  it('throws capability-shape when a capability is missing the contract field', () => {
    const badCap: CapabilityNode = {
      name:    'bad:cap',
      outputs: ['success'],
      // No contract field
      async execute(_s: ScrapeState, _c: NodeContextInterface<RipperServices>) {
        return { output: 'success' as const };
      },
    };
    const concepts: readonly ConceptDecl[] = [
      { id: 'root', parent: null, capabilities: [badCap] },
    ];
    assert.throws(
      () => Taxonomy.compile(concepts),
      (err) => err instanceof TaxonomyError && err.code === 'capability-shape',
    );
  });
});

// ─── Test 11: Router node validity ───────────────────────────────────────────

describe('Taxonomy — router node is a valid NodeInterface', () => {
  it('router has correct name', () => {
    const t      = Taxonomy.compile([]);
    const router = t.allNodes().find((n) => n.name === 'aonprd:taxonomy-route');
    assert.ok(router !== undefined);
    assert.equal(router.name, 'aonprd:taxonomy-route');
  });

  it('router has correct outputs (leaf concepts + unknown)', () => {
    const concepts: readonly ConceptDecl[] = [
      { id: 'thing',  parent: null,    capabilities: [] },
      { id: 'weapon', parent: 'thing', urlPaths: ['weapons'], capabilities: [] },
      { id: 'spell',  parent: 'thing', urlPaths: ['spells'],  capabilities: [] },
    ];
    const t      = Taxonomy.compile(concepts);
    const router = t.allNodes().find((n) => n.name === 'aonprd:taxonomy-route');
    assert.ok(router !== undefined);
    const outputs = [...router.outputs].sort();
    assert.ok(outputs.includes('weapon'));
    assert.ok(outputs.includes('spell'));
    assert.ok(outputs.includes('unknown'));
  });

  it('router has inline contract with page.url as hardRequired', () => {
    const t      = Taxonomy.compile([]);
    const router = t.allNodes().find((n) => n.name === 'aonprd:taxonomy-route');
    assert.ok(router !== undefined);
    assert.ok(router.contract !== undefined, 'router must have a contract');
    assert.ok(
      (router.contract.hardRequired as readonly string[]).includes('page.url'),
      'router contract must hardRequired page.url',
    );
    assert.deepEqual(
      [...router.contract.produces],
      ['aonprdConceptId'],
      'router contract produces aonprdConceptId (stored for concept-dispatch)',
    );
  });

  it('router execute returns concept id for matched URL', async () => {
    const concepts: readonly ConceptDecl[] = [
      { id: 'thing', parent: null,    capabilities: [] },
      { id: 'spell', parent: 'thing', urlPaths: ['spells'], capabilities: [] },
    ];
    const t      = Taxonomy.compile(concepts);
    const router = t.allNodes().find((n) => n.name === 'aonprd:taxonomy-route');
    assert.ok(router !== undefined);

    const fakeState = {
      page: { url: 'https://2e.aonprd.com/Spells.aspx?ID=5', html: '', targetId: '', title: '' },
      getMetadata: () => undefined,
      setMetadata: () => undefined,
      output: null,
    } as unknown as ScrapeState;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await router.execute(fakeState, { services: {} } as any);
    assert.equal(result.output, 'spell');
  });

  it('router execute returns unknown for unmatched URL', async () => {
    const concepts: readonly ConceptDecl[] = [
      { id: 'thing', parent: null,    capabilities: [] },
      { id: 'spell', parent: 'thing', urlPaths: ['spells'], capabilities: [] },
    ];
    const t      = Taxonomy.compile(concepts);
    const router = t.allNodes().find((n) => n.name === 'aonprd:taxonomy-route');
    assert.ok(router !== undefined);

    const fakeState = {
      page: { url: 'https://2e.aonprd.com/Monsters.aspx?ID=1', html: '', targetId: '', title: '' },
      getMetadata: () => undefined,
      setMetadata: () => undefined,
      output: null,
    } as unknown as ScrapeState;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await router.execute(fakeState, { services: {} } as any);
    assert.equal(result.output, 'unknown');
  });
});

// ─── Test 12: annotations shape ──────────────────────────────────────────────

describe('Taxonomy — annotations shape', () => {
  it('annotations.terminals includes router entry with one entry per leaf concept + unknown', () => {
    const concepts: readonly ConceptDecl[] = [
      { id: 'thing',  parent: null,    capabilities: [] },
      { id: 'weapon', parent: 'thing', urlPaths: ['weapons'], capabilities: [] },
      { id: 'spell',  parent: 'thing', urlPaths: ['spells'],  capabilities: [] },
    ];
    const t           = Taxonomy.compile(concepts);
    const annotations = t.annotations();
    assert.ok(annotations.terminals !== undefined);
    const routerTerminals = annotations.terminals['aonprd:taxonomy-route'];
    assert.ok(routerTerminals !== undefined);
    const outcomes = routerTerminals.map((e) => e.outcome).sort();
    assert.ok(outcomes.includes('weapon'),  'must have weapon outcome');
    assert.ok(outcomes.includes('spell'),   'must have spell outcome');
    assert.ok(outcomes.includes('unknown'), 'must have unknown outcome');
    assert.equal(outcomes.length, 3, 'exactly one per leaf concept + unknown');
  });

  it('annotations.terminals includes make-unknown → flow:terminate', () => {
    const t           = Taxonomy.compile([]);
    const annotations = t.annotations();
    assert.ok(annotations.terminals !== undefined);
    const makeUnknownTerminals = annotations.terminals['aonprd:make-unknown'];
    assert.ok(makeUnknownTerminals !== undefined);
    assert.equal(makeUnknownTerminals.length, 1);
    assert.equal(makeUnknownTerminals[0]?.outcome, 'success');
    assert.equal(makeUnknownTerminals[0]?.target, 'flow:terminate');
  });

  it('annotations.terminals includes flow:terminate → null', () => {
    const t           = Taxonomy.compile([]);
    const annotations = t.annotations();
    assert.ok(annotations.terminals !== undefined);
    const terminateTerminals = annotations.terminals['flow:terminate'];
    assert.ok(terminateTerminals !== undefined);
    assert.equal(terminateTerminals.length, 1);
    assert.equal(terminateTerminals[0]?.outcome, 'success');
    assert.equal(terminateTerminals[0]?.target, null);
  });
});

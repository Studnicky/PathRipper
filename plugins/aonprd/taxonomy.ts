// Taxonomy compiler — Phase 6.2.
//
// Compiles a declarative concept tree (ConceptDecl[]) into a DAG-ready node
// set plus a DAGDeriverAnnotations bundle for DAGDeriver.derive.
//
// The pipeline switch in parse.dag.ts / parse.task.ts is NOT touched here;
// this module is an orphan library until Phase 6.4 wires it in.
import type { NodeInterface, NodeContextInterface, NodeStateInterface } from '@noocodex/dagonizer';
import type { DAGDeriverAnnotations } from '@noocodex/dagonizer/derive';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';

import type { ScrapeState }    from '../../src/state/ScrapeState.js';
import type { RipperServices } from '../../src/services/RipperServices.js';
import { unknownTerminalNode } from './nodes/unknownTerminal.js';
import { makeTaxonomyRouter, makeConceptDispatch }  from './nodes/taxonomyRouter.js';

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Capability nodes come in three output shapes:
 *  - `'success'` only — terminal nodes (`flow:terminate`, `aonprd:make-unknown`)
 *    and finalize nodes (pure assemblers).
 *  - `'success' | 'error'` — extract nodes that can soft-fail when their
 *    `hardRequired` metadata is absent.
 *  - widened `string` — taxonomy router + concept-dispatch nodes whose
 *    outputs are computed from the concept list at compile time.
 *
 * Narrowing the union (vs widening every node to `string`) keeps typos in
 * `'success'`/`'error'` from compiling silently.
 */
type CapabilitySuccessOnlyNode  = NodeInterface<ScrapeState, 'success', RipperServices>;
type CapabilitySuccessErrorNode = NodeInterface<ScrapeState, 'success' | 'error', RipperServices>;
type CapabilityRouterNode       = NodeInterface<ScrapeState, string, RipperServices>;
export type CapabilityNode = CapabilitySuccessOnlyNode | CapabilitySuccessErrorNode | CapabilityRouterNode;

/**
 * Minimal shape `Chainable<>` consumes — the dagonizer-exported alias
 * constrains its parameters to `NodeInterface & { contract: ... }`.
 *
 * `TServices` is contravariant in `NodeInterface` (it appears in
 * `execute(state, context: NodeContextInterface<TServices>)`), so accepting
 * `unknown` here would actually NARROW the set of acceptable nodes — only
 * nodes whose execute accepts `NodeContextInterface<unknown>` would qualify,
 * which excludes nodes typed with concrete `RipperServices`. Pinning
 * `TServices = RipperServices` matches the codebase convention and accepts
 * every plugin capability authored against the AONPRD services bag.
 */
export type ContractedCapability = NodeInterface<NodeStateInterface, string, RipperServices> & {
  readonly contract: OperationContractFragment;
};

/**
 * Local `Chainable<A, B>` (Wave 3 H6). Mirrors `@noocodex/dagonizer`'s
 * `Chainable` but without the embedded `NodeInterface<…, undefined>`
 * constraint that excludes nodes typed with a concrete `TServices` bag
 * (such as `RipperServices`). Resolves to `true` when B's `hardRequired`
 * is a subset of A's `produces`, `never` otherwise.
 */
type ChainableLocal<
  A extends { readonly contract: OperationContractFragment },
  B extends { readonly contract: OperationContractFragment },
> = B['contract']['hardRequired'][number] extends A['contract']['produces'][number]
  ? true
  : never;

/**
 * Asserts that B's `hardRequired` is a subset of A's `produces`. Resolves to
 * `B` when chainable, `never` otherwise — used by `chain(...)`'s overloads to
 * mark a broken successor argument as `never` so the call site fails `tsc`.
 *
 * `ChainableLocal<A, B>` resolves to `true` on a valid pair and `never`
 * otherwise. Distinguishing them in a conditional requires `[T] extends
 * [never]` — the conditional `[Chainable<A,B>] extends [true]` would always
 * pass because `[never] extends [true]` is `true` (a `never` slot in a tuple
 * still satisfies any tuple constraint).
 */
type ChainNext<
  A extends ContractedCapability,
  B extends ContractedCapability,
> = [ChainableLocal<A, B>] extends [never] ? never : B;

/**
 * Build a capability chain with compile-time `Chainable<>` validation
 * (Wave 3 H6). Each adjacent pair `(nodes[i], nodes[i+1])` is checked: the
 * latter's `hardRequired` must be a subset of the former's `produces`. Drift
 * fails `tsc` (the offending argument is required to be `never`).
 *
 * Concepts opt in by calling `chain(nodeA, nodeB, nodeC, ...)` for their
 * `capabilities` field. The helper is a no-op at runtime — it returns the
 * input tuple unchanged. Concepts whose capabilities are already implicitly
 * chained via Taxonomy's prefix inheritance (i.e. the root `thing` provides
 * `aonprdCheerio`, the `entity` concept reads it, etc.) gain a typecheck of
 * their own local chain when they author it through `chain()`.
 *
 * The overloads cover chains of 2–6 capabilities. Longer chains are uncommon
 * in concept files — at six nodes the concept should split. Adding more
 * overloads is a one-line change if needed.
 *
 * @example
 * ```ts
 * capabilities: chain(
 *   monsterBaseNode,
 *   monsterDefensesNode,
 *   finalizeMonsterNode,
 * )
 * ```
 */
export function chain<const A extends ContractedCapability, const B extends ContractedCapability>(
  a: A,
  b: ChainNext<A, B>,
): readonly [A, B];
export function chain<
  const A extends ContractedCapability,
  const B extends ContractedCapability,
  const C extends ContractedCapability,
>(
  a: A,
  b: ChainNext<A, B>,
  c: ChainNext<B, C>,
): readonly [A, B, C];
export function chain<
  const A extends ContractedCapability,
  const B extends ContractedCapability,
  const C extends ContractedCapability,
  const D extends ContractedCapability,
>(
  a: A,
  b: ChainNext<A, B>,
  c: ChainNext<B, C>,
  d: ChainNext<C, D>,
): readonly [A, B, C, D];
export function chain<
  const A extends ContractedCapability,
  const B extends ContractedCapability,
  const C extends ContractedCapability,
  const D extends ContractedCapability,
  const E extends ContractedCapability,
>(
  a: A,
  b: ChainNext<A, B>,
  c: ChainNext<B, C>,
  d: ChainNext<C, D>,
  e: ChainNext<D, E>,
): readonly [A, B, C, D, E];
export function chain<
  const A extends ContractedCapability,
  const B extends ContractedCapability,
  const C extends ContractedCapability,
  const D extends ContractedCapability,
  const E extends ContractedCapability,
  const F extends ContractedCapability,
>(
  a: A,
  b: ChainNext<A, B>,
  c: ChainNext<B, C>,
  d: ChainNext<C, D>,
  e: ChainNext<D, E>,
  f: ChainNext<E, F>,
): readonly [A, B, C, D, E, F];
export function chain(...nodes: readonly ContractedCapability[]): readonly ContractedCapability[] {
  return nodes;
}

/**
 * Declarative concept node in the taxonomy (Wave 4 H9).
 *
 * `TOutput` is the type of the assembled output this concept produces. It is
 * a phantom type parameter — never materialised at runtime — that lets
 * downstream tooling (the `outputType` marker, the derived
 * `ConceptOutputUnion` below) recover each concept's static output shape from
 * the declaration tuple.
 *
 * Concepts opt in by parameterising the declaration:
 *
 * ```ts
 * export const languageConcept: ConceptDecl<LanguageOutput> = { ... };
 * ```
 *
 * Leaving the parameter at its default (`never`) means the concept contributes
 * nothing to the derived `ConceptOutputUnion` — appropriate for interior
 * concepts (e.g. `thing`, `entity`) that exist only to share capability
 * chains. The `setConceptOutput` helper in `concepts/_helpers.ts` carries
 * the compile-time `satisfies` check that prevents misspelled keys in
 * finalize nodes.
 *
 * This interface lives in plugin-agnostic infrastructure: a future
 * bulbapedia/torreya plugin can supply its own `ConceptDecl<BulbaXxxOutput>`
 * declarations with no changes to this module.
 */
/**
 * Base shape every concept Output type extends. The `_type` discriminator is
 * provided structurally at runtime by the taxonomy router (via the concept's
 * `discriminator` field on `ConceptDecl`), NOT by per-concept slice literals.
 *
 * Concept Output interfaces should be defined as:
 *
 * ```ts
 * export interface LanguageOutputFields { url: string; language_id: number | null; ... }
 * export type LanguageOutput = ConceptOutputBase<'language'> & LanguageOutputFields;
 * ```
 *
 * This keeps the `_type` field as a single source of truth: the router (via
 * the discriminator) stamps it once at chain entry; per-concept slice helpers
 * never hand-stamp it. The intersection preserves the `_type` literal-type
 * guarantee for consumers that pattern-match on the discriminated union
 * (e.g. `if (out._type === 'language') { ... }`).
 *
 * Plugin-agnostic: bulbapedia/torreya plugins use the same `ConceptOutputBase`
 * to define their own output types.
 */
export interface ConceptOutputBase<TType extends string> {
  readonly _type: TType;
}

export interface ConceptDecl<TOutput = never> {
  /** Concept name — used as the type discriminator on output AND as the router-output name. Must be unique. */
  readonly id: string;
  /** Parent concept ID. Null only for the root. Every non-null parent must exist in the same array. */
  readonly parent: string | null;
  /** URL paths (case-insensitive match against AON's `/Path.aspx`) that route directly to this concept. Leaf concepts only — interior concepts have no urlPaths. Same path on multiple concepts is an error. */
  readonly urlPaths?: readonly string[];
  /** Capability nodes added by this concept. Inherited downward by descendant concepts. May be empty. */
  readonly capabilities: readonly CapabilityNode[];
  /**
   * Optional static fields layered onto state.output for this concept.
   * Constrained to `Partial<TOutput>` so the discriminator agrees with the
   * declared output shape at compile time.
   */
  readonly discriminator?: Readonly<Partial<TOutput>>;
  /**
   * Phantom marker that anchors `TOutput` in the declared object so it can be
   * recovered with `ConceptOutputFor<typeof xxxConcept>`. Never set at runtime;
   * type-only.
   */
  readonly outputType?: TOutput;
}

/**
 * Recover the output type for a single `ConceptDecl<TOutput>` value.
 *
 * @example
 * ```ts
 * type L = ConceptOutputFor<typeof languageConcept>; // LanguageOutput
 * ```
 */
export type ConceptOutputFor<TDecl extends ConceptDecl<unknown>> =
  TDecl extends ConceptDecl<infer TOutput> ? TOutput : never;

/**
 * Union of every concept's output type in a taxonomy declaration tuple
 * (Wave 4 H9 step 5).
 *
 * Used by plugins to derive the top-level output union from
 * `typeof <PLUGIN>_TAXONOMY` without hand-listing each `*Output` import:
 *
 * ```ts
 * export type AonOutput = ConceptOutputUnion<typeof AONPRD_TAXONOMY>;
 * ```
 *
 * Concepts not yet migrated (whose `TOutput` is the default
 * `Record<string, unknown>`) contribute that loose shape to the union. Once a
 * concept declares `ConceptDecl<MyOutput>` the union narrows to the concrete
 * shape.
 */
export type ConceptOutputUnion<TArray extends readonly ConceptDecl<unknown>[]> =
  TArray[number] extends ConceptDecl<infer TOutput> ? TOutput : never;

// ─── TaxonomyError ────────────────────────────────────────────────────────────

export class TaxonomyError extends Error {
  readonly code: 'duplicate-id' | 'orphan-parent' | 'cycle' | 'duplicate-url-path' | 'multiple-roots' | 'no-root' | 'urlpath-on-interior' | 'capability-shape';

  constructor(code: TaxonomyError['code'], message: string) {
    super(message);
    this.name = 'TaxonomyError';
    this.code = code;
  }
}

// ─── flow:terminate stub ──────────────────────────────────────────────────────

// Mirrors the pattern used in parse.dag.ts where flow:terminate has
// outputs: ['success'] and its terminal points to target: null.
const flowTerminateNode: CapabilityNode = {
  name:    'flow:terminate',
  outputs: ['success'] as const,
  contract: {
    hardRequired: [] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,
  async execute(
    _state:   ScrapeState,
    _ctx:     NodeContextInterface<RipperServices>,
  ): Promise<{ output: 'success' }> {
    return { output: 'success' };
  },
};

// ─── URL path extraction ──────────────────────────────────────────────────────

/** Extract the lowercase AON path segment from any URL. Returns null on no match. */
function extractAonPath(url: string): string | null {
  const match = /\/([A-Za-z]+)\.aspx/i.exec(url);
  return match !== null ? match[1]!.toLowerCase() : null;
}

// ─── Validation helpers ───────────────────────────────────────────────────────

function validateConcepts(concepts: readonly ConceptDecl<unknown>[]): void {
  // Validate capability shapes first (fast, no tree walk needed)
  for (const concept of concepts) {
    for (const cap of concept.capabilities) {
      if (cap.contract === undefined) {
        throw new TaxonomyError(
          'capability-shape',
          `Concept '${concept.id}': capability '${cap.name}' is missing the 'contract' field. ` +
          'All capabilities must carry an inline OperationContractFragment.',
        );
      }
    }
  }

  // Count roots
  const roots = concepts.filter((c) => c.parent === null);
  if (roots.length === 0) {
    throw new TaxonomyError('no-root', 'Taxonomy must have exactly one root concept (parent: null).');
  }
  if (roots.length > 1) {
    const ids = roots.map((r) => `'${r.id}'`).join(', ');
    throw new TaxonomyError('multiple-roots', `Taxonomy has ${roots.length} roots: ${ids}. Only one root is allowed.`);
  }

  // Duplicate IDs
  const seen = new Set<string>();
  for (const concept of concepts) {
    if (seen.has(concept.id)) {
      throw new TaxonomyError('duplicate-id', `Duplicate concept id '${concept.id}'.`);
    }
    seen.add(concept.id);
  }

  // Orphan parents
  for (const concept of concepts) {
    if (concept.parent !== null && !seen.has(concept.parent)) {
      throw new TaxonomyError(
        'orphan-parent',
        `Concept '${concept.id}' references unknown parent '${concept.parent}'.`,
      );
    }
  }

  // Cycle detection via DFS
  const byId = new Map<string, ConceptDecl<unknown>>(concepts.map((c) => [c.id, c]));
  const visited   = new Set<string>();
  const onStack   = new Set<string>();

  function dfs(id: string): void {
    if (onStack.has(id)) {
      throw new TaxonomyError('cycle', `Cycle detected involving concept '${id}'.`);
    }
    if (visited.has(id)) return;
    onStack.add(id);
    const concept = byId.get(id)!;
    if (concept.parent !== null) dfs(concept.parent);
    onStack.delete(id);
    visited.add(id);
  }

  for (const concept of concepts) {
    dfs(concept.id);
  }

  // Determine which concepts have children
  const childrenOf = new Map<string, Set<string>>();
  for (const concept of concepts) {
    if (!childrenOf.has(concept.id)) childrenOf.set(concept.id, new Set());
    if (concept.parent !== null) {
      const siblings = childrenOf.get(concept.parent) ?? new Set<string>();
      siblings.add(concept.id);
      childrenOf.set(concept.parent, siblings);
    }
  }

  // urlPath-on-interior: concepts with children cannot have urlPaths
  for (const concept of concepts) {
    const hasChildren = (childrenOf.get(concept.id)?.size ?? 0) > 0;
    if (hasChildren && concept.urlPaths !== undefined && concept.urlPaths.length > 0) {
      throw new TaxonomyError(
        'urlpath-on-interior',
        `Concept '${concept.id}' has children but also declares urlPaths. ` +
        'Only leaf concepts (no descendants) may declare urlPaths.',
      );
    }
  }

  // Duplicate url paths across concepts
  const pathToConceptId = new Map<string, string>();
  for (const concept of concepts) {
    for (const rawPath of concept.urlPaths ?? []) {
      const path = rawPath.toLowerCase();
      const existing = pathToConceptId.get(path);
      if (existing !== undefined) {
        throw new TaxonomyError(
          'duplicate-url-path',
          `URL path '${path}' is declared by both '${existing}' and '${concept.id}'.`,
        );
      }
      pathToConceptId.set(path, concept.id);
    }
  }
}

// ─── Taxonomy ─────────────────────────────────────────────────────────────────

export class Taxonomy {
  readonly #router:             CapabilityNode;
  readonly #conceptIds:         readonly string[];
  readonly #leafIds:            readonly string[];
  readonly #chainMap:           ReadonlyMap<string, readonly CapabilityNode[]>;
  readonly #urlMap:             ReadonlyMap<string, string>;
  readonly #allNodesList:       readonly CapabilityNode[];
  readonly #annotations:        DAGDeriverAnnotations;
  readonly #discriminatorMap:   ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  readonly #fallbackConceptId:  string | null;

  private constructor(
    router:             CapabilityNode,
    conceptIds:         readonly string[],
    leafIds:            readonly string[],
    chainMap:           ReadonlyMap<string, readonly CapabilityNode[]>,
    urlMap:             ReadonlyMap<string, string>,
    allNodesList:       readonly CapabilityNode[],
    annotations:        DAGDeriverAnnotations,
    discriminatorMap:   ReadonlyMap<string, Readonly<Record<string, unknown>>>,
    fallbackConceptId:  string | null,
  ) {
    this.#router             = router;
    this.#conceptIds         = conceptIds;
    this.#leafIds            = leafIds;
    this.#chainMap           = chainMap;
    this.#urlMap             = urlMap;
    this.#allNodesList       = allNodesList;
    this.#annotations        = annotations;
    this.#discriminatorMap   = discriminatorMap;
    this.#fallbackConceptId  = fallbackConceptId;
  }

  /** Validate concepts and build the compiled taxonomy. Throws TaxonomyError on invalid input. */
  static compile(concepts: readonly ConceptDecl<unknown>[]): Taxonomy {
    // Empty taxonomy is a special case: skip most validation
    if (concepts.length === 0) {
      return Taxonomy.#buildEmpty();
    }

    validateConcepts(concepts);

    const byId = new Map<string, ConceptDecl<unknown>>(concepts.map((c) => [c.id, c]));

    // Build ancestor chain (root → concept) for each concept
    function ancestorChain(id: string): readonly string[] {
      const chain: string[] = [];
      let current: string | null = id;
      while (current !== null) {
        chain.unshift(current);
        current = byId.get(current)?.parent ?? null;
      }
      return chain;
    }

    // Identify leaf concepts (no children)
    const childrenOf = new Map<string, Set<string>>();
    for (const concept of concepts) {
      if (!childrenOf.has(concept.id)) childrenOf.set(concept.id, new Set());
      if (concept.parent !== null) {
        const siblings = childrenOf.get(concept.parent) ?? new Set<string>();
        siblings.add(concept.id);
        childrenOf.set(concept.parent, siblings);
      }
    }

    // Build URL routing table
    const urlMap = new Map<string, string>();
    for (const concept of concepts) {
      for (const rawPath of concept.urlPaths ?? []) {
        urlMap.set(rawPath.toLowerCase(), concept.id);
      }
    }

    // Leaf concept IDs — those with urlPaths declared
    const leafIds = concepts
      .filter((c) => c.urlPaths !== undefined && c.urlPaths.length > 0)
      .map((c) => c.id);

    // Wave 7 M7: fallback concept (one with `urlPaths: []` and `capabilities`
    // declared). Receives unmatched URLs that the router would otherwise send
    // to `make-unknown`. By convention there is at most one fallback per
    // taxonomy; if multiple are declared, the first wins.
    const fallbackConcept = concepts.find((c) =>
      c.urlPaths !== undefined && c.urlPaths.length === 0 && c.capabilities.length > 0,
    );
    const fallbackConceptId = fallbackConcept?.id ?? null;

    // Build capability chains per concept
    const chainMap = new Map<string, readonly CapabilityNode[]>();
    for (const concept of concepts) {
      const ancestors = ancestorChain(concept.id);
      const seen      = new Set<CapabilityNode>();
      const chain:    CapabilityNode[] = [];

      for (const ancestorId of ancestors) {
        const ancestorConcept = byId.get(ancestorId)!;
        for (const cap of ancestorConcept.capabilities) {
          if (!seen.has(cap)) {
            seen.add(cap);
            chain.push(cap);
          }
        }
      }

      chainMap.set(concept.id, chain);
    }

    // Router function
    function routeUrl(url: string): string | null {
      const path = extractAonPath(url);
      if (path === null) return null;
      return urlMap.get(path) ?? null;
    }

    // Wave 6 M1: discriminator map keyed by concept ID. Empty objects for
    // concepts without a declared discriminator (e.g. interior concepts).
    const discriminatorMap = new Map<string, Readonly<Record<string, unknown>>>();
    for (const concept of concepts) {
      discriminatorMap.set(
        concept.id,
        (concept.discriminator as Readonly<Record<string, unknown>> | undefined) ?? {},
      );
    }
    const discriminatorFor = (conceptId: string): Readonly<Record<string, unknown>> =>
      discriminatorMap.get(conceptId) ?? {};

    const router = makeTaxonomyRouter(routeUrl, leafIds, discriminatorFor, fallbackConceptId);

    // Deduplicate all capability nodes by name across all chains
    const allCapsByName = new Map<string, CapabilityNode>();
    for (const chain of chainMap.values()) {
      for (const cap of chain) {
        if (!allCapsByName.has(cap.name)) {
          allCapsByName.set(cap.name, cap);
        }
      }
    }

    // Identify branch points in the leaf-chain trie. A cap is a "branch point"
    // when at least two leaf concepts that share it as a prefix-cap diverge on
    // their next cap. The URL-router itself is the first branch point; further
    // branch points are introduced after each shared prefix runs.
    const { branchPoints, capSuccessNext } = Taxonomy.#computeRouting(leafIds, chainMap);

    // Materialize a concept-dispatch node per branch point. Each instance
    // reads `aonprdConceptId` from state and emits the routed concept ID as
    // its outcome; downstream targets differ per branch point.
    const branchDispatchNames = new Map<string, string>();
    const branchDispatchNodes: CapabilityNode[] = [];
    for (const branchPointKey of branchPoints.keys()) {
      const name = branchPointKey === '__entry__'
        ? 'aonprd:concept-dispatch'
        : `aonprd:concept-dispatch-after:${branchPointKey}`;
      branchDispatchNames.set(branchPointKey, name);
      branchDispatchNodes.push(makeConceptDispatch(leafIds, name));
    }

    const allNodesList: CapabilityNode[] = [
      router,
      ...branchDispatchNodes,
      ...allCapsByName.values(),
      unknownTerminalNode,
      flowTerminateNode,
    ];

    // Build annotations — includes full sequential chain routing.
    const annotations = Taxonomy.#buildAnnotations(
      leafIds,
      chainMap,
      allCapsByName,
      branchPoints,
      branchDispatchNames,
      capSuccessNext,
      fallbackConceptId,
    );

    const conceptIds = concepts.map((c) => c.id);

    return new Taxonomy(router, conceptIds, leafIds, chainMap, urlMap, allNodesList, annotations, discriminatorMap, fallbackConceptId);
  }

  static #buildEmpty(): Taxonomy {
    const router          = makeTaxonomyRouter(() => null, [], () => ({}));
    const conceptDispatch = makeConceptDispatch([]);

    const allNodesList: CapabilityNode[] = [
      router,
      conceptDispatch,
      unknownTerminalNode,
      flowTerminateNode,
    ];

    const annotations: DAGDeriverAnnotations = {
      terminals: {
        'aonprd:taxonomy-route':  [{ outcome: 'unknown', target: 'aonprd:make-unknown' }],
        'aonprd:concept-dispatch': [{ outcome: 'unknown', target: 'aonprd:make-unknown' }],
        'aonprd:make-unknown':    [{ outcome: 'success', target: 'flow:terminate' }],
        'flow:terminate':         [{ outcome: 'success', target: null }],
      },
    };

    return new Taxonomy(
      router,
      [],
      [],
      new Map(),
      new Map(),
      allNodesList,
      annotations,
      new Map(),
      null,
    );
  }

  /**
   * Compute the routing trie for all leaf chains.
   *
   * A branch point is a position in the leaf-chain trie where two or more
   * concepts diverge on their next cap. For each branch point, the keys of the
   * returned `branchPoints` map identify the divergence position:
   *   - `'__entry__'` — divergence at the DAG entrypoint (the URL router slot).
   *   - `<cap-name>`  — divergence immediately after the named cap completes.
   *
   * The corresponding value is a `Map<conceptId, nextCapName | 'flow:terminate'>`
   * describing where each concept goes after the divergence point.
   *
   * `capSuccessNext` is the inverse for caps whose successor is uniform across
   * all concepts that pass through them — a direct success edge to a single
   * next target. Caps that appear at a branch point are NOT present in
   * `capSuccessNext`; their routing is delegated to a concept-dispatch node.
   */
  static #computeRouting(
    leafIds:  readonly string[],
    chainMap: ReadonlyMap<string, readonly CapabilityNode[]>,
  ): {
    branchPoints:    Map<string, Map<string, string>>;
    capSuccessNext:  Map<string, string>;
  } {
    // Per-position map: key = `<capName-or-__entry__>` → conceptId → nextTarget.
    const perPositionNext = new Map<string, Map<string, string>>();

    function recordNext(position: string, conceptId: string, nextTarget: string): void {
      let m = perPositionNext.get(position);
      if (m === undefined) {
        m = new Map();
        perPositionNext.set(position, m);
      }
      // For a given concept at a position, the next must be deterministic.
      // (A concept's chain is a fixed sequence — no two appearances of the
      // same cap in one chain should have different successors. Caller honors.)
      if (!m.has(conceptId)) m.set(conceptId, nextTarget);
    }

    for (const leafId of leafIds) {
      const chain = chainMap.get(leafId) ?? [];
      if (chain.length === 0) {
        recordNext('__entry__', leafId, 'flow:terminate');
        continue;
      }
      // Entry routes to the first cap of this concept's chain.
      recordNext('__entry__', leafId, chain[0]!.name);
      for (let i = 0; i < chain.length; i++) {
        const cap     = chain[i]!;
        const next    = i < chain.length - 1 ? chain[i + 1]!.name : 'flow:terminate';
        recordNext(cap.name, leafId, next);
      }
    }

    // Partition: positions where all concepts agree → uniform success edge;
    // positions with divergent nexts → branch point.
    const branchPoints   = new Map<string, Map<string, string>>();
    const capSuccessNext = new Map<string, string>();

    for (const [position, perConcept] of perPositionNext) {
      const uniqueNexts = new Set(perConcept.values());
      if (uniqueNexts.size === 1 && position !== '__entry__') {
        // All concepts that pass through this cap go to the same next.
        capSuccessNext.set(position, [...uniqueNexts][0]!);
      } else {
        branchPoints.set(position, perConcept);
      }
    }

    // Special case: the entry position is always a "branch point" — even if
    // only one leaf exists, the URL router itself is the dispatcher. We rely
    // on the URL router (taxonomy-route) for entry dispatch, NOT a separate
    // concept-dispatch node. Remove `__entry__` from branchPoints so the
    // router fills that role directly.
    branchPoints.delete('__entry__');

    return { branchPoints, capSuccessNext };
  }

  /**
   * Build DAGDeriverAnnotations from the routing trie.
   *
   * Topology (Wave 3 H10 — open-world):
   * 1. `aonprd:taxonomy-route` (URL router) is the DAG entrypoint. Per leaf
   *    concept it routes to that concept's first cap (from `entryTargets`).
   *    Unknown URLs go to `aonprd:make-unknown`.
   * 2. Each cap routes BOTH its `success` and `error` outcomes to the same
   *    downstream target:
   *    - A uniform single target (read from `capSuccessNext`), or
   *    - A concept-dispatch node (when the next cap differs per concept), or
   *    - `flow:terminate` (the cap is the tail of its chain or unused).
   *    Open-world: a capability emitting `'error'` means its hardRequired
   *    metadata was absent or its slice failed; downstream caps handle
   *    absence themselves. The chain proceeds. The only failure mode is
   *    "chain completed without producing a `_type`", caught at end-of-chain
   *    in `parse.taxonomic.ts`.
   * 3. Each concept-dispatch node routes per `aonprdConceptId` to the next
   *    cap for that concept (from `branchPoints`).
   * 4. Tail caps route to `flow:terminate`.
   */
  static #buildAnnotations(
    leafIds:            readonly string[],
    chainMap:           ReadonlyMap<string, readonly CapabilityNode[]>,
    allCapsByName:      ReadonlyMap<string, CapabilityNode>,
    branchPoints:       ReadonlyMap<string, ReadonlyMap<string, string>>,
    branchDispatchNames: ReadonlyMap<string, string>,
    capSuccessNext:     ReadonlyMap<string, string>,
    fallbackConceptId:  string | null,
  ): DAGDeriverAnnotations {
    // ── URL router terminals ──────────────────────────────────────────────────
    // Per concept, route to the FIRST cap in that concept's chain (or
    // flow:terminate for an empty chain).
    const routerTerminals: { outcome: string; target: string | null }[] = leafIds.map((id) => {
      const chain = chainMap.get(id) ?? [];
      const first = chain[0]?.name ?? 'flow:terminate';
      return { outcome: id, target: first };
    });
    // Wave 7 M7: if a fallback concept is configured (e.g. `generic`), wire
    // the fallback outcome to its first cap. The router emits the fallback
    // outcome instead of `'unknown'` when no URL match is found.
    if (fallbackConceptId !== null) {
      const chain = chainMap.get(fallbackConceptId) ?? [];
      const first = chain[0]?.name ?? 'aonprd:make-unknown';
      routerTerminals.push({ outcome: fallbackConceptId, target: first });
    }
    routerTerminals.push({ outcome: 'unknown', target: 'aonprd:make-unknown' });

    // ── Capability terminals ──────────────────────────────────────────────────
    const capabilityTerminals: Record<string, readonly { outcome: string; target: string | null }[]> = {};

    for (const [name, cap] of allCapsByName) {
      const terminals: { outcome: string; target: string | null }[] = [];

      // Resolve the cap's downstream target: either a uniform direct target
      // (success edges agree across all concepts using this cap), a branch
      // dispatcher (success edges diverge per concept), or `flow:terminate`
      // (the cap is registered but not used by any concept's chain).
      let downstreamTarget: string;
      const uniformTarget = capSuccessNext.get(name);
      if (uniformTarget !== undefined) {
        downstreamTarget = uniformTarget;
      } else if (branchDispatchNames.has(name)) {
        downstreamTarget = branchDispatchNames.get(name)!;
      } else {
        downstreamTarget = 'flow:terminate';
      }

      // Open-world routing (Wave 3 H10): BOTH `'success'` and `'error'` route
      // to the same downstream target. A capability that emits `'error'`
      // means its hardRequired metadata was absent or its slice failed —
      // downstream caps that depend on that cap's produces handle the
      // absence themselves (typically soft-failing, per Wave 1). The chain
      // proceeds. The only failure mode is "chain completed without
      // producing a `_type`", which is caught at the end of the chain in
      // `parse.taxonomic.ts` (and emits a contract warning).
      //
      // This harmonizes the DAG-dispatch path with the direct-call path in
      // `parse.taxonomic.ts`, which already discards individual node
      // outcomes and continues. See
      // `docs/taxonomic-extraction-redesign.md` Layer 4 item 3.
      if ((cap.outputs as readonly string[]).includes('success')) {
        terminals.push({ outcome: 'success', target: downstreamTarget });
      }
      if ((cap.outputs as readonly string[]).includes('error')) {
        terminals.push({ outcome: 'error', target: downstreamTarget });
      }

      if (terminals.length > 0) {
        capabilityTerminals[name] = terminals;
      }
    }

    // ── Branch dispatcher terminals ───────────────────────────────────────────
    const dispatchTerminals: Record<string, readonly { outcome: string; target: string | null }[]> = {};
    for (const [position, perConcept] of branchPoints) {
      const dispatchName = branchDispatchNames.get(position);
      if (dispatchName === undefined) continue;
      const terminals: { outcome: string; target: string | null }[] = [];
      for (const leafId of leafIds) {
        const target = perConcept.get(leafId) ?? 'flow:terminate';
        terminals.push({ outcome: leafId, target });
      }
      terminals.push({ outcome: 'unknown', target: 'aonprd:make-unknown' });
      dispatchTerminals[dispatchName] = terminals;
    }

    return {
      terminals: {
        'aonprd:taxonomy-route': routerTerminals,
        ...capabilityTerminals,
        ...dispatchTerminals,
        'aonprd:make-unknown': [{ outcome: 'success', target: 'flow:terminate' }],
        'flow:terminate':      [{ outcome: 'success', target: null }],
      },
    };
  }

  /** URL → concept ID (a leaf concept whose urlPaths includes the URL's AON path). Null when no match. */
  routeUrl(url: string): string | null {
    const path = extractAonPath(url);
    if (path === null) return null;
    return this.#urlMap.get(path) ?? null;
  }

  /** Concept ID → ordered NodeInterface[] (inherited capabilities by ancestor depth, then declaration order within each concept). Empty array for unknown concept. */
  chainFor(conceptId: string): readonly CapabilityNode[] {
    return this.#chainMap.get(conceptId) ?? [];
  }

  /** Name of the entrypoint node. */
  entrypoint(): string {
    return this.#router.name;
  }

  /** All NodeInterfaces to register on the dispatcher. */
  allNodes(): readonly CapabilityNode[] {
    return this.#allNodesList;
  }

  /** DAGDeriverAnnotations for DAGDeriver.derive. */
  annotations(): DAGDeriverAnnotations {
    return this.#annotations;
  }

  /** All concept IDs registered with the compiled taxonomy. */
  conceptIds(): readonly string[] {
    return this.#conceptIds;
  }

  /** Concept IDs that have at least one URL path bound to them. */
  leafConceptIds(): readonly string[] {
    return this.#leafIds;
  }

  /**
   * Static fields layered onto `state.output` for a concept (Wave 6 M1).
   * Returns the concept's declared `discriminator` (typically
   * `{ _type: '<concept>' }`) or an empty object for concepts without one.
   *
   * Direct-call entry points (e.g. `parse.taxonomic.ts`) consume this to
   * stamp the discriminator at the same logical point the DAG router does.
   */
  discriminatorFor(conceptId: string): Readonly<Record<string, unknown>> {
    return this.#discriminatorMap.get(conceptId) ?? {};
  }

  /**
   * The fallback concept id (one with `urlPaths: []`), or null if none is
   * declared. The URL router emits this outcome when a URL doesn't match any
   * leaf; direct-call entry points use it the same way (Wave 7 M7).
   */
  fallbackConceptId(): string | null {
    return this.#fallbackConceptId;
  }
}

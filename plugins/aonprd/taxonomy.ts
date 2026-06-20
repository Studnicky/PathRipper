// Taxonomy compiler.
//
// Compiles a declarative concept tree (ConceptDecl[]) into a DAG-ready node
// set and a DAGType built via DAGBuilder.
//
// The pipeline switch in parse.dag.ts / parse.task.ts is NOT touched here;
// this module is an orphan library until the taxonomy router wires it in.
import { DAGBuilder } from '@studnicky/dagonizer';
import type { NodeInterface, DAGType } from '@studnicky/dagonizer';

import type { ScrapeState }    from '../../src/state/ScrapeState.js';
import { makeTaxonomyRouter, makeConceptDispatch }  from './nodes/taxonomyRouter.js';

// ─── Internal annotation type ─────────────────────────────────────────────────
// Internal routing table consumed by buildDAG() to drive DAGBuilder placement
// calls. Built by #buildAnnotations from the compiled concept trie.

type TerminalEntry =
  | { outcome: string; target: string }
  | { outcome: string; emit: { name: string; outcome: string } };

type AnnotationsType = {
  terminals: Record<string, readonly TerminalEntry[]>;
};

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
type CapabilitySuccessOnlyNode  = NodeInterface<ScrapeState, 'success', unknown>;
type CapabilitySuccessErrorNode = NodeInterface<ScrapeState, 'success' | 'error', unknown>;
type CapabilityRouterNode       = NodeInterface<ScrapeState, string, unknown>;
export type CapabilityNode = CapabilitySuccessOnlyNode | CapabilitySuccessErrorNode | CapabilityRouterNode;

// A capability chain is a plain array of nodes. Chainability (each successor's
// `hardRequired` ⊆ a predecessor's `produces`) is checked at the type layer via
// dagonizer's native `ChainableType<A, B>`, and enforced at DAG-construction
// time by `ContractRegistryValidator` (a `DAGError` on dangling-reads / dead-writes).

/**
 * Declarative concept node in the taxonomy.
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
export interface ConceptDecl<TOutput = never> {
  /** Concept name — used as the router-output name. Must be unique. */
  readonly id: string;
  /** Parent concept ID. Null only for the root. Every non-null parent must exist in the same array. */
  readonly parent: string | null;
  /** URL paths (case-insensitive match against AON's `/Path.aspx`) that route directly to this concept. Leaf concepts only — interior concepts have no urlPaths. Same path on multiple concepts is an error. */
  readonly urlPaths?: readonly string[];
  /** Capability nodes added by this concept. Inherited downward by descendant concepts. May be empty. */
  readonly capabilities: readonly CapabilityNode[];
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
 *.
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
  readonly code: 'duplicate-id' | 'orphan-parent' | 'cycle' | 'duplicate-url-path' | 'multiple-roots' | 'no-root' | 'urlpath-on-interior';

  constructor(code: TaxonomyError['code'], message: string) {
    super(message);
    this.name = 'TaxonomyError';
    this.code = code;
  }
}

// ─── URL path extraction ──────────────────────────────────────────────────────

/** Extract the lowercase AON path segment from any URL. Returns null on no match. */
function extractAonPath(url: string): string | null {
  const match = /\/([A-Za-z]+)\.aspx/i.exec(url);
  return match !== null ? match[1]!.toLowerCase() : null;
}

// ─── Validation helpers ───────────────────────────────────────────────────────

function validateConcepts(concepts: readonly ConceptDecl<unknown>[]): void {
  // (Contract-shape validation removed in dagonizer 0.24: NodeInterface no longer
  // carries a `contract` field — DAGBuilder's exhaustive routing replaces it.)

  // Count roots
  const roots = concepts.filter((concept) => concept.parent === null);
  if (roots.length === 0) {
    throw new TaxonomyError('no-root', 'Taxonomy must have exactly one root concept (parent: null).');
  }
  if (roots.length > 1) {
    const ids = roots.map((root) => `'${root.id}'`).join(', ');
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
  const byId = new Map<string, ConceptDecl<unknown>>(concepts.map((concept) => [concept.id, concept]));
  const visited   = new Set<string>();
  const onStack   = new Set<string>();

  function dfs(conceptId: string): void {
    if (onStack.has(conceptId)) {
      throw new TaxonomyError('cycle', `Cycle detected involving concept '${conceptId}'.`);
    }
    if (visited.has(conceptId)) return;
    onStack.add(conceptId);
    const concept = byId.get(conceptId)!;
    if (concept.parent !== null) dfs(concept.parent);
    onStack.delete(conceptId);
    visited.add(conceptId);
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
  readonly #annotations:        AnnotationsType;
  readonly #fallbackConceptId:  string | null;

  private constructor(
    router:             CapabilityNode,
    conceptIds:         readonly string[],
    leafIds:            readonly string[],
    chainMap:           ReadonlyMap<string, readonly CapabilityNode[]>,
    urlMap:             ReadonlyMap<string, string>,
    allNodesList:       readonly CapabilityNode[],
    annotations:        AnnotationsType,
    fallbackConceptId:  string | null,
  ) {
    this.#router             = router;
    this.#conceptIds         = conceptIds;
    this.#leafIds            = leafIds;
    this.#chainMap           = chainMap;
    this.#urlMap             = urlMap;
    this.#allNodesList       = allNodesList;
    this.#annotations        = annotations;
    this.#fallbackConceptId  = fallbackConceptId;
  }

  /** Validate concepts and build the compiled taxonomy. Throws TaxonomyError on invalid input. */
  static compile(concepts: readonly ConceptDecl<unknown>[]): Taxonomy {
    // Empty taxonomy is a special case: skip most validation
    if (concepts.length === 0) {
      return Taxonomy.#buildEmpty();
    }

    validateConcepts(concepts);

    const byId = new Map<string, ConceptDecl<unknown>>(concepts.map((concept) => [concept.id, concept]));

    // Build ancestor chain (root → concept) for each concept
    function ancestorChain(conceptId: string): readonly string[] {
      const chain: string[] = [];
      let current: string | null = conceptId;
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
      .filter((concept) => concept.urlPaths !== undefined && concept.urlPaths.length > 0)
      .map((concept) => concept.id);

    // fallback concept (one with `urlPaths: []` and `capabilities`
    // declared). Receives unmatched URLs that the router would otherwise send
    // to `make-unknown`. By convention there is at most one fallback per
    // taxonomy; if multiple are declared, the first wins.
    const fallbackConcept = concepts.find((concept) =>
      concept.urlPaths !== undefined && concept.urlPaths.length === 0 && concept.capabilities.length > 0,
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

    const router = makeTaxonomyRouter(routeUrl, leafIds, fallbackConceptId);

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

    const conceptIds = concepts.map((concept) => concept.id);

    return new Taxonomy(router, conceptIds, leafIds, chainMap, urlMap, allNodesList, annotations, fallbackConceptId);
  }

  static #buildEmpty(): Taxonomy {
    const router          = makeTaxonomyRouter(() => null, []);
    const conceptDispatch = makeConceptDispatch([]);

    const allNodesList: CapabilityNode[] = [
      router,
      conceptDispatch,
    ];

    const AONPRD_UNKNOWN_TERMINAL = { name: 'aonprd:unknown-end', outcome: 'completed' } as const;

    const annotations: AnnotationsType = {
      terminals: {
        'aonprd:taxonomy-route':   [{ outcome: 'unknown', emit: AONPRD_UNKNOWN_TERMINAL }],
        'aonprd:concept-dispatch': [{ outcome: 'unknown', emit: AONPRD_UNKNOWN_TERMINAL }],
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
      let posMap = perPositionNext.get(position);
      if (posMap === undefined) {
        posMap = new Map();
        perPositionNext.set(position, posMap);
      }
      // For a given concept at a position, the next must be deterministic.
      // (A concept's chain is a fixed sequence — no two appearances of the
      // same cap in one chain should have different successors. Caller honors.)
      if (!posMap.has(conceptId)) posMap.set(conceptId, nextTarget);
    }

    for (const leafId of leafIds) {
      const chain = chainMap.get(leafId) ?? [];
      if (chain.length === 0) {
        recordNext('__entry__', leafId, 'flow:terminate');
        continue;
      }
      // Entry routes to the first cap of this concept's chain.
      recordNext('__entry__', leafId, chain[0]!.name);
      for (let index = 0; index < chain.length; index++) {
        const cap     = chain[index]!;
        const next    = index < chain.length - 1 ? chain[index + 1]!.name : 'flow:terminate';
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
   * Build the AnnotationsType routing table from the concept trie.
   *
   * Topology (open-world):
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
   *    absence themselves. The chain proceeds.
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
  ): AnnotationsType {
    const AONPRD_UNKNOWN_TERMINAL   = { name: 'aonprd:unknown-end', outcome: 'completed' } as const;
    const AONPRD_COMPLETED_TERMINAL = { name: 'aonprd:completed',   outcome: 'completed' } as const;

    // ── URL router terminals ──────────────────────────────────────────────────
    // Per concept, route to the FIRST cap in that concept's chain (or
    // the unknown emit terminal for an empty chain).
    const routerTerminals: TerminalEntry[] = leafIds.map((leafId) => {
      const chain = chainMap.get(leafId) ?? [];
      const first = chain[0]?.name ?? null;
      if (first !== null) {
        return { outcome: leafId, target: first };
      }
      return { outcome: leafId, emit: AONPRD_COMPLETED_TERMINAL };
    });
    // if a fallback concept is configured (e.g. `generic`), wire
    // the fallback outcome to its first cap. The router emits the fallback
    // outcome instead of `'unknown'` when no URL match is found.
    if (fallbackConceptId !== null) {
      const chain = chainMap.get(fallbackConceptId) ?? [];
      const first = chain[0]?.name ?? null;
      if (first !== null) {
        routerTerminals.push({ outcome: fallbackConceptId, target: first });
      } else {
        routerTerminals.push({ outcome: fallbackConceptId, emit: AONPRD_COMPLETED_TERMINAL });
      }
    }
    routerTerminals.push({ outcome: 'unknown', emit: AONPRD_UNKNOWN_TERMINAL });

    // ── Capability terminals ──────────────────────────────────────────────────
    const capabilityTerminals: Record<string, readonly TerminalEntry[]> = {};

    for (const [name, cap] of allCapsByName) {
      const terminals: TerminalEntry[] = [];

      // Resolve the cap's downstream target: either a uniform direct target
      // (success edges agree across all concepts using this cap), a branch
      // dispatcher (success edges diverge per concept), or the completed
      // emit terminal (the cap is a chain tail or registered but unused).
      const uniformTarget = capSuccessNext.get(name);
      const dispatchName  = branchDispatchNames.get(name);

      function makeEntry(outcome: string): TerminalEntry {
        if (uniformTarget !== undefined && uniformTarget !== 'flow:terminate') {
          return { outcome, target: uniformTarget };
        }
        if (dispatchName !== undefined) {
          return { outcome, target: dispatchName };
        }
        // No uniform successor or the uniform successor is the retired flow:terminate
        // placeholder — emit a synthetic TerminalNode to end the flow as completed.
        return { outcome, emit: AONPRD_COMPLETED_TERMINAL };
      }

      // Open-world routing: BOTH `'success'` and `'error'` route to the same
      // downstream target. A capability that emits `'error'` means its
      // hardRequired metadata was absent or its slice failed — downstream
      // caps that depend on that cap's produces handle the absence themselves
      // (typically soft-failing). The chain proceeds. This harmonizes the
      // DAG-dispatch path with the direct-call path in `parse.taxonomic.ts`,
      // which already discards individual node outcomes and continues.
      if ((cap.outputs as readonly string[]).includes('success')) {
        terminals.push(makeEntry('success'));
      }
      if ((cap.outputs as readonly string[]).includes('error')) {
        terminals.push(makeEntry('error'));
      }

      if (terminals.length > 0) {
        capabilityTerminals[name] = terminals;
      }
    }

    // ── Branch dispatcher terminals ───────────────────────────────────────────
    const dispatchTerminals: Record<string, readonly TerminalEntry[]> = {};
    for (const [position, perConcept] of branchPoints) {
      const dispatchName = branchDispatchNames.get(position);
      if (dispatchName === undefined) continue;
      const terminals: TerminalEntry[] = [];
      for (const leafId of leafIds) {
        const target = perConcept.get(leafId);
        if (target !== undefined && target !== 'flow:terminate') {
          terminals.push({ outcome: leafId, target });
        } else {
          // No further cap for this concept at this branch, or target is the
          // retired flow:terminate placeholder — emit a completed terminal.
          terminals.push({ outcome: leafId, emit: AONPRD_COMPLETED_TERMINAL });
        }
      }
      terminals.push({ outcome: 'unknown', emit: AONPRD_UNKNOWN_TERMINAL });
      dispatchTerminals[dispatchName] = terminals;
    }

    return {
      terminals: {
        'aonprd:taxonomy-route': routerTerminals,
        ...capabilityTerminals,
        ...dispatchTerminals,
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

  /**
   * Build a `DAGType` from the compiled taxonomy using `DAGBuilder`.
   *
   * Translates the routing annotations into explicit `.node()` and `.terminal()`
   * placements. The entrypoint is set to the taxonomy router node name.
   *
   * @param dagName - DAG registration name (e.g. `'aonprd:parse'`).
   * @param version - DAG version string (e.g. `'3.0'`).
   */
  buildDAG(dagName: string, version: string): DAGType {
    const nodeByName = new Map<string, CapabilityNode>(
      this.#allNodesList.map((node) => [node.name, node]),
    );

    // Collect terminal emit declarations: deduplication by terminal name.
    const declaredTerminals = new Map<string, 'completed' | 'failed'>();

    for (const entries of Object.values(this.#annotations.terminals)) {
      for (const entry of entries) {
        if ('emit' in entry) {
          const emitOutcome = entry.emit.outcome === 'failed' ? 'failed' : 'completed';
          declaredTerminals.set(entry.emit.name, emitOutcome);
        }
      }
    }

    const builder = new DAGBuilder(dagName, version)
      .entrypoint(this.#router.name);

    // Add each node with its routes.
    for (const [nodeName, entries] of Object.entries(this.#annotations.terminals)) {
      const node = nodeByName.get(nodeName);
      if (node === undefined) continue; // dispatch node or router — handled below

      const routes: Record<string, string> = {};
      for (const entry of entries) {
        if ('target' in entry) {
          routes[entry.outcome] = entry.target;
        } else {
          routes[entry.outcome] = entry.emit.name;
        }
      }
      builder.node(nodeName, node, routes);
    }

    // Add all terminals.
    for (const [terminalName, terminalOutcome] of declaredTerminals) {
      builder.terminal(terminalName, { outcome: terminalOutcome });
    }

    return builder.build();
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
   * The fallback concept id (one with `urlPaths: []`), or null if none is
   * declared. The URL router emits this outcome when a URL doesn't match any
   * leaf; direct-call entry points use it the same way.
   */
  fallbackConceptId(): string | null {
    return this.#fallbackConceptId;
  }
}

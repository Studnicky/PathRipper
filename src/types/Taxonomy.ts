import type { NodeInterface } from '@studnicky/dagonizer';

import type { ScrapeState } from '../state/ScrapeState.js';

// Internal sub-union members — not exported; callers use CapabilityNode.
type CapabilitySuccessOnlyNode  = NodeInterface<ScrapeState, 'success', unknown>;
type CapabilitySuccessErrorNode = NodeInterface<ScrapeState, 'success' | 'error', unknown>;
type CapabilityRouterNode       = NodeInterface<ScrapeState, string, unknown>;

/**
 * Capability nodes come in three output shapes:
 *  - `'success'` only — terminal nodes (`flow:terminate`, `<ns>:make-unknown`)
 *    and finalize nodes (pure assemblers).
 *  - `'success' | 'error'` — extract nodes that can soft-fail when their
 *    `hardRequired` metadata is absent.
 *  - widened `string` — taxonomy router + concept-dispatch nodes whose
 *    outputs are computed from the concept list at compile time.
 *
 * Narrowing the union (vs widening every node to `string`) keeps typos in
 * `'success'`/`'error'` from compiling silently.
 *
 * @category Taxonomy
 * @since 3.0.0
 * @group Types
 */
export type CapabilityNode = CapabilitySuccessOnlyNode | CapabilitySuccessErrorNode | CapabilityRouterNode;

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
 * This type lives in plugin-agnostic infrastructure: a future plugin can
 * supply its own `ConceptDecl<XxxOutput>` declarations with no changes to
 * this module.
 *
 * @category Taxonomy
 * @since 3.0.0
 * @group Types
 */
export type ConceptDecl<TOutput = never> = {
  /** Concept name — used as the router-output name. Must be unique. */
  readonly id: string;
  /** Parent concept ID. Null only for the root. Every non-null parent must exist in the same array. */
  readonly parent: string | null;
  /** URL paths (case-insensitive match via the plugin's pathExtractor) that route directly to this concept. Leaf concepts only — interior concepts have no urlPaths. Same path on multiple concepts is an error. */
  readonly urlPaths?: readonly string[];
  /** Capability nodes added by this concept. Inherited downward by descendant concepts. May be empty. */
  readonly capabilities: readonly CapabilityNode[];
  /**
   * Phantom marker that anchors `TOutput` in the declared object so it can be
   * recovered with `ConceptOutputFor<typeof xxxConcept>`. Never set at runtime;
   * type-only.
   */
  readonly outputType?: TOutput;
};

/**
 * Recover the output type for a single `ConceptDecl<TOutput>` value.
 *
 * @example
 * ```ts
 * type L = ConceptOutputFor<typeof languageConcept>; // LanguageOutput
 * ```
 *
 * @category Taxonomy
 * @since 3.0.0
 * @group Types
 */
export type ConceptOutputFor<TDecl extends ConceptDecl<unknown>> =
  TDecl extends ConceptDecl<infer TOutput> ? TOutput : never;

/**
 * Union of every concept's output type in a taxonomy declaration tuple.
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
 *
 * @category Taxonomy
 * @since 3.0.0
 * @group Types
 */
export type ConceptOutputUnion<TArray extends readonly ConceptDecl<unknown>[]> =
  TArray[number] extends ConceptDecl<infer TOutput> ? TOutput : never;

/**
 * Options supplied to `Taxonomy.compile()` to parameterize the generated node
 * names and URL routing for a specific plugin namespace.
 *
 * @category Taxonomy
 * @since 3.0.0
 * @group Types
 */
export type TaxonomyCompileOptions = {
  /** Plugin namespace — prefixes every generated node name (e.g. 'aonprd'). */
  namespace: string;
  /** Extract a lowercase path token from a URL. Returns null when the URL does not match. */
  pathExtractor: (url: string) => string | null;
};

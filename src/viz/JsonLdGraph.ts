/**
 * @fileoverview `JsonLdGraph` — pure JSON-LD to graph payload adapter.
 *
 * @remarks
 * Converts a compacted JSON-LD document (with `@context`) into a
 * `VizPayloadInterface` suitable for rendering. No DOM, no library imports.
 * All compaction uses the document's own `@context`.
 *
 * @module viz/JsonLdGraph
 * @category Viz
 * @since 0.2.0
 */

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/**
 * A single graph node derived from a JSON-LD entity.
 *
 * @category Viz
 * @since 0.2.0
 * @group Types
 */
export interface VizNodeInterface {
  /** Entity `@id` (compacted if possible, else full IRI). */
  readonly id:          string;
  /** Human-readable label (compacted via `@context`). */
  readonly label:       string;
  /** First `@type` value (full IRI) or `undefined` when untyped. */
  readonly classIri:    string | undefined;
  /** Compacted class label (e.g. `'aonprd:Feat'`) or `undefined`. */
  readonly classLabel:  string | undefined;
  /** Named graph IRI this entity belongs to (for coloring), or `undefined`. */
  readonly graphIri:    string | undefined;
  /** Literal properties keyed by compacted predicate label → array of string values. */
  readonly properties:  Readonly<Record<string, ReadonlyArray<string>>>;
}

/**
 * A directed edge between two graph nodes.
 *
 * @category Viz
 * @since 0.2.0
 * @group Types
 */
export interface VizEdgeInterface {
  /** Synthetic id: `'<source>--<predicate>->><target>'`. */
  readonly id:       string;
  /** Source node id. */
  readonly source:   string;
  /** Target node id. */
  readonly target:   string;
  /** Compacted predicate label. */
  readonly label:    string;
  /** Named graph IRI this edge belongs to, or `undefined`. */
  readonly graphIri: string | undefined;
}

/**
 * Named graph descriptor for legend rendering.
 *
 * @category Viz
 * @since 0.2.0
 * @group Types
 */
export interface VizGraphDescriptorInterface {
  /** Full named-graph IRI. */
  readonly id:    string;
  /** Compacted label (or IRI verbatim when no prefix applies). */
  readonly label: string;
}

/**
 * Complete payload for rendering a squashage JSON-LD as an interactive graph.
 *
 * @category Viz
 * @since 0.2.0
 * @group Types
 */
export interface VizPayloadInterface {
  /** All entity nodes. */
  readonly nodes:    ReadonlyArray<VizNodeInterface>;
  /** All directed edges (object-property references). */
  readonly edges:    ReadonlyArray<VizEdgeInterface>;
  /** Distinct named graphs (for legend). */
  readonly graphs:   ReadonlyArray<VizGraphDescriptorInterface>;
  /** Prefix map from the document's `@context` (prefix → base IRI). */
  readonly prefixes: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Mutable working node during construction. */
interface WorkingNodeInterface {
  id:          string;
  label:       string;
  classIri:    string | undefined;
  classLabel:  string | undefined;
  graphIri:    string | undefined;
  properties:  Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// JsonLdGraph
// ---------------------------------------------------------------------------

/**
 * Static-only adapter that converts a compacted JSON-LD document to a
 * `VizPayloadInterface`.
 *
 * @remarks
 * All methods are static; the class cannot be instantiated.
 *
 * @example
 * ```ts
 * const payload = JsonLdGraph.fromCompactedJsonLd(doc);
 * ```
 *
 * @category Viz
 * @since 0.2.0
 * @group Core
 */
export class JsonLdGraph {
  private constructor() { /* static-only */ }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Converts a compacted JSON-LD document to a `VizPayloadInterface`.
   *
   * @remarks
   * Handles two shapes:
   * - Object with top-level `@graph` (squashage shape): walks named-graph
   *   wrappers `{ "@id": graphIRI, "@graph": [...entities] }`.
   * - Single resource object with `@id`.
   *
   * For each entity (object with `@id`):
   * - One `VizNodeInterface` is produced.
   * - Object-property values (objects with `@id`) produce `VizEdgeInterface` entries.
   * - Literal values (`@value` or primitive string/number) accumulate in
   *   `node.properties[predicate]`.
   *
   * Compaction uses longest-prefix match against the document's `@context`.
   * Output is deterministic: edges sorted by `(source, label, target)`, node
   * property keys sorted lexicographically.
   *
   * @param doc - Parsed JSON-LD document (any shape).
   * @returns A `VizPayloadInterface` ready for rendering.
   */
  static fromCompactedJsonLd(doc: unknown): VizPayloadInterface {
    if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
      return { nodes: [], edges: [], graphs: [], prefixes: {} };
    }

    const docObj = doc as Record<string, unknown>;

    // Extract prefix map from @context.
    const prefixes = JsonLdGraph.#extractPrefixes(docObj['@context']);

    // Collect nodes and edges.
    const nodeMap = new Map<string, WorkingNodeInterface>();
    const edges: VizEdgeInterface[] = [];
    const graphIris = new Set<string>();

    const topGraph = docObj['@graph'];
    if (Array.isArray(topGraph)) {
      for (const item of topGraph) {
        if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
        const itemObj = item as Record<string, unknown>;

        // Named-graph wrapper: { "@id": graphIRI, "@graph": [...entities] }
        if (Array.isArray(itemObj['@graph'])) {
          const graphIri = typeof itemObj['@id'] === 'string' ? itemObj['@id'] : undefined;
          if (graphIri !== undefined) graphIris.add(graphIri);

          for (const entity of itemObj['@graph'] as unknown[]) {
            JsonLdGraph.#walkEntity(entity, prefixes, graphIri, nodeMap, edges);
          }
        } else {
          // Top-level entity (no named-graph wrapper).
          JsonLdGraph.#walkEntity(itemObj, prefixes, undefined, nodeMap, edges);
        }
      }
    } else if (typeof docObj['@id'] === 'string') {
      // Single resource object.
      JsonLdGraph.#walkEntity(docObj, prefixes, undefined, nodeMap, edges);
    }

    // Build sorted node list.
    const nodes: VizNodeInterface[] = [...nodeMap.values()].map(n => ({
      id:         n.id,
      label:      n.label,
      classIri:   n.classIri,
      classLabel: n.classLabel,
      graphIri:   n.graphIri,
      properties: JsonLdGraph.#sortedProperties(n.properties),
    }));

    // Sort edges deterministically by (source, label, target).
    edges.sort((a, b) => {
      const sa = `${a.source}\x00${a.label}\x00${a.target}`;
      const sb = `${b.source}\x00${b.label}\x00${b.target}`;
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });

    // Build graph descriptors.
    const graphs: VizGraphDescriptorInterface[] = [...graphIris]
      .sort()
      .map(iri => ({ id: iri, label: JsonLdGraph.#compactIri(iri, prefixes) }));

    return { nodes, edges, graphs, prefixes };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Extracts a prefix map (prefix → base IRI) from a JSON-LD `@context` value.
   *
   * @remarks
   * Only simple string entries in the context are treated as prefixes.
   * Expanded term definitions (`{ '@id': ... }`) are skipped.
   *
   * @param context - The raw `@context` value from the document.
   * @returns Record of prefix label → base IRI.
   */
  static #extractPrefixes(context: unknown): Record<string, string> {
    if (context === null || typeof context !== 'object' || Array.isArray(context)) {
      return {};
    }
    const result: Record<string, string> = {};
    for (const [key, val] of Object.entries(context as Record<string, unknown>)) {
      if (key.startsWith('@')) continue;
      if (typeof val === 'string') {
        result[key] = val;
      }
    }
    return result;
  }

  /**
   * Compacts a full IRI using longest-prefix match.
   *
   * @param iri     - Full IRI to compact.
   * @param prefixes - Prefix map (prefix → base IRI).
   * @returns Compacted form (`prefix:local`) or the original IRI.
   */
  static #compactIri(iri: string, prefixes: Record<string, string>): string {
    let bestPrefix = '';
    let bestBase   = '';

    for (const [prefix, base] of Object.entries(prefixes)) {
      if (iri.startsWith(base) && base.length > bestBase.length) {
        bestPrefix = prefix;
        bestBase   = base;
      }
    }

    if (bestBase.length === 0) return iri;

    const local = iri.slice(bestBase.length);
    if (local.length === 0) return iri;

    return `${bestPrefix}:${local}`;
  }

  /**
   * Walks a single entity object, creating or updating a `WorkingNodeInterface`
   * in `nodeMap` and appending edges.
   *
   * @param entity   - Raw entity object (must have `@id`).
   * @param prefixes - Prefix map for compaction.
   * @param graphIri - Named graph IRI, if the entity lives in one.
   * @param nodeMap  - Mutable node accumulator.
   * @param edges    - Mutable edge accumulator.
   */
  static #walkEntity(
    entity:   unknown,
    prefixes: Record<string, string>,
    graphIri: string | undefined,
    nodeMap:  Map<string, WorkingNodeInterface>,
    edges:    VizEdgeInterface[],
  ): void {
    if (entity === null || typeof entity !== 'object' || Array.isArray(entity)) return;

    const obj = entity as Record<string, unknown>;
    const id  = obj['@id'];
    if (typeof id !== 'string' || id.length === 0) return;

    // Get or create the working node.
    let node = nodeMap.get(id);
    if (node === undefined) {
      const label      = JsonLdGraph.#compactIri(id, prefixes);
      const classIri   = JsonLdGraph.#extractFirstType(obj['@type']);
      const classLabel = classIri !== undefined
        ? JsonLdGraph.#compactIri(classIri, prefixes)
        : undefined;

      node = { id, label, classIri, classLabel, graphIri, properties: {} };
      nodeMap.set(id, node);
    } else {
      // Update graphIri if not set yet.
      if (node.graphIri === undefined && graphIri !== undefined) {
        node.graphIri = graphIri;
      }
    }

    // Walk properties.
    for (const [key, value] of Object.entries(obj)) {
      if (key.startsWith('@')) continue;

      const predLabel = JsonLdGraph.#compactIri(key, prefixes);

      // Normalize value to an array.
      const values = Array.isArray(value) ? value : [value];

      for (const val of values) {
        if (val === null || val === undefined) continue;

        if (typeof val === 'object' && !Array.isArray(val)) {
          const valObj = val as Record<string, unknown>;

          if (typeof valObj['@id'] === 'string') {
            // Object reference → edge.
            const targetId = valObj['@id'] as string;
            const edgeId   = `${id}--${predLabel}->>${targetId}`;
            edges.push({
              id:       edgeId,
              source:   id,
              target:   targetId,
              label:    predLabel,
              graphIri,
            });
          } else if ('@value' in valObj) {
            // Literal with @value.
            const str = String(valObj['@value'] ?? '');
            JsonLdGraph.#addProperty(node.properties, predLabel, str);
          } else {
            // Unknown object shape — skip.
          }
        } else if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
          // Plain primitive literal.
          JsonLdGraph.#addProperty(node.properties, predLabel, String(val));
        }
      }
    }
  }

  /**
   * Extracts the first `@type` IRI from a JSON-LD type value.
   *
   * @param typeVal - Raw `@type` value (string, array, or absent).
   * @returns The first type IRI string, or `undefined`.
   */
  static #extractFirstType(typeVal: unknown): string | undefined {
    if (typeof typeVal === 'string') return typeVal;
    if (Array.isArray(typeVal)) {
      const first = typeVal[0];
      return typeof first === 'string' ? first : undefined;
    }
    return undefined;
  }

  /**
   * Appends a value to a property array, creating the array if absent.
   *
   * @param properties - The mutable properties map.
   * @param predicate  - Compacted predicate label.
   * @param value      - String value to append.
   */
  static #addProperty(
    properties: Record<string, string[]>,
    predicate:  string,
    value:      string,
  ): void {
    const arr = properties[predicate];
    if (arr !== undefined) {
      arr.push(value);
    } else {
      properties[predicate] = [value];
    }
  }

  /**
   * Returns a new properties record with keys sorted lexicographically and
   * each array's contents preserved.
   *
   * @param properties - Mutable properties map.
   * @returns Sorted, frozen-compatible record.
   */
  static #sortedProperties(
    properties: Record<string, string[]>,
  ): Readonly<Record<string, ReadonlyArray<string>>> {
    const sorted: Record<string, ReadonlyArray<string>> = {};
    for (const key of Object.keys(properties).sort()) {
      sorted[key] = properties[key] as ReadonlyArray<string>;
    }
    return sorted;
  }
}

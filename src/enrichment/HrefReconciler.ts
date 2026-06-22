/**
 * HrefReconciler — per-record quad reconciliation.
 *
 * Operates on one record's quad set (dozens to hundreds of quads). For each
 * link-predicate edge `<parent> <linkPred> <itemNode>`, it:
 *   1. Finds the item node's href (via `hrefPredicate`).
 *   2. Resolves the href against the EntityIndex.
 *   3. If resolved: rewrites `<parent> <linkPred> <itemNode>` →
 *      `<parent> <linkPred> <canonicalIri>` and drops every quad whose subject
 *      is the item node (collapsing it out of the graph entirely).
 *   4. If unresolved (off-dataset link): leaves the item node and its triples
 *      unchanged.
 *
 * All operations are in-memory on the quad array; no I/O.
 */

import type { Quad, NamedNode, DataFactory } from '@rdfjs/types';

import type { EntityIndex } from './EntityIndex.js';

export class HrefReconciler {
  private constructor() { /* static-only */ }

  /**
   * Reconcile link-item nodes in a quad set.
   *
   * Returns a new quad array. Resolved item nodes are collapsed to direct
   * parent→canonical edges. Unresolved item nodes are kept as-is.
   *
   * @param quads          - Input quad set for one record.
   * @param linkPredicates - Set of predicate IRIs that connect parent → item node.
   * @param hrefPredicate  - Predicate IRI on item nodes carrying the resolvable href.
   * @param index          - Canonical entity index.
   * @param factory        - RDF/JS DataFactory for constructing new quads.
   * @returns Rewritten quad array (shallow-copied entries where unchanged).
   */
  static reconcile(
    quads:          ReadonlyArray<Quad>,
    linkPredicates: ReadonlySet<string>,
    hrefPredicate:  string,
    index:          EntityIndex,
    factory:        DataFactory,
  ): Quad[] {
    // Pass 1: collect all item-node IRIs (objects of any link-predicate quad).
    const itemNodeIris = new Set<string>();
    for (const quad of quads) {
      if (
        linkPredicates.has(quad.predicate.value) &&
        quad.object.termType === 'NamedNode'
      ) {
        itemNodeIris.add((quad.object as NamedNode).value);
      }
    }
    if (itemNodeIris.size === 0) return [...quads];

    // Pass 2: collect href values for each item node.
    const itemHrefs = new Map<string, string>(); // itemIri → href value
    for (const quad of quads) {
      if (
        quad.predicate.value      === hrefPredicate &&
        quad.subject.termType     === 'NamedNode'   &&
        quad.object.termType      === 'Literal'     &&
        itemNodeIris.has((quad.subject as NamedNode).value)
      ) {
        itemHrefs.set((quad.subject as NamedNode).value, quad.object.value);
      }
    }

    // Pass 3: resolve hrefs → canonical IRIs.
    const resolved = new Map<string, string>(); // itemIri → canonicalIri
    for (const [itemIri, href] of itemHrefs) {
      const canonicalIri = index.resolve(href);
      if (canonicalIri !== undefined) {
        resolved.set(itemIri, canonicalIri);
      }
    }
    if (resolved.size === 0) return [...quads];

    // Pass 4: rewrite quads.
    const result: Quad[] = [];
    for (const quad of quads) {
      // Rewrite link edges → canonical target.
      if (
        linkPredicates.has(quad.predicate.value) &&
        quad.object.termType === 'NamedNode'
      ) {
        const canonicalIri = resolved.get((quad.object as NamedNode).value);
        if (canonicalIri !== undefined) {
          result.push(factory.quad(
            quad.subject as NamedNode,
            quad.predicate as NamedNode,
            factory.namedNode(canonicalIri),
            quad.graph as Parameters<DataFactory['quad']>[3],
          ));
          continue;
        }
      }
      // Drop all quads whose subject is a resolved item node.
      if (
        quad.subject.termType === 'NamedNode' &&
        resolved.has((quad.subject as NamedNode).value)
      ) {
        continue;
      }
      result.push(quad);
    }
    return result;
  }
}

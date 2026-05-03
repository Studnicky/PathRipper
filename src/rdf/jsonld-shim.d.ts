/**
 * Ambient module shim for `jsonld`.
 *
 * `jsonld` v9.x ships as pure JavaScript with no bundled TypeScript
 * declarations and no community `@types/jsonld` package covers v9.
 * This shim covers the one surface squashage uses: `jsonld.toRDF()` with
 * `{ format: 'application/n-quads' }` returns a Promise<string>.
 *
 * This file follows the `*-shim.d.ts` naming convention that the `.gitignore`
 * negation rule (`!src/**\/*-shim.d.ts`) allows to be committed.
 *
 * When v1.x swaps to `@semantics/rdf-io` (which ships its own declarations)
 * this file and the corresponding `jsonld` dependency are removed.
 *
 * @since 2.2.0
 */

declare module 'jsonld' {
  /** Options accepted by {@link jsonld.toRDF}. */
  interface ToRdfOptions {
    /** Output serialization format.  Pass `'application/n-quads'` to get a string back. */
    format?: string;
    /** Base IRI applied during expansion. */
    base?: string;
  }

  /**
   * Converts a JSON-LD document to RDF.
   *
   * When `options.format` is `'application/n-quads'` the return type is `string`
   * (an N-Quads serialisation).  Otherwise an RDF dataset object is returned.
   */
  function toRDF(input: unknown, options?: ToRdfOptions): Promise<string>;

  export { toRDF };
}

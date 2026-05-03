/**
 * Ambient module shim for `n3`.
 *
 * `n3` v2.x ships as pure JavaScript with no bundled TypeScript declarations
 * and no `@types/n3` package is available.  This shim covers the surface
 * squashage uses: the named `Parser` export and the types it returns.
 *
 * The `Quad` produced by N3 satisfies `@rdfjs/types` `Quad`; we type the
 * callback accordingly so callers receive properly typed terms.
 *
 * This file follows the `*-shim.d.ts` naming convention that the `.gitignore`
 * negation rule (`!src/**\/*-shim.d.ts`) allows to be committed.
 *
 * When v1.x swaps to `@semantics/rdf-io` (which ships its own declarations)
 * this file and the corresponding `n3` dependency are removed.
 *
 * @since 2.2.0
 */

import type { Quad } from '@rdfjs/types';

declare module 'n3' {
  /** Named-node value string to prefix IRI string. */
  type Prefixes = Record<string, string>;

  /** Callback signature used by {@link Parser.parse} when a callback is supplied. */
  type ParseCallback = (
    error:    Error | null,
    quad:     Quad  | null,
    prefixes: Prefixes | undefined,
  ) => void;

  /** Options accepted by the {@link Parser} constructor. */
  interface ParserOptions {
    format?:           string;
    baseIRI?:          string;
    blankNodePrefix?:  string;
  }

  class Parser {
    constructor(options?: ParserOptions);
    /**
     * Parses N3/Turtle/TriG/N-Triples/N-Quads text.
     *
     * When `callback` is supplied parsing is asynchronous: `callback` is
     * called once per quad, then once with `(null, null, prefixes)` on
     * completion, or once with `(error, null, undefined)` on failure.
     */
    parse(input: string, callback: ParseCallback): void;
    /** Synchronous form — returns all quads; throws on error. */
    parse(input: string): Quad[];
  }
}

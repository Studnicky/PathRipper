// Options supplied to Taxonomy.compile() to parameterize the generated node
// names and URL routing for a specific plugin namespace.

/** Options supplied to Taxonomy.compile() to parameterize the generated node names and URL routing for a specific plugin namespace. */
export interface TaxonomyCompileOptions {
  /** Plugin namespace — prefixes every generated node name (e.g. 'aonprd'). */
  namespace: string;
  /** Extract a lowercase path token from a URL. Returns null when the URL does not match. */
  pathExtractor: (url: string) => string | null;
}

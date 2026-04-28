/** Flat key-value map of a parsed wikitext infobox or section. */
export type WikitextSectionType = Record<string, string | string[] | number | boolean | null>;

/** A fully parsed wikitext page with infobox, sections, and categories. */
export interface ParsedPageInterface {
  /** Article title. */
  readonly title: string;
  /** Infobox fields as a flat key-value map. */
  readonly infobox: WikitextSectionType;
  /** Ordered list of page sections with their title and wikitext. */
  readonly sections: ReadonlyArray<{ readonly title: string; readonly text: string }>;
  /** Categories the page belongs to. */
  readonly categories: readonly string[];
}

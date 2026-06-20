import type wtf from 'wtf_wikipedia';

/**
 * Internal type for a single section element returned by `wtf_wikipedia`.
 *
 * @remarks Derived from the return type of `wtf().sections()` for use in `WikitextParser`.
 * @example
 * ```ts
 * const s: WtfSectionType = doc.sections()[0];
 * ```
 * @category Scrapers
 * @since 2.0.0
 * @group Scrapers
 * @see WikitextParser
 */
export type WtfSectionType = ReturnType<ReturnType<typeof wtf>['sections']> extends ReadonlyArray<infer S> ? S : ReturnType<ReturnType<typeof wtf>['sections']>;

/**
 * Flat key-value map of a parsed wikitext infobox or section.
 *
 * @remarks Values may be strings, string arrays, numbers, booleans, or null.
 * @example
 * ```ts
 * const infobox: WikitextSectionType = { name: 'Tarrasque', cr: 30 };
 * ```
 * @category Scrapers
 * @since 2.0.0
 * @group Scrapers
 * @see ParsedPageType
 */
export type WikitextSectionType = Record<string, string | string[] | number | boolean | null>;

/**
 * A fully parsed wikitext page with infobox, sections, and categories.
 *
 * @remarks Produced by `WikitextParser.parse` from raw wikitext content.
 * @example
 * ```ts
 * const parsed: ParsedPageType = WikitextParser.parse('Tarrasque', wikitext);
 * ```
 * @category Scrapers
 * @since 2.0.0
 * @group Scrapers
 * @see WikitextParser
 */
export type ParsedPageType = {
  /** Article title. */
  readonly title: string;
  /** Infobox fields as a flat key-value map. */
  readonly infobox: WikitextSectionType;
  /** Ordered list of page sections with their title and wikitext. */
  readonly sections: ReadonlyArray<{ readonly title: string; readonly text: string }>;
  /** Categories the page belongs to. */
  readonly categories: readonly string[];
};

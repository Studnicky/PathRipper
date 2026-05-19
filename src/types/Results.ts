/**
 * Named return type aliases per `functionReturnTypeNamingValidator`.
 * Only non-trivial aliases live here — primitives and direct interface
 * re-aliases are forbidden by `canonicalDeclarationsValidator`.
 *
 * @remarks
 * Trivial aliases such as `type FooResult = string` are intentionally omitted.
 * Use the primitive directly for those cases.
 *
 * @example
 * ```ts
 * import type { FetchPageResult } from '../types/Results.js';
 * async fetchPage(title: string): FetchPageResult { ... }
 * ```
 *
 * @module Results
 */

import type { WikiPageInterface, CategoryMemberInterface } from './MediaWikiScraper.js';

// ─── Crawlers ─────────────────────────────────────────────────────────────────

/**
 * Return type of {@link LinkLister.buildList} — a sorted, deduplicated list of
 * collected target URLs.
 *
 * @remarks Resolves after the full recursive crawl completes.
 * @example `const links: BuildListResult = lister.buildList(['https://example.com']);`
 * @category Results
 * @since 2.0.0
 * @see {@link LinkLister}
 * @group Crawlers
 */
export type BuildListResult = Promise<string[]>;

// ─── Scrapers ─────────────────────────────────────────────────────────────────

/**
 * Return type of {@link MediaWikiScraper.fetchPage} — the title and raw wikitext
 * of a single MediaWiki article.
 *
 * @remarks Resolves after a rate-limited API call to the MediaWiki revisions endpoint.
 * @example `const page: FetchPageResult = scraper.fetchPage('Goblin');`
 * @category Results
 * @since 2.0.0
 * @see {@link MediaWikiScraper}
 * @group Scrapers
 */
export type FetchPageResult = Promise<WikiPageInterface>;

/**
 * Return type of {@link MediaWikiScraper.fetchPagesBatch} — up to 50 pages
 * fetched in a single API batch request.
 *
 * @remarks Resolves after a rate-limited batch revisions query.
 * @example `const pages: FetchPagesBatchResult = scraper.fetchPagesBatch(['Goblin', 'Orc']);`
 * @category Results
 * @since 2.0.0
 * @see {@link MediaWikiScraper}
 * @group Scrapers
 */
export type FetchPagesBatchResult = Promise<WikiPageInterface[]>;

/**
 * Return type of {@link MediaWikiScraper.fetchCategory} — all page members
 * of the named category, paginated automatically.
 *
 * @remarks Follows continuation tokens until the full member list is collected.
 * @example `const members: FetchCategoryResult = scraper.fetchCategory('Category:Monsters');`
 * @category Results
 * @since 2.0.0
 * @see {@link MediaWikiScraper}
 * @group Scrapers
 */
export type FetchCategoryResult = Promise<CategoryMemberInterface[]>;

/**
 * Return type of {@link MediaWikiScraper.fetchAllPages} — every article in the
 * wiki's main namespace, enumerated via the allpages API.
 *
 * @remarks Expensive on large wikis — use a configured `categories[]` array to
 * scope the scrape when only a subset of pages is needed.
 * @example `const all: FetchAllPagesResult = scraper.fetchAllPages();`
 * @category Results
 * @since 2.0.0
 * @see {@link MediaWikiScraper}
 * @group Scrapers
 */
export type FetchAllPagesResult = Promise<CategoryMemberInterface[]>;

/**
 * Return type of {@link HtmlScraper.fetchText} — the raw HTML string of the
 * fetched page (without the Cheerio handle).
 *
 * @remarks Convenience wrapper around {@link HtmlScraper.fetchPage} for callers
 * that only need the raw string.
 * @example `const html: FetchTextResult = scraper.fetchText('/wiki/Goblin');`
 * @category Results
 * @since 2.0.0
 * @see {@link HtmlScraper}
 * @group Scrapers
 */
export type FetchTextResult = Promise<string>;

// ─── BaseError ────────────────────────────────────────────────────────────────

/**
 * Return type of {@link BaseError.flatten} — the full error cause chain as a
 * flat array, starting with `this`.
 *
 * @remarks Useful for logging or serialising nested error chains without
 * recursive traversal at the call site.
 * @example `const chain: FlattenResult = error.flatten();`
 * @category Results
 * @since 2.0.0
 * @see {@link BaseError}
 * @group Errors
 */
export type FlattenResult = Error[];

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Return type of {@link runHtml} — resolves after all HTML pages have been
 * fetched, processed through the plugin pipeline, and written to disk.
 *
 * @remarks Throws if an unrecoverable error occurs during scraping.
 * @example `const r: ScrapeHtmlResult = runHtml(opts);`
 * @category Results
 * @since 4.0.0
 * @see {@link runHtml}
 * @group Orchestrator
 */
export type ScrapeHtmlResult = Promise<void>;

/**
 * Return type of {@link runWiki} — resolves after all wiki pages have been
 * fetched, processed through the plugin pipeline, and written to disk.
 *
 * @remarks Supports three modes: explicit category, categories[] from config,
 * or full-wiki enumeration via allpages.
 * @example `const r: ScrapeWikiResult = runWiki(opts);`
 * @category Results
 * @since 4.0.0
 * @see {@link runWiki}
 * @group Orchestrator
 */
export type ScrapeWikiResult = Promise<void>;

// ─── Schema ───────────────────────────────────────────────────────────────────

/**
 * Return type of {@link RipperConfigSchema.validate} — `null` when the config
 * is valid; a human-readable error string describing the first violation otherwise.
 *
 * @remarks The string format is suitable for direct display in CLI error messages.
 * @example `const err: ValidateResult = RipperConfigSchema.validate(raw);  if (err) throw new RipperConfigError(err);`
 * @category Results
 * @since 2.0.0
 * @see {@link RipperConfigSchema}
 * @group Schema
 */
export type ValidateResult = string | null;

// ─── WikitextParser ──────────────────────────────────────────────────────────

/**
 * Return type of {@link WikitextParser.infoboxField} — the field value as a
 * string, or `null` when the field is absent from the infobox.
 *
 * @remarks Callers should check for `null` before using the value.
 * @example `const name: InfoboxFieldResult = WikitextParser.infoboxField(parsed, 'name');`
 * @category Results
 * @since 2.0.0
 * @see {@link WikitextParser}
 * @group Scrapers
 */
export type InfoboxFieldResult = string | null;

/**
 * Return type of {@link WikitextParser.infoboxNumber} — the field value parsed
 * as a finite number, or `null` when absent or non-numeric.
 *
 * @remarks Uses `parseFloat` and `Number.isFinite` internally; non-numeric
 * strings silently return `null` rather than `NaN`.
 * @example `const cr: InfoboxNumberResult = WikitextParser.infoboxNumber(parsed, 'cr');`
 * @category Results
 * @since 2.0.0
 * @see {@link WikitextParser}
 * @group Scrapers
 */
export type InfoboxNumberResult = number | null;

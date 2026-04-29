/**
 * Named return type aliases per functionReturnTypeNamingValidator.
 * Only non-trivial aliases are defined here — primitives (string, boolean, void)
 * and direct interface re-aliases are forbidden by canonicalDeclarationsValidator.
 *
 * @remarks
 * Trivial aliases (e.g. `type FooResult = string`) are omitted intentionally;
 * litany's canonicalDeclarationsValidator requires using the primitive directly.
 * @example
 * import type { FetchPageResult } from '../types/Results.js';
 * async fetchPage(title: string): FetchPageResult { ... }
 */

import type { WikiPageInterface, CategoryMemberInterface } from './MediaWikiScraper.js';

// ─── Crawlers ─────────────────────────────────────────────────────────────────

/** Return type of {@link LinkLister.buildList}. @category Results @since 2.0.0 @example `const r: BuildListResult = lister.buildList('https://example.com/index');` */
export type BuildListResult = Promise<string[]>;

// ─── Scrapers ─────────────────────────────────────────────────────────────────

/** Return type of {@link MediaWikiScraper.fetchPage}. @category Results @since 2.0.0 @example `const r: FetchPageResult = scraper.fetchPage('Goblin');` */
export type FetchPageResult = Promise<WikiPageInterface>;
/** Return type of {@link MediaWikiScraper.fetchPagesBatch}. @category Results @since 2.0.0 @example `const r: FetchPagesBatchResult = scraper.fetchPagesBatch(['Goblin', 'Orc']);` */
export type FetchPagesBatchResult = Promise<WikiPageInterface[]>;
/** Return type of {@link MediaWikiScraper.fetchCategory}. @category Results @since 2.0.0 @example `const r: FetchCategoryResult = scraper.fetchCategory('Category:Monsters');` */
export type FetchCategoryResult = Promise<CategoryMemberInterface[]>;
/** Return type of {@link MediaWikiScraper.fetchAllPages}. @category Results @since 2.0.0 @example `const r: FetchAllPagesResult = scraper.fetchAllPages('Category:Monsters');` */
export type FetchAllPagesResult = Promise<CategoryMemberInterface[]>;
/** Return type of {@link MediaWikiScraper.scrapeCategory}. @category Results @since 2.0.0 @example `const r: ScrapeCategoryResult = scraper.scrapeCategory('Category:Monsters');` */
export type ScrapeCategoryResult = Promise<WikiPageInterface[]>;
/** Return type of {@link HtmlScraper.fetchText}. @category Results @since 2.0.0 @example `const r: FetchTextResult = scraper.fetchText('/wiki/Goblin');` */
export type FetchTextResult = Promise<string>;

// ─── BaseError ────────────────────────────────────────────────────────────────

/** Return type of {@link BaseError.flatten}. @category Results @since 2.0.0 @example `const r: FlattenResult = error.flatten();` */
export type FlattenResult = Error[];

// ─── Pipeline / Orchestrator ─────────────────────────────────────────────────

/** Return type of {@link ScrapeOrchestrator.scrapeHtml}. @category Results @since 2.0.0 @example `const r: ScrapeHtmlResult = orchestrator.scrapeHtml(target);` */
export type ScrapeHtmlResult = Promise<void>;
/** Return type of {@link ScrapeOrchestrator.scrapeWiki}. @category Results @since 2.0.0 @example `const r: ScrapeWikiResult = orchestrator.scrapeWiki(target);` */
export type ScrapeWikiResult = Promise<void>;


// ─── Schema ───────────────────────────────────────────────────────────────────

/** Return type of {@link RipperConfigSchema.validate}. `null` = valid; string = error message. @category Results @since 2.0.0 @example `const r: ValidateResult = schema.validate(config);` */
export type ValidateResult = string | null;

// ─── WikitextParser ──────────────────────────────────────────────────────────

/** Return type of {@link WikitextParser.infoboxField}. @category Results @since 2.0.0 @example `const r: InfoboxFieldResult = parser.infoboxField(wikitext, 'name');` */
export type InfoboxFieldResult = string | null;
/** Return type of {@link WikitextParser.infoboxNumber}. @category Results @since 2.0.0 @example `const r: InfoboxNumberResult = parser.infoboxNumber(wikitext, 'cr');` */
export type InfoboxNumberResult = number | null;

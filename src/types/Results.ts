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

import type { RipperConfigInterface } from './Config.js';
import type { WikiPageInterface, CategoryMemberInterface } from './MediaWikiScraper.js';

// ─── Config ───────────────────────────────────────────────────────────────────

/** @remarks Return type of RipperConfig.load(). */
export type ConfigLoadResult = Promise<RipperConfigInterface>;

// ─── Crawlers ─────────────────────────────────────────────────────────────────

/** @remarks Return type of LinkLister.buildList(). */
export type BuildListResult = Promise<string[]>;

// ─── Scrapers ─────────────────────────────────────────────────────────────────

/** @remarks Return type of MediaWikiScraper.fetchPage(). */
export type FetchPageResult = Promise<WikiPageInterface>;
/** @remarks Return type of MediaWikiScraper.fetchPagesBatch(). */
export type FetchPagesBatchResult = Promise<WikiPageInterface[]>;
/** @remarks Return type of MediaWikiScraper.fetchCategory(). */
export type FetchCategoryResult = Promise<CategoryMemberInterface[]>;
/** @remarks Return type of MediaWikiScraper.fetchAllPages(). */
export type FetchAllPagesResult = Promise<CategoryMemberInterface[]>;
/** @remarks Return type of MediaWikiScraper.scrapeCategory(). */
export type ScrapeCategoryResult = Promise<WikiPageInterface[]>;
/** @remarks Return type of HtmlScraper.fetchText(). */
export type FetchTextResult = Promise<string>;

// ─── BaseError ────────────────────────────────────────────────────────────────

/** @remarks Return type of BaseError.flatten(). */
export type FlattenResult = Error[];

// ─── Pipeline / Orchestrator ─────────────────────────────────────────────────

/** @remarks Return type of ScrapeOrchestrator.scrapeHtml(). */
export type ScrapeHtmlResult = Promise<void>;
/** @remarks Return type of ScrapeOrchestrator.scrapeWiki(). */
export type ScrapeWikiResult = Promise<void>;

// ─── Generics ─────────────────────────────────────────────────────────────────

/** @remarks Return type of RateLimiter.schedule<T>(). */
export type ScheduleResult<T> = Promise<T>;
/** @remarks Return type of RetryExecutor.execute<T>(). */
export type ExecuteResult<T> = Promise<T>;

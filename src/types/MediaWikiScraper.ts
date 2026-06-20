import type { ScraperCache } from '../modules/cache/ScraperCache.js';

/**
 * Internal shape of a single category member from the MediaWiki `categorymembers` list.
 *
 * @remarks Used only within `CategoryMembersResponseType`; not exposed publicly.
 */
type CategoryMemberShapeType = {
  readonly title: string;
  readonly pageid: number;
};

/**
 * Response shape for the MediaWiki `allpages` list query.
 *
 * @remarks Mirrors the structure returned by the MediaWiki action API `list=allpages`.
 * @example
 * ```ts
 * const data: AllPagesResponseType = await api.get(params);
 * for (const page of data.query?.allpages ?? []) { ... }
 * ```
 * @category Scrapers
 * @since 2.0.0
 * @group Scrapers
 * @see MediaWikiScraper
 */
export type AllPagesResponseType = {
  readonly query?: {
    readonly allpages?: ReadonlyArray<{ readonly title: string; readonly pageid: number }>;
  };
  readonly continue?: Record<string, string>;
};

/**
 * Response shape for the MediaWiki `categorymembers` list query.
 *
 * @remarks Mirrors the structure returned by the MediaWiki action API `list=categorymembers`.
 * @example
 * ```ts
 * const data: CategoryMembersResponseType = await api.get(params);
 * for (const m of data.query?.categorymembers ?? []) { ... }
 * ```
 * @category Scrapers
 * @since 2.0.0
 * @group Scrapers
 * @see MediaWikiScraper
 */
export type CategoryMembersResponseType = {
  readonly query?: {
    readonly categorymembers?: ReadonlyArray<CategoryMemberShapeType>;
  };
  readonly continue?: Record<string, string>;
};

/**
 * A single page entry within a MediaWiki `revisions` query response.
 *
 * @remarks Supports both `formatversion=1` (`'*'` key) and `formatversion=2` (`content` key).
 * @example
 * ```ts
 * const page: RevisionsPageType = Object.values(data.query?.pages ?? {})[0];
 * const wikitext = page.revisions?.[0]['*'] ?? '';
 * ```
 * @category Scrapers
 * @since 2.0.0
 * @group Scrapers
 * @see RevisionsResponseType
 */
export type RevisionsPageType = {
  readonly title:     string;
  readonly pageid?:   number;
  readonly missing?:  true;
  readonly revisions?: ReadonlyArray<{
    readonly '*'?:     string;  // formatversion 1 — content here
    readonly content?: string;  // formatversion 2 fallback
  }>;
};

/**
 * Top-level response shape for a MediaWiki `revisions` query.
 *
 * @remarks Wraps a map of page ID strings to `RevisionsPageType` entries.
 * @example
 * ```ts
 * const data: RevisionsResponseType = await api.get(params);
 * const pages = Object.values(data.query?.pages ?? {});
 * ```
 * @category Scrapers
 * @since 2.0.0
 * @group Scrapers
 * @see RevisionsPageType
 */
export type RevisionsResponseType = {
  readonly query?: {
    readonly pages?: Record<string, RevisionsPageType>;
  };
};

/**
 * Configuration for MediaWikiScraper instances.
 *
 * @remarks Specifies the API endpoint URL and optional rate-limiting parameters.
 * @example
 * ```ts
 * const config: MediaWikiConfigType = { apiUrl: 'https://wiki.example.com/api.php', rateLimitMs: 1000 };
 * ```
 * @category Scrapers
 * @since 2.0.0
 * @group Scrapers
 * @see MediaWikiScraper
 */
export type MediaWikiConfigType = {
  /** Full URL to the MediaWiki action API (e.g. `https://wiki.example.com/api.php`). */
  readonly apiUrl: string;
  /** Minimum milliseconds between API requests. */
  readonly rateLimitMs?: number | undefined;
  /** Maximum random jitter added to each delay, in milliseconds. */
  readonly jitterMs?:    number | undefined;
  /** Number of page titles to fetch per batch API call (max 50, default 50). */
  readonly batchSize?: number | undefined;
  /** Maximum pages to enumerate / collect for this target (per allpages API call cap is 500). */
  readonly maxPages?: number | undefined;
  /** Maximum number of retry attempts for failed requests (default 3). */
  readonly maxRetries?: number | undefined;
  /** Base delay in milliseconds for retry backoff (default 500). */
  readonly retryBaseDelayMs?: number | undefined;
  /** Maximum delay cap in milliseconds for retry backoff (default 30000). */
  readonly retryMaxDelayMs?: number | undefined;
  /** Optional shared content store; when set, fetchPage / fetchPagesBatch consult the cache before consuming the rate limiter. */
  readonly cache?: ScraperCache | undefined;
};

/**
 * A single MediaWiki article with its wikitext content.
 *
 * @remarks Returned by `MediaWikiScraper.fetchPage` and `MediaWikiScraper.fetchPagesBatch`.
 * @example
 * ```ts
 * const page: WikiPageType = await scraper.fetchPage('Main Page');
 * console.log(page.wikitext);
 * ```
 * @category Scrapers
 * @since 2.0.0
 * @group Scrapers
 * @see MediaWikiScraper
 */
export type WikiPageType = {
  /** Article title. */
  readonly title: string;
  /** Raw wikitext source of the article. */
  readonly wikitext: string;
};

/**
 * A member entry returned from a MediaWiki category listing.
 *
 * @remarks Returned by `MediaWikiScraper.fetchCategory` and `MediaWikiScraper.fetchAllPages`.
 * @example
 * ```ts
 * const members: CategoryMemberType[] = await scraper.fetchCategory('Ships');
 * ```
 * @category Scrapers
 * @since 2.0.0
 * @group Scrapers
 * @see MediaWikiScraper
 */
export type CategoryMemberType = {
  /** Article title. */
  readonly title: string;
  /** Numeric MediaWiki page ID. */
  readonly pageid: number;
};

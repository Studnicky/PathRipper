/**
 * Internal shape of a single category member from the MediaWiki `categorymembers` list.
 *
 * @remarks Used only within `CategoryMembersResponseInterface`; not exposed publicly.
 */
interface CategoryMemberShapeInterface {
  readonly title: string;
  readonly pageid: number;
}

/**
 * Response shape for the MediaWiki `allpages` list query.
 *
 * @remarks Mirrors the structure returned by the MediaWiki action API `list=allpages`.
 * @example
 * ```ts
 * const data: AllPagesResponseInterface = await api.get(params);
 * for (const page of data.query?.allpages ?? []) { ... }
 * ```
 * @category Scrapers
 * @since 2.0.0
 * @group Scrapers
 * @see MediaWikiScraper
 */
export interface AllPagesResponseInterface {
  readonly query?: {
    readonly allpages?: ReadonlyArray<{ readonly title: string; readonly pageid: number }>;
  };
  readonly continue?: Record<string, string>;
}

/**
 * Response shape for the MediaWiki `categorymembers` list query.
 *
 * @remarks Mirrors the structure returned by the MediaWiki action API `list=categorymembers`.
 * @example
 * ```ts
 * const data: CategoryMembersResponseInterface = await api.get(params);
 * for (const m of data.query?.categorymembers ?? []) { ... }
 * ```
 * @category Scrapers
 * @since 2.0.0
 * @group Scrapers
 * @see MediaWikiScraper
 */
export interface CategoryMembersResponseInterface {
  readonly query?: {
    readonly categorymembers?: ReadonlyArray<CategoryMemberShapeInterface>;
  };
  readonly continue?: Record<string, string>;
}

/**
 * A single page entry within a MediaWiki `revisions` query response.
 *
 * @remarks Supports both `formatversion=1` (`'*'` key) and `formatversion=2` (`content` key).
 * @example
 * ```ts
 * const page: RevisionsPageInterface = Object.values(data.query?.pages ?? {})[0];
 * const wikitext = page.revisions?.[0]['*'] ?? '';
 * ```
 * @category Scrapers
 * @since 2.0.0
 * @group Scrapers
 * @see RevisionsResponseInterface
 */
export interface RevisionsPageInterface {
  readonly title:     string;
  readonly pageid?:   number;
  readonly missing?:  true;
  readonly revisions?: ReadonlyArray<{
    readonly '*'?:     string;  // formatversion 1 — content here
    readonly content?: string;  // formatversion 2 fallback
  }>;
}

/**
 * Top-level response shape for a MediaWiki `revisions` query.
 *
 * @remarks Wraps a map of page ID strings to `RevisionsPageInterface` entries.
 * @example
 * ```ts
 * const data: RevisionsResponseInterface = await api.get(params);
 * const pages = Object.values(data.query?.pages ?? {});
 * ```
 * @category Scrapers
 * @since 2.0.0
 * @group Scrapers
 * @see RevisionsPageInterface
 */
export interface RevisionsResponseInterface {
  readonly query?: {
    readonly pages?: Record<string, RevisionsPageInterface>;
  };
}

/**
 * Configuration for MediaWikiScraper instances.
 *
 * @remarks Specifies the API endpoint URL and optional rate-limiting parameters.
 * @example
 * ```ts
 * const config: MediaWikiConfigInterface = { apiUrl: 'https://wiki.example.com/api.php', rateLimitMs: 1000 };
 * ```
 * @category Scrapers
 * @since 2.0.0
 * @group Scrapers
 * @see MediaWikiScraper
 */
export interface MediaWikiConfigInterface {
  /** Full URL to the MediaWiki action API (e.g. `https://wiki.example.com/api.php`). */
  readonly apiUrl: string;
  /** Minimum milliseconds between API requests. */
  readonly rateLimitMs?: number | undefined;
  /** Maximum random jitter added to each delay, in milliseconds. */
  readonly jitterMs?:    number | undefined;
}

/**
 * A single MediaWiki article with its wikitext content.
 *
 * @remarks Returned by `MediaWikiScraper.fetchPage` and `MediaWikiScraper.fetchPagesBatch`.
 * @example
 * ```ts
 * const page: WikiPageInterface = await scraper.fetchPage('Main Page');
 * console.log(page.wikitext);
 * ```
 * @category Scrapers
 * @since 2.0.0
 * @group Scrapers
 * @see MediaWikiScraper
 */
export interface WikiPageInterface {
  /** Article title. */
  readonly title: string;
  /** Raw wikitext source of the article. */
  readonly wikitext: string;
}

/**
 * A member entry returned from a MediaWiki category listing.
 *
 * @remarks Returned by `MediaWikiScraper.fetchCategory` and `MediaWikiScraper.fetchAllPages`.
 * @example
 * ```ts
 * const members: CategoryMemberInterface[] = await scraper.fetchCategory('Ships');
 * ```
 * @category Scrapers
 * @since 2.0.0
 * @group Scrapers
 * @see MediaWikiScraper
 */
export interface CategoryMemberInterface {
  /** Article title. */
  readonly title: string;
  /** Numeric MediaWiki page ID. */
  readonly pageid: number;
}

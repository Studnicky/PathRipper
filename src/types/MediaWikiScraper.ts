/** Configuration for MediaWikiScraper instances. */
export interface MediaWikiConfigInterface {
  /** Full URL to the MediaWiki action API (e.g. `https://wiki.example.com/api.php`). */
  readonly apiUrl: string;
  /** Minimum milliseconds between API requests. */
  readonly rateLimitMs?: number | undefined;
  /** Maximum random jitter added to each delay, in milliseconds. */
  readonly jitterMs?:    number | undefined;
}

/** A single MediaWiki article with its wikitext content. */
export interface WikiPageInterface {
  /** Article title. */
  readonly title: string;
  /** Raw wikitext source of the article. */
  readonly wikitext: string;
}

/** A member entry returned from a MediaWiki category listing. */
export interface CategoryMemberInterface {
  /** Article title. */
  readonly title: string;
  /** Numeric MediaWiki page ID. */
  readonly pageid: number;
}

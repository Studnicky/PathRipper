/**
 * Cache-mode union: governs whether reads, writes, both, or neither are honored.
 *
 * @remarks
 * - `read-write`: full cache; reads serve hits, writes populate.
 * - `read-only`: reads serve hits, writes are no-ops.
 * - `write-only`: reads always miss, writes populate (useful for snapshotting).
 * - `off`: cache is disabled entirely.
 *
 * @category Cache
 * @since 2.0.0
 * @group Types
 */
export type ScraperCacheModeType = 'read-write' | 'read-only' | 'write-only' | 'off';

/**
 * Configuration for a `ScraperCache` instance.
 *
 * @remarks
 * `dir` is the on-disk root for the sharded cache layout. `ttlMs`, when set,
 * causes entries older than the threshold to be treated as misses on read and
 * `has`. The cache itself does not delete stale entries; staleness is enforced
 * lazily on access.
 *
 * @category Cache
 * @since 2.0.0
 * @see {@link ScraperCacheModeType}
 * @group Types
 */
export interface ScraperCacheConfigInterface {
  /** Filesystem root directory for the sharded meta JSON store. */
  readonly dir:        string;
  /** Cache mode controlling read/write behavior. */
  readonly mode:       ScraperCacheModeType;
  /** If set, entries older than this many milliseconds are treated as misses. */
  readonly ttlMs?:     number | undefined;
  /** LRU cap on persisted meta entries; evicts oldest by `fetchedAt` on write. */
  readonly maxEntries?: number | undefined;
  /** Default directory for cache-managed body files when `meta.bodyPath` is unset on write. Defaults to `<dir>/bodies`. */
  readonly bodyDir?:   string | undefined;
}

/**
 * Metadata persisted alongside a cached body.
 *
 * @remarks
 * `fetchedAt` is an ISO-8601 timestamp string written at cache time, used by
 * the TTL logic. `headers` is optional and only present for callers that
 * elect to record response headers.
 *
 * @category Cache
 * @since 2.0.0
 * @group Types
 */
export interface CacheMetaInterface {
  /** Original request URL. */
  readonly url:       string;
  /** HTTP method (e.g. `"GET"`). */
  readonly method:    string;
  /** ISO-8601 timestamp at which the entry was written. */
  readonly fetchedAt: string;
  /** HTTP status code recorded at fetch time. */
  readonly status:    number;
  /** Absolute filesystem path to the body file this meta entry points at. */
  readonly bodyPath:  string;
  /** Body size in bytes recorded at write time. */
  readonly size:      number;
  /** Optional response headers. */
  readonly headers?:  Record<string, string> | undefined;
}

/**
 * Cached body plus its metadata, as returned by `ScraperCache.read`.
 *
 * @category Cache
 * @since 2.0.0
 * @see {@link CacheMetaInterface}
 * @group Types
 */
export interface CacheEntryInterface {
  /** Response body (UTF-8 string). */
  readonly body: string;
  /** Sidecar metadata for the entry. */
  readonly meta: CacheMetaInterface;
}

/**
 * Minimal request shape used for deriving a stable cache key.
 *
 * @remarks
 * `headers` is optional; when present, keys are sorted alphabetically before
 * hashing so equivalent header sets in different declaration orders produce
 * the same key.
 *
 * @category Cache
 * @since 2.0.0
 * @see {@link CacheMetaInterface}
 * @group Types
 */
export interface CacheKeyRequestInterface {
  /** HTTP method (e.g. `"GET"`). */
  readonly method:   string;
  /** Request URL. */
  readonly url:      string;
  /** Optional headers; sorted by key before hashing. */
  readonly headers?: Record<string, string> | undefined;
}

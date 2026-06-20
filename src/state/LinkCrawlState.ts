import { NodeStateBase } from '@studnicky/dagonizer';
import type { JsonObjectType } from '@studnicky/dagonizer/entities';

/**
 * State flowing through the link-crawl DAG.
 *
 * @remarks
 * RegExp fields are stored as string sources (`domainRe`, `targetRe`,
 * `delimiterRe`) for JSON-safe checkpoint serialization. Rebuild live
 * `RegExp` objects at each use site via `new RegExp(state.domainRe)`.
 *
 * `frontier` holds the URLs to fetch at the current depth level.
 * `nextFrontierRaw` is the fan-in accumulator: `FetchAndExtractLinksNode`
 * appends newly traversable links here via the `append` fan-in strategy.
 * `DedupeAndEnqueueNode` then deduplicates and promotes the array to
 * `frontier`, clearing `nextFrontierRaw` for the next level.
 *
 * `discovered` accumulates all URLs matching the `target` regex — the
 * final result of the crawl. Individual fan-out items append to
 * `discoveredRaw`; `DedupeAndEnqueueNode` promotes them to `discovered`
 * (deduped across levels).
 *
 * @category State
 * @since 3.0.0
 */
export class LinkCrawlState extends NodeStateBase {
  /** Seed URLs provided at crawl start. */
  seedUrls: string[] = [];

  /** Current-level URLs to fetch. Swapped by `DedupeAndEnqueueNode`. */
  frontier: string[] = [];

  /**
   * Fan-in accumulator for the current level's traversable links.
   * Cleared after promotion to `frontier`.
   */
  nextFrontierRaw: string[] = [];

  /**
   * Fan-in accumulator for target URLs found this level.
   * Promoted to `discovered` by `DedupeAndEnqueueNode`.
   */
  discoveredRaw: string[] = [];

  /**
   * URLs that matched the `target` regex — the crawl result.
   * Deduplicated across all levels.
   */
  discovered: string[] = [];

  /**
   * Already-visited URLs. Used for deduplication.
   * Serializable substitute for `Set<string>`.
   */
  visited: string[] = [];

  /** Current depth level (0-based). */
  depth: number = 0;

  /** Maximum depth to crawl (inclusive). Undefined = unlimited. */
  maxDepth: number | undefined = undefined;

  /** Maximum number of target URLs to collect before stopping. */
  maxPages: number | undefined = undefined;

  /** Per-item scratch: the URL being processed by the current fan-out item. */
  currentUrl: string = '';

  /** RegExp source for the domain filter. */
  domainRe: string = '';

  /** RegExp source for the target filter. */
  targetRe: string = '';

  /** RegExp source for the delimiter/traversal filter. */
  delimiterRe: string = '';

  /** HTTP headers sent with every request. */
  headers: Record<string, string> = {};

  /**
   * Snapshots domain-specific fields for checkpoint support.
   */
  protected override snapshotData(): JsonObjectType {
    return {
      seedUrls:        [...this.seedUrls],
      frontier:        [...this.frontier],
      nextFrontierRaw: [...this.nextFrontierRaw],
      discoveredRaw:   [...this.discoveredRaw],
      discovered:      [...this.discovered],
      visited:         [...this.visited],
      depth:           this.depth,
      maxDepth:        this.maxDepth ?? null,
      maxPages:        this.maxPages ?? null,
      currentUrl:      this.currentUrl,
      domainRe:        this.domainRe,
      targetRe:        this.targetRe,
      delimiterRe:     this.delimiterRe,
      headers:         this.headers as unknown as JsonObjectType,
    };
  }

  /**
   * Restores domain-specific fields from a checkpoint snapshot.
   */
  protected override restoreData(snap: JsonObjectType): void {
    const arr = (key: string): string[] => {
      const val = snap[key];
      return Array.isArray(val) ? (val as string[]) : [];
    };
    const str = (key: string): string => {
      const val = snap[key];
      return typeof val === 'string' ? val : '';
    };
    const num = (key: string): number | undefined => {
      const val = snap[key];
      return typeof val === 'number' ? val : undefined;
    };

    this.seedUrls         = arr('seedUrls');
    this.frontier         = arr('frontier');
    this.nextFrontierRaw  = arr('nextFrontierRaw');
    this.discoveredRaw    = arr('discoveredRaw');
    this.discovered       = arr('discovered');
    this.visited          = arr('visited');
    this.depth            = num('depth') ?? 0;
    this.maxDepth         = num('maxDepth');
    this.maxPages         = num('maxPages');
    this.currentUrl       = str('currentUrl');
    this.domainRe         = str('domainRe');
    this.targetRe         = str('targetRe');
    this.delimiterRe      = str('delimiterRe');
    const headersSnap = snap['headers'];
    this.headers = (headersSnap !== null && typeof headersSnap === 'object' && !Array.isArray(headersSnap))
      ? (headersSnap as Record<string, string>)
      : {};
  }
}

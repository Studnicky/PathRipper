/**
 * Link-resolution strategy contract and built-in implementations.
 *
 * @module resilience/LinkResolve
 * @since 3.2.0
 */

import type { RipperServices } from '../services/RipperServices.js';

/**
 * Strategy for correcting a wrong-locator URL.
 *
 * Each built-in strategy is a class (noun) with a `resolve` instance method.
 * The registry maps strategy names to instances.
 *
 * @category Resilience
 * @since 3.2.0
 */
export interface LinkResolverStrategyInterface {
  readonly name: string;
  /**
   * Attempt to resolve a corrected absolute URL for a failed URL.
   *
   * @returns A corrected absolute URL, or `null` when this strategy cannot resolve.
   */
  resolve(failedUrl: string, services: RipperServices): Promise<string | null>;
}

// ── Built-in strategy pattern ───────────────────────────────────────────────────
// `<Category>.aspx?ID=<n>` shape used by AON.
const CATEGORY_URL_RE = /^(https?:\/\/[^/]+)\/([^/]+\.aspx)\?ID=(\d+)$/i;

// ── CrossLocatorStrategy ────────────────────────────────────────────────────────

/**
 * Tries sibling categories with the same numeric ID.
 *
 * Parses the `<Category>.aspx?ID=<n>` shape from `failedUrl`. For each
 * category in `services.resolve?.categorySet` that differs from the failed
 * category, builds a candidate url and probes via `htmlScraper.fetchPage`.
 * Returns the first candidate that doesn't throw; `null` when none match or
 * when the url doesn't match the expected pattern.
 *
 * @category Resilience
 * @since 3.2.0
 */
class CrossLocatorStrategy implements LinkResolverStrategyInterface {
  public readonly name = 'crossLocator';

  public async resolve(failedUrl: string, services: RipperServices): Promise<string | null> {
    const match = CATEGORY_URL_RE.exec(failedUrl);
    if (match === null) return null;

    const [, origin, failedAspx, numericId] = match as unknown as [string, string, string, string];
    const failedCategory = failedAspx.toLowerCase();
    const categorySet    = services.resolve?.categorySet ?? [];

    for (const category of categorySet) {
      const candidate = `${origin}/${category}.aspx?ID=${numericId}`;
      if (candidate.toLowerCase().replace(/^https?:\/\/[^/]+\//, '').split('?')[0] === failedCategory) {
        // Same category — skip.
        continue;
      }
      try {
        await services.htmlScraper?.fetchPage(candidate);
        return candidate;
      } catch {
        // This candidate also failed — try the next one.
      }
    }

    return null;
  }
}

// ── SearchStrategy ─────────────────────────────────────────────────────────────

/**
 * Placeholder for a search-based resolution strategy.
 *
 * The `linkText` required for the search query lives on the failure context in
 * state metadata, not on the `resolve(failedUrl, services)` signature. Until
 * the strategy contract is extended to carry failure context, this strategy
 * always returns `null`. It is retained as a named hook for future extension.
 *
 * @category Resilience
 * @since 3.2.0
 */
class SearchStrategy implements LinkResolverStrategyInterface {
  public readonly name = 'search';

  public async resolve(_failedUrl: string, _services: RipperServices): Promise<string | null> {
    // `linkText` is on the failure context in state metadata, not passed here.
    // Returning null until the strategy contract is extended to carry failure context.
    return null;
  }
}

// ── CanonicalStrategy ──────────────────────────────────────────────────────────

/**
 * Fetches the failed URL and looks for a `<link rel="canonical" href="...">`.
 *
 * Returns the canonical href when present and different from `failedUrl`;
 * `null` otherwise.
 *
 * @category Resilience
 * @since 3.2.0
 */
class CanonicalStrategy implements LinkResolverStrategyInterface {
  public readonly name = 'canonical';

  public async resolve(failedUrl: string, services: RipperServices): Promise<string | null> {
    let html: string;
    try {
      const result = await services.htmlScraper?.fetchPage(failedUrl);
      if (result === undefined) return null;
      html = result.html;
    } catch {
      return null;
    }

    const canonicalMatch = /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i.exec(html)
      ?? /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i.exec(html);

    if (canonicalMatch === null) return null;
    const href = canonicalMatch[1] as string;
    return href !== failedUrl ? href : null;
  }
}

// ── LinkResolverRegistry ───────────────────────────────────────────────────────

class LinkResolverRegistryImpl {
  private readonly entries: ReadonlyMap<string, LinkResolverStrategyInterface>;

  public constructor() {
    const crossLocator: LinkResolverStrategyInterface = new CrossLocatorStrategy();
    const search:       LinkResolverStrategyInterface = new SearchStrategy();
    const canonical:    LinkResolverStrategyInterface = new CanonicalStrategy();
    this.entries = new Map<string, LinkResolverStrategyInterface>([
      [crossLocator.name, crossLocator],
      [search.name,       search],
      [canonical.name,    canonical],
    ]);
  }

  public get(name: string): LinkResolverStrategyInterface | undefined {
    return this.entries.get(name);
  }
}

export const LinkResolverRegistry = new LinkResolverRegistryImpl();

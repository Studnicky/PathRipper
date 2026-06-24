/**
 * Shared link extraction and classification utilities for crawl nodes.
 *
 * Mirrors the cartographer streaming pattern: used by both the batch BFS
 * (crawl:discover / FetchAndExtractLinksNode) and the pull-producer
 * (CrawlStreamSource) that feeds the reservoir scatter. Single source of truth.
 *
 * @module crawlers/CrawlLinks
 * @since 4.2.0
 */

import { load } from 'cheerio';
import type { Element } from 'domhandler';

/**
 * Extracts all absolute href links from the given HTML string, resolved
 * against `baseUrl`. Fragment-only hrefs (`#...`) and invalid URLs are skipped.
 *
 * @param html    - Raw HTML markup to parse.
 * @param baseUrl - Base URL used to resolve relative hrefs.
 * @returns Array of absolute URL strings.
 */
export function extractLinks(html: string, baseUrl: string): string[] {
  const root = load(html);
  const links: string[] = [];
  root('a[href]').each((_index: number, element: Element): void => {
    const href = root(element).attr('href');
    if (href === undefined || href.startsWith('#')) return;
    try {
      links.push(new URL(href, baseUrl).href);
    } catch {
      // relative or invalid — skip
    }
  });
  return links;
}

/**
 * Classifies raw links into `targets` and `traversables` using three regexes.
 *
 * A link is only considered if it matches both `domainRe` AND `delimiterRe`.
 * Qualifying links are then split:
 * - Matches `targetRe`   → `targets`
 * - Does not match `targetRe` → `traversables`
 *
 * Links that fail `domainRe` or `delimiterRe` are dropped entirely.
 *
 * @param links       - Raw (unfiltered) link list, e.g. from {@link extractLinks}.
 * @param domainRe    - Must match; off-domain links are dropped.
 * @param delimiterRe - Must match; links outside the crawl scope are dropped.
 * @param targetRe    - Discriminant: matches go to `targets`, remainder to `traversables`.
 * @returns Object with `targets` and `traversables` arrays.
 */
export function classifyLinks(
  links: readonly string[],
  domainRe: RegExp,
  delimiterRe: RegExp,
  targetRe: RegExp,
): { targets: string[]; traversables: string[] } {
  const targets: string[] = [];
  const traversables: string[] = [];

  for (const link of links) {
    if (!domainRe.test(link) || !delimiterRe.test(link)) continue;
    if (targetRe.test(link)) {
      targets.push(link);
    } else {
      traversables.push(link);
    }
  }

  return { targets, traversables };
}

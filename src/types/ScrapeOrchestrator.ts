import type { RipperConfigInterface } from './Config.js';

/** Options for `ScrapeOrchestrator.scrapeHtml`. */
export interface ScrapeHtmlOptionsInterface {
  /** Config target key identifying which HTML target to scrape. */
  readonly target:    string;
  /** URL paths or full URLs to fetch under the target. */
  readonly paths:     ReadonlyArray<string>;
  /** Output directory root for scraped JSON files. */
  readonly outDir:    string;
  /** Directory used to resolve relative plugin paths. */
  readonly configDir: string;
  /** Validated ripperoni configuration. */
  readonly config:    RipperConfigInterface;
}

/** Options for `ScrapeOrchestrator.scrapeWiki`. */
export interface ScrapeWikiOptionsInterface {
  /** Config mediawiki key identifying which wiki target to scrape. */
  readonly target:    string;
  /** Optional single category name to restrict scraping scope. */
  readonly category?: string | undefined;
  /** Output directory root for scraped JSON files. */
  readonly outDir:    string;
  /** Directory used to resolve relative plugin paths. */
  readonly configDir: string;
  /** Validated ripperoni configuration. */
  readonly config:    RipperConfigInterface;
}

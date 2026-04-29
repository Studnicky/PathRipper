import type { RipperConfigInterface } from './Config.js';
import type { MediaWikiScraper } from '../scrapers/MediaWikiScraper.js';
import type { CategoryMemberInterface } from './MediaWikiScraper.js';
import type { Logger } from '../modules/logger/logger.js';

/**
 * Internal options for the `ScrapeOrchestrator.runPipeline` private method.
 *
 * @remarks Carries all per-run state needed to execute the wiki scrape pipeline.
 * @example
 * ```ts
 * const opts: RunPipelineOptionsInterface = { targetId, outDir, scraper, members, log };
 * ```
 * @category Orchestrators
 * @since 2.0.0
 * @group Orchestrators
 * @see ScrapeOrchestrator
 */
export interface RunPipelineOptionsInterface {
  readonly targetId: string;
  readonly outDir:   string;
  readonly scraper:  MediaWikiScraper;
  readonly members:  CategoryMemberInterface[];
  readonly log:      ReturnType<typeof Logger.forComponent>;
}

/**
 * Options for `ScrapeOrchestrator.scrapeHtml`.
 *
 * @remarks Configures a single HTML scrape run including the target, paths, and output location.
 * @example
 * ```ts
 * await ScrapeOrchestrator.scrapeHtml({ target: 'mysite', paths: ['/'], outDir: './out', configDir: '.', config });
 * ```
 * @category Orchestrators
 * @since 2.0.0
 * @group Orchestrators
 * @see ScrapeOrchestrator
 */
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

/**
 * Options for `ScrapeOrchestrator.scrapeWiki`.
 *
 * @remarks Configures a single MediaWiki scrape run including target, optional category, and output.
 * @example
 * ```ts
 * await ScrapeOrchestrator.scrapeWiki({ target: 'aonprd', outDir: './out', configDir: '.', config });
 * ```
 * @category Orchestrators
 * @since 2.0.0
 * @group Orchestrators
 * @see ScrapeOrchestrator
 */
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

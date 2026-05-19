import type { NormalizedRipperConfigInterface } from './Config.js';

/**
 * Options for `runHtml`.
 *
 * @remarks Configures a single HTML scrape run including the target, paths, and output location.
 * @example
 * ```ts
 * await runHtml({ target: 'mysite', paths: ['/'], outDir: './out', configDir: '.', config });
 * ```
 * @category Orchestrators
 * @since 4.0.0
 * @group Orchestrators
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
  readonly config:    NormalizedRipperConfigInterface;
}

/**
 * Options for `runWiki`.
 *
 * @remarks Configures a single MediaWiki scrape run including target, optional category, and output.
 * @example
 * ```ts
 * await runWiki({ target: 'aonprd', outDir: './out', configDir: '.', config });
 * ```
 * @category Orchestrators
 * @since 4.0.0
 * @group Orchestrators
 */
export interface ScrapeWikiOptionsInterface {
  /** Config mediawiki key identifying which wiki target to scrape. */
  readonly target:          string;
  /** Optional single category name to restrict scraping scope. */
  readonly category?:       string | undefined;
  /** Output directory root for scraped JSON files. */
  readonly outDir:          string;
  /** Directory used to resolve relative plugin paths. */
  readonly configDir:       string;
  /** Validated ripperoni configuration. */
  readonly config:          NormalizedRipperConfigInterface;
  /** When true, read titles from failures.json and re-scrape only those pages. */
  readonly resumeFailures?: boolean | undefined;
}

/**
 * Shape of the `failures.json` manifest written after a run with errors.
 *
 * @remarks Written to `<outDir>/<targetId>/failures.json` when one or more pages
 * could not be scraped. Pass `--resume-failures` on the next run to retry them.
 * @example
 * ```ts
 * const manifest: FailuresManifestInterface = JSON.parse(await readFile(failuresPath, 'utf-8'));
 * ```
 * @category Orchestrators
 * @since 2.0.0
 * @group Orchestrators
 */
export interface FailuresManifestInterface {
  /** ISO-8601 timestamp of when the failures manifest was written. */
  readonly timestamp: string;
  /** Number of pages that failed. */
  readonly count:     number;
  /** Page titles that could not be scraped. */
  readonly titles:    string[];
}

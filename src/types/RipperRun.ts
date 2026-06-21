import type { NormalizedRipperConfigType } from './Config.js';
import type { DAGType }                    from '@studnicky/dagonizer';
import type { RunStateType }               from './RunState.js';

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
export type ScrapeHtmlOptionsType = {
  /** Config target key identifying which HTML target to scrape. */
  readonly target:    string;
  /** URL paths or full URLs to fetch under the target. */
  readonly paths:     ReadonlyArray<string>;
  /** Output directory root for scraped JSON files. */
  readonly outDir:    string;
  /** Directory used to resolve relative plugin paths. */
  readonly configDir: string;
  /** Validated ripperoni configuration. */
  readonly config:    NormalizedRipperConfigType;
  /**
   * Run the CPU-bound per-page parse in a system-sized worker-thread pool.
   * Defaults to `true`. Falls back to in-process when the compiled worker tree
   * (`npm run build:workers`) is absent. Set `false` to force in-process.
   */
  readonly enableWorkers?: boolean;
};

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
export type ScrapeWikiOptionsType = {
  /** Config mediawiki key identifying which wiki target to scrape. */
  readonly target:          string;
  /** Optional single category name to restrict scraping scope. */
  readonly category?:       string | undefined;
  /** Output directory root for scraped JSON files. */
  readonly outDir:          string;
  /** Directory used to resolve relative plugin paths. */
  readonly configDir:       string;
  /** Validated ripperoni configuration. */
  readonly config:          NormalizedRipperConfigType;
  /** When true, read titles from failures.json and re-scrape only those pages. */
  readonly resumeFailures?: boolean | undefined;
};

/**
 * Shape of the `failures.json` manifest written after a run with errors.
 *
 * @remarks Written to `<outDir>/<targetId>/failures.json` when one or more pages
 * could not be scraped. Pass `--resume-failures` on the next run to retry them.
 * @example
 * ```ts
 * const manifest: FailuresManifestType = JSON.parse(await readFile(failuresPath, 'utf-8'));
 * ```
 * @category Orchestrators
 * @since 2.0.0
 * @group Orchestrators
 */
export type FailuresManifestType = {
  /** ISO-8601 timestamp of when the failures manifest was written. */
  readonly timestamp: string;
  /** Number of pages that failed. */
  readonly count:     number;
  /** Page titles that could not be scraped. */
  readonly titles:    string[];
};

/**
 * Options for `runDagFromFiles`.
 *
 * Both `dagPath` and `statePath` are resolved relative to `cwd` when relative.
 *
 * @category Orchestrators
 * @since 2.7.0
 * @group Orchestrators
 */
export type RunDagFromFilesOptionsType = {
  /** Absolute or cwd-relative path to a `.dag.jsonld` file. */
  readonly dagPath:   string;
  /** Absolute or cwd-relative path to a `.state.json` file. */
  readonly statePath: string;
  /** Output directory root for scraped JSON files. */
  readonly outDir:    string;
  /** Directory used to resolve relative plugin modules. */
  readonly configDir: string;
};

/**
 * Options for `runDag`.
 *
 * The DAG and state are already decoded — no IO happens inside this function.
 * Testable without touching the filesystem.
 *
 * @category Orchestrators
 * @since 2.7.0
 * @group Orchestrators
 */
export type RunDagOptionsType = {
  /** Validated `DAGType` loaded from a `.dag.jsonld` file. */
  readonly dag:       DAGType;
  /** Validated run params loaded from a `.state.json` file. */
  readonly state:     RunStateType;
  /** Output directory root for scraped JSON files. */
  readonly outDir:    string;
  /** Directory used to resolve relative plugin modules. */
  readonly configDir: string;
};

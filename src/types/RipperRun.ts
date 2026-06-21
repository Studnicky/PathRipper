import type { DAGType }      from '@studnicky/dagonizer';
import type { RunStateType } from './RunState.js';

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
 * The orchestration DAG and state are already decoded — no IO happens inside
 * this function. Testable without touching the filesystem.
 *
 * `dag` is the single native orchestration DAG document. It imports plugin DAGs
 * as embedded-dag / scatter{dag} references; those plugin DAGs are supplied by
 * `PluginLoader.registerPluginsFromEntry`, not bundled into this file.
 *
 * @category Orchestrators
 * @since 2.7.0
 * @group Orchestrators
 */
export type RunDagOptionsType = {
  /** The validated orchestration `DAGType` loaded from a `.dag.jsonld` file. */
  readonly dag:       DAGType;
  /** Validated run params loaded from a `.state.json` file. */
  readonly state:     RunStateType;
  /** Output directory root for scraped JSON files. */
  readonly outDir:    string;
  /** Directory used to resolve relative plugin modules. */
  readonly configDir: string;
};

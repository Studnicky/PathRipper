/**
 * runDag — execute a user-authored dagonizer orchestration from `.dag.jsonld` + `.state.json`.
 *
 * A scrape run in the native-DAG model consists of two files:
 *   - A `.dag.jsonld` containing exactly ONE dagonizer DAG document (the
 *     orchestration). It imports plugin DAGs as embedded-dag / scatter{dag}
 *     references; the plugin DAGs themselves live under `plugins/<ns>/` and are
 *     supplied by `PluginLoader.registerPluginsFromEntry` — not bundled here.
 *   - A `.state.json` containing run params validated against `RunStateSchema`,
 *     used to build services (cache, scrapers, output dir, …).
 *
 * The entry point `runDagFromFiles` reads both files and delegates to the
 * testable `runDag` core. `PluginLoader.registerPluginsFromEntry` discovers
 * which plugin namespaces the orchestration references and registers their
 * nodes + DAGs automatically.
 *
 * @module run/runDag
 * @since 2.7.0
 */

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve }                    from 'node:path';

import { DAGDocument }                from '@studnicky/dagonizer';
import type { DagonizerInterface }    from '@studnicky/dagonizer';
import type { DagContainerInterface } from '@studnicky/dagonizer';
import type { JsonObjectType }        from '@studnicky/dagonizer/entities';
import { WorkerThreadContainer }              from '@studnicky/dagonizer-executor-node';
import { NodeSystemInfo }                    from '@studnicky/dagonizer-executor-node';
import { RecommendedWorkerCountConfigDefault } from '@studnicky/dagonizer/entities';

import type { WorkerServicesConfigType } from './ParseRegistryConfig.js';
import { REGISTRY_VERSION }              from './ParseRegistryConfig.js';

import { RipperDagonizer }            from '../dispatcher/RipperDagonizer.js';
import { Logger }                     from '../modules/logger/logger.js';
import { ScraperCache }               from '../modules/cache/ScraperCache.js';
import { RateLimiter }                from '../modules/http/rateLimiter.js';
import { HttpRetryPolicy }            from '../modules/http/httpRetryPolicy.js';
import { HtmlScraper }                from '../scrapers/HtmlScraper.js';
import { MediaWikiScraper }           from '../scrapers/MediaWikiScraper.js';
import { ScrapeState }                from '../state/ScrapeState.js';
import { RunStateSchema }             from '../schemas/internal/RunStateSchema.js';
import type { RunStateType }          from '../types/RunState.js';
import type { RipperServices }        from '../services/RipperServices.js';
import type {
  FailuresManifestType,
  RunDagFromFilesOptionsType,
  RunDagOptionsType,
}                                     from '../types/RipperRun.js';

import { PluginLoader }               from './PluginLoader.js';

export type { RunDagFromFilesOptionsType, RunDagOptionsType };

// ── Constants ──────────────────────────────────────────────────────────────────

const log = Logger.forComponent('runDag');

// ── runDagFromFiles ────────────────────────────────────────────────────────────

/**
 * Read `dagPath` and `statePath` from disk, validate, then execute via `runDag`.
 *
 * `dagPath` is loaded via `DAGDocument.load` as a single orchestration DAG
 * document. A legacy multi-DAG bundle (a JSON array) is rejected with a clear
 * error — the native model expects one orchestration. `statePath` is validated
 * against `RunStateSchema`; throws with a clear message on failure.
 *
 * @param opts - File paths and output/config directories.
 * @returns Resolves after the orchestration completes and the failures manifest
 *   (if any) is written.
 *
 * @category Orchestrators
 * @since 2.7.0
 */
export async function runDagFromFiles(opts: RunDagFromFilesOptionsType): Promise<void> {
  const dagJson    = await readFile(opts.dagPath,   'utf-8');
  const stateJson  = await readFile(opts.statePath, 'utf-8');

  const dagParsed  = JSON.parse(dagJson) as unknown;
  const rawState   = JSON.parse(stateJson) as unknown;
  const stateError = RunStateSchema.validate(rawState);

  if (stateError !== null) {
    throw new Error(
      `Invalid run-state file at ${opts.statePath}:\n  ${stateError}`,
    );
  }

  if (Array.isArray(dagParsed)) {
    throw new Error(
      `runDag: ${opts.dagPath} is a multi-DAG bundle; the native model expects a single orchestration DAG document`,
    );
  }

  const dag = DAGDocument.load(dagJson);

  await runDag({
    dag,
    state:     rawState as RunStateType,
    outDir:    opts.outDir,
    configDir: opts.configDir,
  });
}

// ── runDag ─────────────────────────────────────────────────────────────────────

/**
 * Execute a single dagonizer orchestration driven by validated run params.
 *
 * Construction order:
 *   1. Build `cache`, `htmlScraper`, `wikiScraper` from `state` params.
 *   2. `mkdir` the output directory.
 *   3. Construct `RipperDagonizer` with the proxy-services pattern.
 *   4. Build the `RipperServices` bag; wire `holder.current`.
 *   5. `PluginLoader.registerBuiltinNodes` + `PluginLoader.registerPluginsFromEntry`
 *      (discovers plugin namespaces referenced by the orchestration), then
 *      `dispatcher.registerDAG(dag)` for the orchestration itself.
 *   6. Seed a fresh `ScrapeState`, set `params` so nodes can read run params,
 *      and seed `urls` when the state supplies an explicit page set.
 *   7. `dispatcher.execute(dag.name, scrapeState)`.
 *   8. Write `failures.json` when any pages failed after retry.
 *
 * @param opts - Decoded orchestration DAG, validated run params, and output/config dirs.
 * @returns Resolves after execution completes.
 *
 * @category Orchestrators
 * @since 2.7.0
 */
export async function runDag(opts: RunDagOptionsType): Promise<void> {
  const { dag, state, outDir, configDir } = opts;

  // ── Build cache from state.cache ──────────────────────────────────────────
  const cache = (state.cache?.dir != null && state.cache.mode != null)
    ? ScraperCache.create({
        dir:   state.cache.dir,
        mode:  state.cache.mode,
        ttlMs: state.cache.ttlMs,
      })
    : null;

  // ── Build HTML scraper when baseUrl is present ────────────────────────────
  const htmlScraper = state.baseUrl != null
    ? HtmlScraper.create({
        baseUrl:     state.baseUrl,
        rateLimitMs: state.rateLimitMs,
        jitterMs:    state.jitterMs,
        headers:     state.headers as Record<string, string> | undefined,
        ...(cache !== null ? { cache } : {}),
      })
    : undefined;

  // ── Build MediaWiki scraper when apiUrl is present ────────────────────────
  const wikiScraper = state.apiUrl != null
    ? await MediaWikiScraper.create({
        apiUrl:      state.apiUrl,
        rateLimitMs: state.rateLimitMs,
        jitterMs:    state.jitterMs,
        ...(cache !== null ? { cache } : {}),
      })
    : undefined;

  // ── Build crawl HTTP primitives when crawler config is present ────────────
  const crawlLimiter = state.crawler !== undefined
    ? RateLimiter.create({
        minTimeMs: state.crawler.rateLimitMs ?? 100,
        jitterMs:  state.crawler.jitterMs    ?? 0,
      })
    : undefined;
  const crawlPolicy = state.crawler !== undefined
    ? HttpRetryPolicy.create({})
    : undefined;

  // ── Ensure output directory exists ────────────────────────────────────────
  await mkdir(outDir, { recursive: true });

  // ── Worker container (optional) ───────────────────────────────────────────
  // When `state.parallelWorkers` is true, build a WorkerThreadContainer and
  // bind it under the 'worker' role. Scatter placements that declare
  // `container: "worker"` are dispatched to the pool. Absent or false →
  // no container bound; all placements run in-process.
  const workerEnabled = state.parallelWorkers === true;
  let workerContainer: WorkerThreadContainer | undefined;

  if (workerEnabled) {
    // The registry module is compiled to dist-workers/ by `tsconfig.workers.json`.
    // Compiled runDag.js is at dist/run/runDag.js.
    // Registry module is at dist-workers/workers/ParseRegistryModule.js.
    // Relative: dist/run/ → ../../dist-workers/workers/ParseRegistryModule.js
    const registryModuleUrl = new URL(
      '../../dist-workers/workers/ParseRegistryModule.js',
      import.meta.url,
    ).href;

    const servicesConfig: WorkerServicesConfigType = {
      outDir:            outDir,
      targetId:          dag.name,
      pluginTaskName:    PluginLoader.derivePluginTaskName(dag),
      splitByTaskName:   typeof state.output.splitByTaskName === 'boolean'
        ? state.output.splitByTaskName
        : undefined,
      baseUrl:           state.baseUrl,
      rateLimitMs:       state.rateLimitMs,
      jitterMs:          state.jitterMs,
      headers:           state.headers as Record<string, string> | undefined,
      includeRawContent: state.includeRawContent,
      outputSchema:      state.outputSchema,
      onSchemaError:     state.onSchemaError as WorkerServicesConfigType['onSchemaError'],
      cache:             state.cache != null
        ? {
            dir:   state.cache.dir,
            mode:  state.cache.mode,
            ttlMs: state.cache.ttlMs,
          }
        : undefined,
    };

    const systemInfo = new NodeSystemInfo();
    const poolSize = systemInfo.recommendedWorkerCount(RecommendedWorkerCountConfigDefault);

    workerContainer = new WorkerThreadContainer({
      registryModule:  registryModuleUrl,
      registryVersion: REGISTRY_VERSION,
      // Round-trip through JSON to get a structurally plain `JsonObjectType`.
      // `WorkerServicesConfigType` is JSON-serialisable by contract; the cast
      // is sound — the type constraint is structural, not semantic.
      servicesConfig:  JSON.parse(JSON.stringify(servicesConfig)) as JsonObjectType,
      poolSize,
    });
  }

  // ── Services + dispatcher (proxy breaks construction circularity) ──────────
  // The Proxy holder lets the dispatcher reference `services` before the
  // services literal is built.
  const holder: { current: RipperServices | null } = { current: null };
  const dispatcher = new RipperDagonizer<ScrapeState>({
    services: new Proxy({} as RipperServices, {
      get(_target, prop) {
        if (holder.current === null) {
          throw new Error('RipperServices accessed before initialisation');
        }
        return (holder.current as unknown as Record<string | symbol, unknown>)[prop as string];
      },
    }),
    ...(workerContainer !== undefined
      ? { containers: { worker: workerContainer as unknown as DagContainerInterface<ScrapeState> } }
      : {}),
  });

  // ── Derive pluginTaskName from the orchestration's first non-builtin ref ───
  // Populates `services.pluginTaskName` so output nodes that honour
  // `splitByTaskName` know which subfolder to write under.
  const pluginTaskName = PluginLoader.derivePluginTaskName(dag);

  const splitByTaskName: boolean | undefined =
    typeof state.output.splitByTaskName === 'boolean'
      ? state.output.splitByTaskName
      : undefined;

  const services: RipperServices = {
    log:            Logger.forComponent('runDag'),
    cache,
    ...(htmlScraper !== undefined ? { htmlScraper } : {}),
    ...(wikiScraper !== undefined ? { wikiScraper } : {}),
    // `target.id` is the orchestration DAG name; output lands under it.
    target:         { id: dag.name },
    outDir,
    pluginTaskName,
    splitByTaskName,
    // Typed config fields — nodes read these directly.
    ...(state.crawler !== undefined           ? { crawler:            state.crawler }                     : {}),
    ...(crawlLimiter  !== undefined           ? { crawlLimiter }                                          : {}),
    ...(crawlPolicy   !== undefined           ? { crawlPolicy }                                           : {}),
    ...(state.headers !== undefined           ? { headers:            state.headers as Record<string, string> } : {}),
    ...(state.includeRawContent !== undefined ? { includeRawContent:  state.includeRawContent }           : {}),
    ...(state.outputSchema !== undefined      ? { outputSchema:       state.outputSchema }                : {}),
    ...(state.onSchemaError !== undefined     ? { onSchemaError:      state.onSchemaError }               : {}),
    dispatcher:     dispatcher as unknown as DagonizerInterface<ScrapeState, RipperServices>,
  };
  holder.current = services;

  // ── Node + plugin DAG registration ────────────────────────────────────────
  // Order: builtins first, then plugin nodes + DAGs discovered from the
  // orchestration's placements, then the orchestration DAG itself (so it can
  // reference the plugin DAGs already in the dispatcher).
  PluginLoader.registerBuiltinNodes(dispatcher);
  await PluginLoader.registerPluginsFromEntry(dispatcher, dag, configDir);
  dispatcher.registerDAG(dag);

  // ── Seed initial state ────────────────────────────────────────────────────
  // When the run state declares an explicit `urls` list, seed `scrapeState.urls`
  // so an orchestration that scatters over `urls` iterates the supplied page set
  // (a bounded, deterministic scrape with no crawl phase). Absent `urls`, the
  // list stays empty and a crawl/seed node inside the DAG is responsible for it.
  const scrapeState = new ScrapeState();
  scrapeState.params = state;
  if (Array.isArray(state.urls) && state.urls.length > 0) {
    scrapeState.urls = [...state.urls];
  }

  // ── Dispatch the orchestration ─────────────────────────────────────────────
  log.info('runDag', `Dispatching orchestration DAG '${dag.name}'`);
  await dispatcher.execute(dag.name, scrapeState);

  log.info('runDag',
    `Completed ${scrapeState.succeeded.length.toString()} pages on first attempt; `
    + `recovered ${scrapeState.recovered.length.toString()} on retry; `
    + `${scrapeState.failedAfterRetry.length.toString()} failed after retry`);

  // ── Failures manifest ──────────────────────────────────────────────────────
  if (scrapeState.failedAfterRetry.length > 0) {
    const manifest: FailuresManifestType = {
      timestamp: new Date().toISOString(),
      count:     scrapeState.failedAfterRetry.length,
      titles:    scrapeState.failedAfterRetry,
    };
    await writeFile(
      resolve(outDir, 'failures.json'),
      JSON.stringify(manifest, null, 2),
    );
    log.warn('runDag', `${scrapeState.failedAfterRetry.length.toString()} pages failed after retry — written to failures.json`);
  }

  // ── Release worker pool ────────────────────────────────────────────────────
  // Terminates all worker threads cleanly. No-op when no containers were bound.
  await dispatcher.destroy();
}

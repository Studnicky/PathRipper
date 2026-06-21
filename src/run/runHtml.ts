/**
 * runHtml — plain async function that executes one HTML scrape run.
 *
 * Constructs an inline `RipperServices` object literal, instantiates
 * `RipperDagonizer`, registers built-in nodes and flows, loads plugin modules
 * from the config directory, then dispatches the outer scrape DAG and returns.
 *
 * Phase DAG construction:
 *   Phase DAGs and composition DAGs are built via `DAGBuilder` factory functions
 *   in `src/flows/htmlScrapeDag.ts`, mirroring the wiki flow pattern.
 *
 * @module run/runHtml
 * @since 4.0.0
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync }       from 'node:fs';
import { resolve }          from 'node:path';
import { fileURLToPath }    from 'node:url';
import { availableParallelism } from 'node:os';

import type { DagContainerInterface, DagonizerInterface } from '@studnicky/dagonizer';
import { RecommendedWorkerCountConfigDefault }             from '@studnicky/dagonizer/entities';
import { NodeSystemInfo, WorkerThreadContainer }           from '@studnicky/dagonizer-executor-node';

import {
  buildHtmlScrapePhaseDag,
  buildHtmlRetryPhaseDag,
  buildHtmlCrawlPhaseDag,
  buildHtmlScrapeDag,
  buildHtmlScrapeDagCrawl,
  HTML_SCRAPE_DAG,
  HTML_SCRAPE_DAG_CRAWL,
}                                     from '../flows/htmlScrapeDag.js';

import type { RipperServices }        from '../services/RipperServices.js';
import { RipperDagonizer }            from '../dispatcher/RipperDagonizer.js';
import { Logger }                     from '../modules/logger/logger.js';
import { ScraperCache }               from '../modules/cache/ScraperCache.js';
import { HtmlScraper }                from '../scrapers/HtmlScraper.js';
import { ScrapeState }                from '../state/ScrapeState.js';
import type { ScrapeHtmlOptionsType, FailuresManifestType } from '../types/RipperRun.js';
import type { ScrapeHtmlResult }       from '../types/Results.js';
import type { RunCrawlerType }         from '../types/RunState.js';

import { buildHtmlPageFlow, htmlPageFlowName } from '../flows/htmlPageFlow.js';
import { PluginLoader }                from './PluginLoader.js';

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * Container role name used for the parse worker pool.
 * Matches the key in `containers: { [PARSE_WORKER_ROLE]: container }`.
 */
const PARSE_WORKER_ROLE = 'parseWorkers';

/**
 * Registry module URL for the plugin-agnostic worker-thread parse pool.
 *
 * The registry must always resolve to the COMPILED `dist/` JavaScript — never
 * the `.ts` source. A worker thread spawned by `WorkerThreadContainer` does not
 * apply the tsx `.js`→`.ts` loader hook to the registry module's transitive
 * static imports (`PluginLoader`, the node graph, …), so a `.ts` registry URL
 * fails at module-resolution time inside the worker. This mirrors the
 * `@studnicky/dagonizer` reference (`@studnicky/dagonizer-executor-node`
 * README, `ConformanceRegistry`): the `registryModule` is a compiled `.js`
 * file resolved via `new URL('./registry.js', import.meta.url)`, with an import
 * graph that resolves under plain Node — no transpiler in the worker.
 *
 * The registry lives in a dedicated, self-contained compiled tree under
 * `dist-workers/` (built by `npm run build:workers` from `tsconfig.workers.json`,
 * which preserves the `src/`↔`plugins/` relative layout). The worker loads only
 * from that tree, so the path never depends on the in-place `src/*.js` build
 * output. The registry is plugin-agnostic: it rebuilds whatever plugin parse DAG
 * the run's pipeline names describe, driven by `servicesConfig.pipelineNames`.
 *
 * Resolution: `runHtml` is two levels under the repo root in both dev
 * (`…/src/run/runHtml.ts`) and prod (`…/dist/run/runHtml.js`), so the compiled
 * worker registry at `<root>/dist-workers/src/workers/parseRegistry.js` is
 * reached with the same relative URL in both environments.
 */
const REGISTRY_MODULE_URL =
  new URL('../../dist-workers/src/workers/parseRegistry.js', import.meta.url).href;

/** Absolute path to the self-contained worker compile tree (the worker's `configDir`). */
const WORKER_CONFIG_DIR = fileURLToPath(new URL('../../dist-workers/', import.meta.url));

// ── Helpers ────────────────────────────────────────────────────────────────────

const log = Logger.forComponent('runHtml');

// ── runHtml ────────────────────────────────────────────────────────────────────

export type { ScrapeHtmlOptionsType };

/**
 * Executes one HTML scrape run.
 *
 * Construction order:
 *   1. Build inline `RipperServices` object literal.
 *   2. Instantiate `RipperDagonizer` (no observer arg — lifecycle logging is
 *      inline in the dispatcher's hook overrides).
 *   3. Register built-in nodes.
 *   4. Load + register plugin nodes via `mod.register(dispatcher)`.
 *   5. Register the per-page child flow + phase flows + outer scrape flow.
 *   6. Dispatch and return.
 *
 * @param opts - HTML scrape options.
 * @returns Resolves after all pages are processed and any failures manifest is written.
 *
 * @category Orchestrators
 * @since 4.0.0
 */
export async function runHtml(opts: ScrapeHtmlOptionsType): ScrapeHtmlResult {
  const htmlTarget = opts.config.targets?.[opts.target];
  if (htmlTarget === undefined) {
    log.error('runHtml', `Unknown html target: ${opts.target}`);
    process.exit(1);
  }

  const targetCfg      = htmlTarget as Record<string, unknown>;
  const pipelineNames  = PluginLoader.requirePipeline(targetCfg, opts.target);
  const pluginTaskName = PluginLoader.derivePluginTaskName(pipelineNames);
  const outputCfg      = opts.config.output as Record<string, unknown>;
  const splitByTaskName: boolean | undefined =
    typeof outputCfg['splitByTaskName'] === 'boolean'
      ? outputCfg['splitByTaskName'] as boolean
      : undefined;

  // ── Build scraper + cache from target config ───────────────────────────────
  const cacheCfg = (targetCfg['cache'] as { dir?: string; mode?: string; ttlMs?: number } | undefined);
  const cache = cacheCfg?.dir != null && cacheCfg.mode != null
    ? ScraperCache.create({
        dir:   cacheCfg.dir,
        mode:  cacheCfg.mode as 'read-write' | 'read-only' | 'write-only' | 'off',
        ttlMs: cacheCfg.ttlMs,
      })
    : null;

  const htmlScraper = HtmlScraper.create({
    baseUrl: (targetCfg['baseUrl'] as string | undefined) ?? '',
    rateLimitMs: (targetCfg['rateLimitMs'] as number | undefined),
    jitterMs:    (targetCfg['jitterMs']    as number | undefined),
    headers:     (targetCfg['headers']     as Record<string, string> | undefined),
    ...(cache !== null ? { cache } : {}),
  });

  const targetDir = resolve(opts.outDir, opts.target);
  await mkdir(targetDir, { recursive: true });

  // ── Parse worker pool ────────────────────────────────────────────────────
  // Worker parsing is the default execution model: the CPU-bound per-page plugin
  // parse `embeddedDAG` runs in a WorkerThreadContainer pool sized to system info
  // (`recommendedWorkerCount` — cores + free memory), while fetch and write stay
  // coordinator-side. The pool is destroyed after the run so the process exits
  // cleanly. Set `enableWorkers: false` to force in-process.
  //
  // The worker cannot use tsx, so it loads the registry + plugin parse DAG from
  // the self-contained compiled `dist-workers/` tree (`npm run build:workers`).
  // When that tree is absent (e.g. running source via tsx without a build), the
  // run falls back to in-process with a warning rather than failing.
  const workersRequested = opts.enableWorkers ?? true;
  const registryPresent  = existsSync(fileURLToPath(REGISTRY_MODULE_URL));
  const parseWorkersEnabled = workersRequested && registryPresent;

  if (workersRequested && !registryPresent) {
    log.info('runHtml', `Worker parse pool requested but the compiled registry at `
      + `${fileURLToPath(REGISTRY_MODULE_URL)} is missing — running in-process. `
      + `Run \`npm run build:workers\` to enable worker parsing.`);
  }

  // System-sized pool. `recommendedWorkerCount` clamps to
  // `min(maximumWorkers, parallelism − mainThreadReservation, memory budget)`.
  // The config default caps `maximumWorkers` at 1, so raise it to the core count
  // to let the parallelism/memory terms bind — the whole point of workers is to
  // use the machine (e.g. a 16-core host runs 15 parse workers + the coordinator).
  const parsePoolSize = parseWorkersEnabled
    ? new NodeSystemInfo().recommendedWorkerCount({
        ...RecommendedWorkerCountConfigDefault,
        maximumWorkers: availableParallelism(),
      })
    : 0;

  const parseWorkerContainer: WorkerThreadContainer | null = parseWorkersEnabled
    ? new WorkerThreadContainer({
        registryModule:  REGISTRY_MODULE_URL,
        registryVersion: '1',
        servicesConfig:  { configDir: WORKER_CONFIG_DIR, pipelineNames },
        poolSize:        parsePoolSize,
      })
    : null;

  const containers: Record<string, DagContainerInterface<ScrapeState>> | undefined =
    parseWorkerContainer !== null
      ? { [PARSE_WORKER_ROLE]: parseWorkerContainer }
      : undefined;

  if (parseWorkersEnabled) {
    log.info('runHtml', `Parse worker pool enabled: ${parsePoolSize.toString()} workers (system-sized)`);
  }

  // ── Services + dispatcher (proxy breaks construction circularity) ──────────
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
    ...(containers !== undefined ? { containers } : {}),
  });

  const crawlerCfg = targetCfg['crawler'] as RunCrawlerType | undefined;
  const headersCfg = targetCfg['headers'] as Record<string, string> | undefined;
  const includeRawContentCfg = typeof targetCfg['includeRawContent'] === 'boolean'
    ? targetCfg['includeRawContent'] as boolean
    : undefined;
  const outputSchemaCfg = typeof targetCfg['outputSchema'] === 'string' && (targetCfg['outputSchema'] as string).length > 0
    ? targetCfg['outputSchema'] as string
    : undefined;
  const onSchemaErrorCfg = (targetCfg['onSchemaError'] === 'halt' || targetCfg['onSchemaError'] === 'skip' || targetCfg['onSchemaError'] === 'warn')
    ? targetCfg['onSchemaError'] as 'halt' | 'skip' | 'warn'
    : undefined;

  const services: RipperServices = {
    log:            Logger.forComponent('runHtml'),
    cache,
    htmlScraper,
    target:         { id: opts.target, cfg: targetCfg },
    outDir:         opts.outDir,
    pluginTaskName,
    splitByTaskName,
    // Typed config fields — nodes read these instead of target.cfg[key].
    ...(crawlerCfg !== undefined          ? { crawler:           crawlerCfg }           : {}),
    ...(headersCfg !== undefined          ? { headers:           headersCfg }           : {}),
    ...(includeRawContentCfg !== undefined ? { includeRawContent: includeRawContentCfg } : {}),
    ...(outputSchemaCfg !== undefined     ? { outputSchema:      outputSchemaCfg }      : {}),
    ...(onSchemaErrorCfg !== undefined    ? { onSchemaError:     onSchemaErrorCfg }     : {}),
    dispatcher:     dispatcher as unknown as DagonizerInterface<ScrapeState, RipperServices>,
  };
  holder.current = services;

  // ── Node registration ──────────────────────────────────────────────────────
  PluginLoader.registerBuiltinNodes(dispatcher);

  const htmlPluginDagNames = await PluginLoader.registerInto(dispatcher, pipelineNames, opts.configDir);

  // ── Phase and composition DAG registration (DAGBuilder) ───────────────────
  const perPageDagName = htmlPageFlowName(opts.target);
  const parseWorkerRole = parseWorkerContainer !== null ? PARSE_WORKER_ROLE : undefined;
  // Feed the per-page scatter at the worker-pool width so every worker stays
  // busy; the in-process path keeps the flow's default concurrency.
  const scatterConcurrency = parseWorkersEnabled ? parsePoolSize : undefined;
  dispatcher.registerDAG(buildHtmlPageFlow(pipelineNames, opts.target, htmlPluginDagNames, parseWorkerRole));
  dispatcher.registerDAG(buildHtmlScrapePhaseDag(perPageDagName, scatterConcurrency));
  dispatcher.registerDAG(buildHtmlRetryPhaseDag(perPageDagName, scatterConcurrency));

  // Bounded scrape: when explicit --paths are supplied, skip the crawl
  // phase even if the pipeline declares it. The crawler is the default
  // for a full-target scrape; --paths overrides it.
  const hasCrawl   = pipelineNames.includes('crawl:list-targets');
  const useCrawl   = hasCrawl && opts.paths.length === 0;
  let outerDagName: string;

  if (useCrawl) {
    dispatcher.registerDAG(buildHtmlCrawlPhaseDag());
    dispatcher.registerDAG(buildHtmlScrapeDagCrawl());
    outerDagName = HTML_SCRAPE_DAG_CRAWL;
  } else {
    dispatcher.registerDAG(buildHtmlScrapeDag());
    outerDagName = HTML_SCRAPE_DAG;
  }

  // ── Dispatch ───────────────────────────────────────────────────────────────
  const state = new ScrapeState();
  if (opts.paths.length > 0) {
    state.urls = [...opts.paths];
    if (hasCrawl) {
      log.info('runHtml', `Bounded scrape: --paths supplied (${opts.paths.length.toString()} URLs) — skipping crawl phase`);
    }
  }

  if (outerDagName === HTML_SCRAPE_DAG && state.urls.length === 0) {
    log.info('runHtml', 'No URLs to scrape');
    await parseWorkerContainer?.destroy();
    return;
  }

  try {
    await dispatcher.execute(outerDagName, state);
  } finally {
    await parseWorkerContainer?.destroy();
  }

  log.info('runHtml',
    `Completed ${state.succeeded.length.toString()} pages on first attempt; `
    + `recovered ${state.recovered.length.toString()} on retry; `
    + `${state.failedAfterRetry.length.toString()} failed after retry`);

  if (state.failedAfterRetry.length > 0) {
    const manifest: FailuresManifestType = {
      timestamp: new Date().toISOString(),
      count:     state.failedAfterRetry.length,
      titles:    state.failedAfterRetry,
    };
    await writeFile(
      resolve(targetDir, 'failures.json'),
      JSON.stringify(manifest, null, 2),
    );
    log.warn('runHtml', `${state.failedAfterRetry.length.toString()} pages failed after retry — written to failures.json`);
  }
}

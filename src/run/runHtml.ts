/**
 * runHtml — plain async function that executes one HTML scrape run.
 *
 * Constructs an inline `RipperServices` object literal, instantiates
 * `RipperDagonizer`, registers built-in nodes and flows, loads plugin modules
 * from the config directory, then dispatches the outer scrape DAG and returns.
 *
 * Phase DAG construction:
 *   Phase DAGs (htmlScrapePhase, htmlRetryPhase, htmlCrawlPhase) are built
 *   inline with `DAGBuilder.fanOut` pointing at the real `html:dispatch-page-dag`
 *   node, using the built-in `partition` fan-in strategy. FlowDeriver's
 *   `fanouts` annotation hardcodes `strategy: 'custom'` (see `FlowDeriver.ts`
 *   line 262: `'fanIn': { 'strategy': 'custom', 'customNode': fan.fanInOperation }`)
 *   and cannot express the built-in `partition` strategy. DAGBuilder is retained
 *   for the phase DAG fan-out construction only.
 *
 *   Outer composition DAGs (htmlScrapeDAG / htmlScrapeDAGCrawl) wrap the phase
 *   DAGs as `DeepDAGNode` placements via `FlowDeriver.derive` with
 *   `annotations.subDAGs` (adopted in 0.7.0).
 *
 * @module run/runHtml
 * @since 4.0.0
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve }          from 'node:path';

import { DAGBuilder }               from '@noocodex/dagonizer/builder';
import { FlowDeriver }              from '@noocodex/dagonizer/derive';
import type { DagonizerInterface }  from '@noocodex/dagonizer';

import type { RipperServices }        from '../services/RipperServices.js';
import { RipperDagonizer }            from '../dispatcher/RipperDagonizer.js';
import { Logger }                     from '../modules/logger/logger.js';
import { ScraperCache }               from '../modules/cache/ScraperCache.js';
import { HtmlScraper }                from '../scrapers/HtmlScraper.js';
import { ScrapeState }                from '../state/ScrapeState.js';
import type { ScrapeHtmlOptionsInterface, FailuresManifestInterface } from '../types/RipperRun.js';
import type { ScrapeHtmlResult }       from '../types/Results.js';

import {
  HtmlFetchNode,
  WikiFetchNode,
  HtmlWriteRawNode,
  WikiWriteRawNode,
  JsonWriteNode,
  JsonlAppendNode,
  ValidateSchemaNode,
  CrawlListTargetsNode,
  TerminalNode,
} from '../nodes/index.js';
import { makeDispatchPageDagNode }    from '../nodes/DispatchPageDagNode.js';
import { stub }                       from '../flows/stub.js';

import { buildHtmlPageFlow, htmlPageFlowName } from '../flows/htmlPageFlow.js';

// ── Constants ──────────────────────────────────────────────────────────────────

const BUILTIN_PREFIXES: ReadonlyArray<string> = [
  'html:', 'wiki:', 'json:', 'jsonl:', 'validate:', 'crawl:',
];

// ── Phase DAG names ────────────────────────────────────────────────────────────

const HTML_SCRAPE_PHASE = 'htmlScrapePhase';
const HTML_RETRY_PHASE  = 'htmlRetryPhase';
const HTML_CRAWL_PHASE  = 'htmlCrawlPhase';

// ── Helpers ────────────────────────────────────────────────────────────────────

const log = Logger.forComponent('runHtml');

const requirePipeline = (target: Record<string, unknown>, targetId: string): string[] => {
  const pipeline = target['pipeline'];
  if (!Array.isArray(pipeline) || pipeline.length === 0) {
    throw new Error(`Target "${targetId}" must declare a non-empty pipeline: string[]`);
  }
  for (const name of pipeline) {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error(`Target "${targetId}" pipeline contains a non-string entry`);
    }
  }
  return pipeline as string[];
};

const derivePluginTaskName = (pipeline: ReadonlyArray<string>): string | undefined => {
  for (const entry of pipeline) {
    if (BUILTIN_PREFIXES.some((p) => entry.startsWith(p))) continue;
    return entry;
  }
  return undefined;
};

const loadAndRegisterPlugins = async (
  dispatcher:    RipperDagonizer<ScrapeState>,
  pipelineNames: ReadonlyArray<string>,
  configDir:     string,
): Promise<Set<string>> => {
  const pluginDagNames = new Set<string>();
  const seen = new Set<string>();

  for (const entry of pipelineNames) {
    if (BUILTIN_PREFIXES.some((p) => entry.startsWith(p))) continue;
    const colon = entry.indexOf(':');
    if (colon <= 0) continue;
    const word = entry.slice(0, colon);
    const verb = entry.slice(colon + 1);
    const path = `./plugins/${word}/${verb}.task.js`;
    if (seen.has(path)) continue;
    seen.add(path);
    const absPath = resolve(configDir, path);
    let mod: unknown;
    try {
      mod = await import(absPath);
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (
        nodeErr.code === 'ENOENT' ||
        nodeErr.code === 'MODULE_NOT_FOUND' ||
        nodeErr.code === 'ERR_MODULE_NOT_FOUND'
      ) {
        throw new Error(`Plugin file not found: ${absPath}`, { cause: err });
      }
      throw err;
    }
    const m = mod as Record<string, unknown>;
    if (typeof m['register'] !== 'function') {
      throw new Error(
        `Plugin at ${absPath} does not export register(dispatcher): void. `
        + `Add: export function register(dispatcher: RipperDagonizer<ScrapeState>): void { ... }`,
      );
    }
    (m['register'] as (d: RipperDagonizer<ScrapeState>) => void)(dispatcher);
    pluginDagNames.add(entry);
  }
  return pluginDagNames;
};

const registerBuiltinNodes = (dispatcher: RipperDagonizer<ScrapeState>): void => {
  dispatcher.registerNode(HtmlFetchNode);
  dispatcher.registerNode(WikiFetchNode);
  dispatcher.registerNode(HtmlWriteRawNode);
  dispatcher.registerNode(WikiWriteRawNode);
  dispatcher.registerNode(JsonWriteNode);
  dispatcher.registerNode(JsonlAppendNode);
  dispatcher.registerNode(ValidateSchemaNode);
  dispatcher.registerNode(CrawlListTargetsNode);
  dispatcher.registerNode(TerminalNode);
};

// ── runHtml ────────────────────────────────────────────────────────────────────

export type { ScrapeHtmlOptionsInterface };

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
export async function runHtml(opts: ScrapeHtmlOptionsInterface): ScrapeHtmlResult {
  const htmlTarget = opts.config.targets?.[opts.target];
  if (htmlTarget === undefined) {
    log.error('runHtml', `Unknown html target: ${opts.target}`);
    process.exit(1);
  }

  const targetCfg      = htmlTarget as Record<string, unknown>;
  const pipelineNames  = requirePipeline(targetCfg, opts.target);
  const pluginTaskName = derivePluginTaskName(pipelineNames);
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

  // ── Services + dispatcher (proxy breaks construction circularity) ──────────
  const holder: { current: RipperServices | null } = { current: null };
  const dispatcher = new RipperDagonizer<ScrapeState>({
    services: new Proxy({} as RipperServices, {
      get(_t, prop) {
        if (holder.current === null) {
          throw new Error('RipperServices accessed before initialisation');
        }
        return (holder.current as unknown as Record<string | symbol, unknown>)[prop as string];
      },
    }),
  });

  const services: RipperServices = {
    log:            Logger.forComponent('runHtml'),
    cache,
    htmlScraper,
    target:         { id: opts.target, cfg: targetCfg },
    outDir:         opts.outDir,
    pluginTaskName,
    splitByTaskName,
    dispatcher:     dispatcher as unknown as DagonizerInterface<ScrapeState, RipperServices>,
  };
  holder.current = services;

  // ── Node registration ──────────────────────────────────────────────────────
  registerBuiltinNodes(dispatcher);

  const htmlPluginDagNames = await loadAndRegisterPlugins(dispatcher, pipelineNames, opts.configDir);

  const htmlDispatchNode = makeDispatchPageDagNode({
    nodeName:         'html:dispatch-page-dag',
    childDagName:     htmlPageFlowName(opts.target),
    itemMetadataKeys: ['currentUrl', 'currentRetryUrl'],
    targetId:         opts.target,
    pageSetup(state, url) {
      state.page = { targetId: opts.target, title: '', url };
    },
  });
  dispatcher.registerNode(htmlDispatchNode);

  // ── Phase DAG registration ─────────────────────────────────────────────────
  // Phase DAGs use DAGBuilder.fanOut with the built-in `partition` fan-in
  // strategy. FlowDeriver's `fanouts` annotation hardcodes `strategy: 'custom'`
  // (FlowDeriver.ts:262) and cannot express the built-in partition strategy.
  // DAGBuilder is retained here for this specific fan-out construction.

  const htmlScrapePhaseDAG = new DAGBuilder(HTML_SCRAPE_PHASE, '2.0')
    .fanOut(
      'scrape-urls',
      htmlDispatchNode,
      'urls',
      {
        strategy:   'partition',
        partitions: { success: 'succeeded', error: 'failed' },
      },
      { 'all-success': null, partial: null, 'all-error': null, empty: null },
      { itemKey: 'currentUrl', concurrency: 4 },
    )
    .build();

  const htmlRetryPhaseDAG = new DAGBuilder(HTML_RETRY_PHASE, '2.0')
    .fanOut(
      'retry-urls',
      htmlDispatchNode,
      'failed',
      {
        strategy:   'partition',
        partitions: { success: 'recovered', error: 'failedAfterRetry' },
      },
      { 'all-success': null, partial: null, 'all-error': null, empty: null },
      { itemKey: 'currentRetryUrl', concurrency: 4 },
    )
    .build();

  dispatcher.registerDAG(buildHtmlPageFlow(pipelineNames, opts.target, htmlPluginDagNames));
  dispatcher.registerDAG(htmlScrapePhaseDAG);
  dispatcher.registerDAG(htmlRetryPhaseDAG);

  const hasCrawl   = pipelineNames.includes('crawl:list-targets');
  let outerDagName: string;

  if (hasCrawl) {
    const htmlCrawlPhaseDAG = new DAGBuilder(HTML_CRAWL_PHASE, '2.0')
      .node(
        'crawl:list-targets',
        stub('crawl:list-targets', ['success', 'error', 'empty'] as const),
        { success: null, error: null, empty: null },
      )
      .build();

    const htmlScrapeDAGCrawl = FlowDeriver.derive({
      name:       'htmlScrapeDAGCrawl',
      version:    '2.0',
      entrypoint: 'crawl',
      contracts: [
        { name: 'crawl',  hardRequired: [],              produces: ['crawl-done'],  outputs: ['success', 'error'] },
        { name: 'scrape', hardRequired: ['crawl-done'],  produces: ['scrape-done'], outputs: ['success', 'error'] },
        { name: 'retry',  hardRequired: ['scrape-done'], produces: ['retry-done'],  outputs: ['success', 'error'] },
        { name: 'flow:terminate', hardRequired: ['retry-done'],  produces: [],              outputs: ['success'] },
      ],
      annotations: {
        subDAGs: {
          crawl:  { dag: HTML_CRAWL_PHASE,  outputs: ['success', 'error'], stateMapping: { output: { urls: 'urls' } } },
          scrape: { dag: HTML_SCRAPE_PHASE, outputs: ['success', 'error'], stateMapping: { output: { succeeded: 'succeeded', failed: 'failed' } } },
          retry:  { dag: HTML_RETRY_PHASE,  outputs: ['success', 'error'], stateMapping: { output: { recovered: 'recovered', failedAfterRetry: 'failedAfterRetry' } } },
        },
        terminals: {
          crawl:            [{ outcome: 'error', target: 'flow:terminate' }],
          'flow:terminate': [{ outcome: 'success', target: null }],
        },
      },
    });

    dispatcher.registerDAG(htmlCrawlPhaseDAG);
    dispatcher.registerDAG(htmlScrapeDAGCrawl);
    outerDagName = 'htmlScrapeDAGCrawl';
  } else {
    const htmlScrapeDAG = FlowDeriver.derive({
      name:       'htmlScrapeDAG',
      version:    '2.0',
      entrypoint: 'scrape',
      contracts: [
        { name: 'scrape', hardRequired: [],              produces: ['scrape-done'], outputs: ['success', 'error'] },
        { name: 'retry',  hardRequired: ['scrape-done'], produces: ['retry-done'],  outputs: ['success', 'error'] },
        { name: 'flow:terminate', hardRequired: ['retry-done'],  produces: [],              outputs: ['success'] },
      ],
      annotations: {
        subDAGs: {
          scrape: { dag: HTML_SCRAPE_PHASE, outputs: ['success', 'error'], stateMapping: { output: { succeeded: 'succeeded', failed: 'failed' } } },
          retry:  { dag: HTML_RETRY_PHASE,  outputs: ['success', 'error'], stateMapping: { output: { recovered: 'recovered', failedAfterRetry: 'failedAfterRetry' } } },
        },
        terminals: {
          'flow:terminate': [{ outcome: 'success', target: null }],
        },
      },
    });

    dispatcher.registerDAG(htmlScrapeDAG);
    outerDagName = 'htmlScrapeDAG';
  }

  // ── Dispatch ───────────────────────────────────────────────────────────────
  const state = new ScrapeState();
  if (opts.paths.length > 0) {
    state.urls = [...opts.paths];
  }

  if (outerDagName === 'htmlScrapeDAG' && state.urls.length === 0) {
    log.info('runHtml', 'No URLs to scrape');
    return;
  }

  await dispatcher.execute(outerDagName, state);

  log.info('runHtml',
    `Completed ${state.succeeded.length.toString()} pages on first attempt; `
    + `recovered ${state.recovered.length.toString()} on retry; `
    + `${state.failedAfterRetry.length.toString()} failed after retry`);

  if (state.failedAfterRetry.length > 0) {
    const manifest: FailuresManifestInterface = {
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

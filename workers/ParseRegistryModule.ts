/**
 * ParseRegistryModule — registry module for the dagonizer worker isolate.
 *
 * The default export implements `RegistryModuleInterface<RipperServices>`.
 * `WorkerThreadContainer` dynamic-imports this module inside each worker thread
 * and calls `instantiate(servicesConfig)` to rebuild the full services bag and
 * node/DAG registry locally — services never cross the thread boundary.
 *
 * Compiled by `tsconfig.workers.json` to `dist-workers/workers/ParseRegistryModule.js`.
 * The URL is constructed in `src/run/runDag.ts` relative to the compiled runDag path.
 *
 * ### What the worker needs to run `aonprd:page`
 * - All built-in scrape nodes (`html:fetch`, `json:write`, etc.)
 * - The `crawl:discover` builtin DAG
 * - All AONPRD taxonomy nodes (`TAXONOMY.allNodes()`)
 * - The `aonprd:parse` and `aonprd:page` DAGs
 *
 * @module workers/ParseRegistryModule
 * @since 4.2.0
 */

import { readFileSync }  from 'node:fs';
import { resolve }       from 'node:path';
import { fileURLToPath } from 'node:url';

import { DAGDocument, Dagonizer }   from '@studnicky/dagonizer';
import type { RegistryModuleInterface, RegistryBundleInterface } from '@studnicky/dagonizer/contracts';
import type { JsonObjectType }      from '@studnicky/dagonizer/entities';

import { HtmlScraper }      from '../src/scrapers/HtmlScraper.js';
import { ScraperCache }     from '../src/modules/cache/ScraperCache.js';
import { Logger }           from '../src/modules/logger/logger.js';
import { ScrapeState }      from '../src/state/ScrapeState.js';
import { PluginLoader }     from '../src/run/PluginLoader.js';
import type { RipperServices } from '../src/services/RipperServices.js';
import { REGISTRY_VERSION } from '../src/run/ParseRegistryConfig.js';
import type { WorkerServicesConfigType } from '../src/run/ParseRegistryConfig.js';

import {
  HtmlFetchNode,
  WikiFetchNode,
  HtmlWriteRawNode,
  WikiWriteRawNode,
  JsonWriteNode,
  CaptureErrorNode,
  JsonlAppendNode,
  ValidateSchemaNode,
  TerminalNode,
  InitFrontierNode,
  FetchAndExtractLinksNode,
  DedupeAndEnqueueNode,
  CrawlExhaustedNode,
  RouteFailureNode,
  ResolveLinkNode,
} from '../src/nodes/index.js';

import { TAXONOMY }       from '../plugins/aonprd/taxonomy/aonprd.js';
import { aonprdPageDAG }  from '../plugins/aonprd/page.dag.js';
import { aonprdParseDAG } from '../plugins/aonprd/parse.dag.js';

// ── Crawl DAG path ──────────────────────────────────────────────────────────────
// Resolves from the compiled JS location in dist-workers/workers/.
// dist-workers/workers/ParseRegistryModule.js → ../src/crawlers/
const CRAWL_DAG_PATH = resolve(
  fileURLToPath(import.meta.url),
  '../../src/crawlers/crawl-discover.dag.jsonld',
);

// ── State restore adapter ───────────────────────────────────────────────────────

const scrapeStateRestoreAdapter = {
  restore(snapshot: JsonObjectType): ScrapeState {
    return ScrapeState.restore(snapshot);
  },
};

// ── ParseRegistryModule ─────────────────────────────────────────────────────────

/**
 * Registry module for the dagonizer worker isolate.
 *
 * Default export implements `RegistryModuleInterface<RipperServices>`.
 *
 * `instantiate(servicesConfig)` reconstructs the full services bag from the
 * opaque JSON config and returns the complete bundle of builtin + aonprd nodes
 * and DAGs, so a worker thread can run `aonprd:page` in isolation.
 *
 * @category Registry
 * @since 4.2.0
 */
class ParseRegistryModule implements RegistryModuleInterface<RipperServices> {
  async instantiate(servicesConfig: JsonObjectType): Promise<RegistryBundleInterface<RipperServices>> {
    const cfg = servicesConfig as unknown as WorkerServicesConfigType;

    // ── Rebuild cache ─────────────────────────────────────────────────────────
    const cache = cfg.cache != null
      ? ScraperCache.create({
          dir:   cfg.cache.dir,
          mode:  cfg.cache.mode,
          ttlMs: cfg.cache.ttlMs,
        })
      : null;

    // ── Rebuild HTML scraper ──────────────────────────────────────────────────
    const htmlScraper = cfg.baseUrl != null
      ? HtmlScraper.create({
          baseUrl:     cfg.baseUrl,
          rateLimitMs: cfg.rateLimitMs,
          jitterMs:    cfg.jitterMs,
          headers:     cfg.headers,
          ...(cache !== null ? { cache } : {}),
        })
      : undefined;

    const log = Logger.forComponent('ParseRegistryModule');

    // ── Build stub dispatcher to satisfy services.dispatcher type ─────────────
    // Worker isolates run the sub-DAG directly; `services.dispatcher` is
    // required by the interface but not called inside `aonprd:page` nodes.
    const stubDispatcher = new Dagonizer<ScrapeState, RipperServices>({
      services: {} as unknown as RipperServices,
    });

    const services: RipperServices = {
      log,
      cache,
      ...(htmlScraper !== undefined ? { htmlScraper } : {}),
      target:           { id: cfg.targetId },
      outDir:           cfg.outDir,
      pluginTaskName:   cfg.pluginTaskName,
      splitByTaskName:  cfg.splitByTaskName,
      ...(cfg.headers !== undefined           ? { headers:           cfg.headers }           : {}),
      ...(cfg.includeRawContent !== undefined  ? { includeRawContent: cfg.includeRawContent }  : {}),
      ...(cfg.outputSchema !== undefined       ? { outputSchema:      cfg.outputSchema }       : {}),
      ...(cfg.onSchemaError !== undefined      ? { onSchemaError:     cfg.onSchemaError }      : {}),
      dispatcher: stubDispatcher as unknown as typeof services['dispatcher'],
    };

    // ── Assemble builtin + aonprd nodes ───────────────────────────────────────
    const nodes = [
      HtmlFetchNode,
      WikiFetchNode,
      HtmlWriteRawNode,
      WikiWriteRawNode,
      JsonWriteNode,
      CaptureErrorNode,
      JsonlAppendNode,
      ValidateSchemaNode,
      TerminalNode,
      InitFrontierNode,
      FetchAndExtractLinksNode,
      DedupeAndEnqueueNode,
      CrawlExhaustedNode,
      RouteFailureNode,
      ResolveLinkNode,
      ...TAXONOMY.allNodes(),
    ];

    // ── Assemble DAGs (leaves first: crawl, parse, then page) ─────────────────
    const crawlDag = DAGDocument.load(readFileSync(CRAWL_DAG_PATH, 'utf-8'));
    const dags = PluginLoader.pluginDagsInRegistrationOrder([
      crawlDag,
      aonprdParseDAG,
      aonprdPageDAG,
    ]);

    return {
      bundle: { nodes, dags },
      services,
      registryVersion: REGISTRY_VERSION,
      restoreState:    scrapeStateRestoreAdapter,
    };
  }
}

export default new ParseRegistryModule();
export { REGISTRY_VERSION };

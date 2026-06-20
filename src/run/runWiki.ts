/**
 * runWiki — plain async function that executes one MediaWiki scrape run.
 *
 * Constructs inline `RipperServices` object literals (one for member-resolution,
 * one per batch), instantiates `RipperDagonizer` instances, registers built-in
 * nodes and flows, loads plugin modules from the config directory, then
 * dispatches the outer scrape DAG for each batch and returns.
 *
 * Phase DAG construction:
 *   Phase DAGs (wikiScrapePhase, wikiRetryPhase) are built via `DAGBuilder`
 *   factory functions in `src/flows/wikiScrapeDag.ts`, each receiving the
 *   per-target DAG name as a `{ dag }` scatter body reference.
 *
 *   The outer composition DAG (wikiScrapeDAG) embeds phase DAGs as
 *   `embeddedDAG` placements.
 *
 *   The wikiResolveMembersFlow from src/flows/ is used directly (it references
 *   actual registered nodes).
 *
 * @module run/runWiki
 * @since 4.0.0
 */

import { writeFile, readdir, mkdir } from 'node:fs/promises';
import { resolve }                   from 'node:path';

import { Dagonizer }                  from '@studnicky/dagonizer';
import type { DagonizerInterface }    from '@studnicky/dagonizer';

import {
  buildWikiScrapePhaseDag,
  buildWikiRetryPhaseDag,
  buildWikiScrapeDag,
}                                     from '../flows/wikiScrapeDag.js';

import type { RipperServices }        from '../services/RipperServices.js';
import { RipperDagonizer }            from '../dispatcher/RipperDagonizer.js';
import { Logger }                     from '../modules/logger/logger.js';
import { ScraperCache }               from '../modules/cache/ScraperCache.js';
import { MediaWikiScraper }           from '../scrapers/MediaWikiScraper.js';
import { ScrapeState }                from '../state/ScrapeState.js';
import { MemberResolutionState }      from '../state/MemberResolutionState.js';
import type { CategoryMemberInterface } from '../types/MediaWikiScraper.js';
import type { ScrapeWikiOptionsInterface, FailuresManifestInterface } from '../types/RipperRun.js';
import type { ScrapeWikiResult }       from '../types/Results.js';

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
import {
  ChooseModeNode,
  ResumeFailuresNode,
  FetchSingleCategoryNode,
  FetchMultipleCategoriesNode,
  FetchAllPagesNode,
} from '../nodes/wiki/index.js';

import {
  wikiResolveMembersFlow,
  WIKI_RESOLVE_MEMBERS_FLOW,
} from '../flows/wikiScrapeFlow.js';
import { buildWikiPageFlow, wikiPageFlowName } from '../flows/wikiPageFlow.js';

// ── Constants ──────────────────────────────────────────────────────────────────

const BUILTIN_PREFIXES: ReadonlyArray<string> = [
  'html:', 'wiki:', 'json:', 'jsonl:', 'validate:', 'crawl:',
];

// ── Helpers ────────────────────────────────────────────────────────────────────

const log = Logger.forComponent('runWiki');

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
    if (BUILTIN_PREFIXES.some((prefix) => entry.startsWith(prefix))) continue;
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
    if (BUILTIN_PREFIXES.some((prefix) => entry.startsWith(prefix))) continue;
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
    const modRecord = mod as Record<string, unknown>;
    if (typeof modRecord['register'] !== 'function') {
      throw new Error(
        `Plugin at ${absPath} does not export register(dispatcher): void. `
        + `Add: export function register(dispatcher: RipperDagonizer<ScrapeState>): void { ... }`,
      );
    }
    (modRecord['register'] as (d: RipperDagonizer<ScrapeState>) => void)(dispatcher);
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

const toSlug = (title: string): string =>
  title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

// ── runWiki ────────────────────────────────────────────────────────────────────

export type { ScrapeWikiOptionsInterface };

/**
 * Executes one MediaWiki scrape run.
 *
 * Phases:
 *   1. Member resolution — dispatches `wikiResolveMembersDAG` to collect all
 *      page titles to scrape.
 *   2. Resume filter — skips titles whose slug already exists in the output dir.
 *   3. Batch loop — each batch gets its own fresh dispatcher and services bag;
 *      dispatches `wikiScrapeDAG` per batch.
 *   4. Failures manifest — written to `<outDir>/<target>/failures.json` when
 *      any titles failed after retry; deleted when `resumeFailures` was true
 *      and all titles succeeded.
 *
 * @param opts - Wiki scrape options.
 * @returns Resolves after all batches are processed.
 *
 * @category Orchestrators
 * @since 4.0.0
 */
export async function runWiki(opts: ScrapeWikiOptionsInterface): ScrapeWikiResult {
  const wikiTarget = opts.config.mediawiki?.[opts.target];
  if (wikiTarget === undefined) {
    log.error('runWiki', `Unknown mediawiki target: ${opts.target}`);
    process.exit(1);
  }

  const targetCfg      = wikiTarget as Record<string, unknown>;
  const pipelineNames  = requirePipeline(targetCfg, opts.target);
  const pluginTaskName = derivePluginTaskName(pipelineNames);
  const outputCfgWiki  = opts.config.output as Record<string, unknown>;
  const splitByTaskName: boolean | undefined =
    typeof outputCfgWiki['splitByTaskName'] === 'boolean'
      ? outputCfgWiki['splitByTaskName'] as boolean
      : undefined;

  // ── Build cache + scraper from target config ───────────────────────────────
  const cacheCfg = (targetCfg['cache'] as { dir?: string; mode?: string; ttlMs?: number } | undefined);
  const cache = cacheCfg?.dir != null && cacheCfg.mode != null
    ? ScraperCache.create({
        dir:   cacheCfg.dir,
        mode:  cacheCfg.mode as 'read-write' | 'read-only' | 'write-only' | 'off',
        ttlMs: cacheCfg.ttlMs,
      })
    : null;

  const wikiScraper = await MediaWikiScraper.create({
    apiUrl:      (targetCfg['apiUrl']      as string | undefined) ?? '',
    rateLimitMs: (targetCfg['rateLimitMs'] as number | undefined),
    jitterMs:    (targetCfg['jitterMs']    as number | undefined),
    ...(cache !== null ? { cache } : {}),
  });

  const targetDir = resolve(opts.outDir, opts.target);
  await mkdir(targetDir, { recursive: true });

  // ── Member resolution phase ────────────────────────────────────────────────
  // Use a plain Dagonizer<MemberResolutionState> with a proxy-services pattern
  // to resolve titles before the main batch loop.
  // wikiResolveMembersFlow references actual registered nodes; it dispatches directly.
  const memberServicesHolder: { current: RipperServices | null } = { current: null };
  const memberDispatcher = new Dagonizer<MemberResolutionState, RipperServices>({
    services: new Proxy({} as RipperServices, {
      get(_target, prop) {
        if (memberServicesHolder.current === null) {
          throw new Error('RipperServices accessed before initialisation');
        }
        return (memberServicesHolder.current as unknown as Record<string | symbol, unknown>)[prop as string];
      },
    }),
  });

  const memberServices: RipperServices = {
    log:         Logger.forComponent('runWiki:memberResolution'),
    cache,
    wikiScraper,
    target:      { id: opts.target, cfg: targetCfg },
    outDir:      opts.outDir,
    pluginTaskName,
    splitByTaskName,
    dispatcher:  memberDispatcher as unknown as DagonizerInterface<ScrapeState, RipperServices>,
  };
  memberServicesHolder.current = memberServices;

  memberDispatcher.registerNode(ChooseModeNode);
  memberDispatcher.registerNode(ResumeFailuresNode);
  memberDispatcher.registerNode(FetchSingleCategoryNode);
  memberDispatcher.registerNode(FetchMultipleCategoriesNode);
  memberDispatcher.registerNode(FetchAllPagesNode);
  memberDispatcher.registerDAG(wikiResolveMembersFlow);

  const memberState = new MemberResolutionState();
  memberState.target         = opts.target;
  memberState.config         = targetCfg;
  memberState.resumeFailures = opts.resumeFailures ?? false;
  memberState.category       = opts.category;

  await memberDispatcher.execute(WIKI_RESOLVE_MEMBERS_FLOW, memberState);

  const members: CategoryMemberInterface[] = memberState.members;
  const batchSize = (targetCfg['batchSize'] as number | undefined) ?? 50;

  // ── Resume: skip pages whose slug already exists ───────────────────────────
  const existingFiles  = await readdir(targetDir).catch((): string[] => []);
  const alreadyWritten = new Set<string>(
    existingFiles
      .filter((fileName) => fileName.endsWith('.json') && fileName !== 'failures.json')
      .map((fileName) => fileName.slice(0, -'.json'.length)),
  );

  const allTitles = members.map((member) => member.title);
  let skipped = 0;
  const pendingTitles: string[] = [];
  for (const title of allTitles) {
    if (alreadyWritten.has(toSlug(title))) {
      skipped++;
    } else {
      pendingTitles.push(title);
    }
  }

  if (skipped > 0) {
    log.info('runWiki', `Resuming: ${skipped.toString()} pages already written, ${pendingTitles.length.toString()} remaining`);
  }

  if (pendingTitles.length === 0) {
    log.info('runWiki', 'All pages already written');
    return;
  }

  // ── Batch loop ─────────────────────────────────────────────────────────────
  let written  = 0;
  let recovered = 0;
  const allFailedAfterRetry: string[] = [];

  for (let batchIndex = 0; batchIndex < pendingTitles.length; batchIndex += batchSize) {
    const slice = pendingTitles.slice(batchIndex, batchIndex + batchSize);
    const pages = await wikiScraper.fetchPagesBatch(slice);

    const batchState = new ScrapeState();
    batchState.titles = pages.map((page) => page.title);

    for (const page of pages) {
      batchState.setMetadata(`wikitext:${page.title}`, page.wikitext);
    }

    // Each batch gets its own isolated services + dispatcher.
    const batchHolder: { current: RipperServices | null } = { current: null };
    const batchDispatcher = new RipperDagonizer<ScrapeState>({
      services: new Proxy({} as RipperServices, {
        get(_target, prop) {
          if (batchHolder.current === null) {
            throw new Error('RipperServices accessed before initialisation');
          }
          return (batchHolder.current as unknown as Record<string | symbol, unknown>)[prop as string];
        },
      }),
    });

    const batchServices: RipperServices = {
      log:            Logger.forComponent('runWiki:batch'),
      cache,
      wikiScraper,
      target:         { id: opts.target, cfg: targetCfg },
      outDir:         opts.outDir,
      pluginTaskName,
      splitByTaskName,
      dispatcher:     batchDispatcher as unknown as DagonizerInterface<ScrapeState, RipperServices>,
    };
    batchHolder.current = batchServices;

    registerBuiltinNodes(batchDispatcher);

    const wikiPluginDagNames = await loadAndRegisterPlugins(batchDispatcher, pipelineNames, opts.configDir);

    // ── Phase + composition DAGs (DAGBuilder) ────────────────────────────────
    // Per-page DAG must be registered before the phase DAGs that reference it
    // by name via the { dag } scatter body.
    const perPageDagName = wikiPageFlowName(opts.target);
    batchDispatcher.registerDAG(buildWikiPageFlow(pipelineNames, opts.target, wikiPluginDagNames));
    batchDispatcher.registerDAG(buildWikiScrapePhaseDag(perPageDagName));
    batchDispatcher.registerDAG(buildWikiRetryPhaseDag(perPageDagName));
    batchDispatcher.registerDAG(buildWikiScrapeDag());

    await batchDispatcher.execute('wikiScrapeDAG', batchState);
    written   += batchState.succeeded.length;
    recovered += batchState.recovered.length;
    allFailedAfterRetry.push(...batchState.failedAfterRetry);

    log.debug('runWiki', `Progress: ${written.toString()}/${pendingTitles.length.toString()}`);
  }

  log.info('runWiki',
    `Wrote ${written.toString()} pages on first attempt, `
    + `recovered ${recovered.toString()} on retry; `
    + `${allFailedAfterRetry.length.toString()} failed after retry. Output: ${targetDir}`);

  // ── Failures manifest ──────────────────────────────────────────────────────
  const failuresPath = resolve(targetDir, 'failures.json');
  if (allFailedAfterRetry.length > 0) {
    const manifest: FailuresManifestInterface = {
      timestamp: new Date().toISOString(),
      count:     allFailedAfterRetry.length,
      titles:    allFailedAfterRetry,
    };
    await writeFile(failuresPath, JSON.stringify(manifest, null, 2));
    log.warn('runWiki', `${allFailedAfterRetry.length.toString()} pages failed after retry — written to failures.json`);
  } else if (opts.resumeFailures === true) {
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(failuresPath);
    } catch {
      /* already gone */
    }
  }
}

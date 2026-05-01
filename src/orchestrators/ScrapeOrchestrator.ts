import { writeFile, readFile, unlink, mkdir, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { HtmlScraper } from '../scrapers/HtmlScraper.js';
import { MediaWikiScraper } from '../scrapers/MediaWikiScraper.js';
import type { CategoryMemberInterface, MediaWikiConfigInterface } from '../types/MediaWikiScraper.js';
import type { HtmlScraperConfigInterface } from '../types/HtmlScraper.js';
import { Pipeline } from '../pipeline/Pipeline.js';
import { ConcurrentPipeline } from '../pipeline/ConcurrentPipeline.js';
import { TaskRegistry } from '../registry/TaskRegistry.js';
import { PipelineState } from '../registry/PipelineState.js';
import type { PipelineStateInterface, PipelinePageInterface } from '../types/PipelineState.js';
import { Logger } from '../modules/logger/logger.js';
import { ScraperCache } from '../modules/cache/ScraperCache.js';
import type { ScraperCacheConfigInterface } from '../types/ScraperCache.js';
import type {
  ScrapeHtmlOptionsInterface,
  ScrapeWikiOptionsInterface,
  RunPipelineOptionsInterface,
  FailuresManifestInterface,
} from '../types/ScrapeOrchestrator.js';
import type { ScrapeHtmlResult, ScrapeWikiResult } from '../types/Results.js';
import { ConfigClamp } from '../config/ConfigClamp.js';

export type { ScrapeHtmlOptionsInterface, ScrapeWikiOptionsInterface };

const BUILTIN_PREFIXES: ReadonlyArray<string> = ['html:', 'wiki:', 'json:', 'jsonl:', 'validate:', 'crawl:'];

/**
 * Coordinates scraping pipelines for both HTML and MediaWiki targets.
 *
 * @remarks
 * All methods are static. Instantiation is forbidden. Each invocation
 * registers built-in tasks once (idempotent), loads any plugin tasks the
 * pipeline references, builds a single `ScraperCache` instance shared
 * between the LinkLister and HtmlScraper / MediaWikiScraper for that run,
 * then runs the user-declared `pipeline: string[]` per page.
 *
 * @example
 * ```ts
 * await ScrapeOrchestrator.scrapeWiki({ target: 'aonprd', outDir: './out', configDir: '.', config });
 * ```
 * @category Orchestrators
 * @since 2.0.0
 * @group Orchestrators
 * @see ScrapeWikiOptionsInterface
 */
export class ScrapeOrchestrator {
  private constructor() { /* static-only */ }

  /**
   * Runs a scrape pipeline for a configured HTML target across the given paths.
   *
   * @param opts - HTML scrape options including target key, paths, output dir, and config.
   * @throws Exits process with code 1 if the target is not found in config.
   */
  public static async scrapeHtml(opts: ScrapeHtmlOptionsInterface): ScrapeHtmlResult {
    const log        = Logger.forComponent('ScrapeOrchestrator');
    const htmlTarget = opts.config.targets?.[opts.target];

    if (htmlTarget === undefined) {
      log.error('scrapeHtml', `Unknown html target: ${opts.target}`);
      process.exit(1);
    }

    await import('../registry/builtinTasks.js');

    const targetCfg     = htmlTarget as Record<string, unknown>;
    const pipelineNames = ScrapeOrchestrator.requirePipeline(targetCfg, opts.target);
    const pluginPaths   = ScrapeOrchestrator.derivePluginPaths(pipelineNames);
    await TaskRegistry.loadAll(pluginPaths, opts.configDir);

    const cache       = ScrapeOrchestrator.buildCache(targetCfg);
    const clamped     = ConfigClamp.html(targetCfg, opts.target) as Record<string, unknown>;
    const scraperCfg: HtmlScraperConfigInterface = {
      baseUrl: clamped['baseUrl'] as string,
      ...(typeof clamped['rateLimitMs']      === 'number' ? { rateLimitMs:      clamped['rateLimitMs']      as number } : {}),
      ...(typeof clamped['jitterMs']         === 'number' ? { jitterMs:         clamped['jitterMs']         as number } : {}),
      ...(typeof clamped['maxRetries']       === 'number' ? { maxRetries:       clamped['maxRetries']       as number } : {}),
      ...(typeof clamped['retryBaseDelayMs'] === 'number' ? { retryBaseDelayMs: clamped['retryBaseDelayMs'] as number } : {}),
      ...(typeof clamped['retryMaxDelayMs']  === 'number' ? { retryMaxDelayMs:  clamped['retryMaxDelayMs']  as number } : {}),
      ...(clamped['headers'] !== undefined ? { headers: clamped['headers'] as Record<string, string> } : {}),
      ...(cache !== null ? { cache } : {}),
    };
    const scraper = HtmlScraper.create(scraperCfg);

    await mkdir(resolve(opts.outDir, opts.target), { recursive: true });

    const failures: string[] = [];

    const urls = await ScrapeOrchestrator.resolveHtmlUrls({
      paths:        opts.paths,
      pipelineNames,
      targetConfig: targetCfg,
      target:       opts.target,
      outDir:       opts.outDir,
      cache,
      log,
    });

    for (const path of urls) {
      const state = PipelineState.fromHtmlUrl(opts.target, path);
      state.context = {
        target: opts.target,
        outDir: opts.outDir,
        scraper,
        config: targetCfg,
        ...(cache !== null ? { cache } : {}),
      };
      const pipeline = Pipeline.create<PipelineStateInterface>({ name: opts.target });
      for (const taskName of pipelineNames) {
        if (taskName === 'crawl:list-targets') continue; // already executed during URL resolution
        pipeline.addTask(TaskRegistry.get(taskName));
      }
      try {
        await pipeline.execute(state);
        log.info('scrapeHtml', `Completed ${path}`);
      } catch (err) {
        failures.push(path);
        log.warn('scrapeHtml', `Failed ${path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (failures.length > 0) {
      const manifest: FailuresManifestInterface = {
        timestamp: new Date().toISOString(),
        count:     failures.length,
        titles:    failures,
      };
      await writeFile(resolve(opts.outDir, opts.target, 'failures.json'), JSON.stringify(manifest, null, 2));
      log.warn('scrapeHtml', `${failures.length.toString()} pages failed — written to failures.json`);
    }
  }

  /**
   * Runs a scrape pipeline for a configured MediaWiki target.
   *
   * @param opts - Wiki scrape options including target key, optional category, output dir, and config.
   * @throws Exits process with code 1 if the target is not found in config.
   */
  public static async scrapeWiki(opts: ScrapeWikiOptionsInterface): ScrapeWikiResult {
    const log        = Logger.forComponent('ScrapeOrchestrator');
    const wikiTarget = opts.config.mediawiki?.[opts.target];

    if (wikiTarget === undefined) {
      log.error('scrapeWiki', `Unknown mediawiki target: ${opts.target}`);
      process.exit(1);
    }

    await import('../registry/builtinTasks.js');

    const targetCfg     = wikiTarget as Record<string, unknown>;
    const pipelineNames = ScrapeOrchestrator.requirePipeline(targetCfg, opts.target);
    const pluginPaths   = ScrapeOrchestrator.derivePluginPaths(pipelineNames);
    await TaskRegistry.loadAll(pluginPaths, opts.configDir);

    const cache       = ScrapeOrchestrator.buildCache(targetCfg);
    const clamped     = ConfigClamp.mediawiki(targetCfg, opts.target) as Record<string, unknown>;
    const scraperCfg: MediaWikiConfigInterface = {
      apiUrl: clamped['apiUrl'] as string,
      ...(typeof clamped['rateLimitMs']      === 'number' ? { rateLimitMs:      clamped['rateLimitMs']      as number } : {}),
      ...(typeof clamped['jitterMs']         === 'number' ? { jitterMs:         clamped['jitterMs']         as number } : {}),
      ...(typeof clamped['batchSize']        === 'number' ? { batchSize:        clamped['batchSize']        as number } : {}),
      ...(typeof clamped['maxPages']         === 'number' ? { maxPages:         clamped['maxPages']         as number } : {}),
      ...(typeof clamped['maxRetries']       === 'number' ? { maxRetries:       clamped['maxRetries']       as number } : {}),
      ...(typeof clamped['retryBaseDelayMs'] === 'number' ? { retryBaseDelayMs: clamped['retryBaseDelayMs'] as number } : {}),
      ...(typeof clamped['retryMaxDelayMs']  === 'number' ? { retryMaxDelayMs:  clamped['retryMaxDelayMs']  as number } : {}),
      ...(cache !== null ? { cache } : {}),
    };
    const scraper = await MediaWikiScraper.create(scraperCfg);

    await mkdir(resolve(opts.outDir, opts.target), { recursive: true });

    // Resolve page list — four modes:
    // 0. --resume-failures → read titles from failures.json and retry only those
    // 1. --category flag → single category
    // 2. categories[] in config, no flag → iterate all listed categories, deduplicate
    // 3. No categories anywhere → enumerate every article in the main article space
    let members: CategoryMemberInterface[];
    const configCategories = (wikiTarget as { categories?: string[] }).categories;

    if (opts.resumeFailures === true) {
      const failuresPath = resolve(opts.outDir, opts.target, 'failures.json');
      const raw          = await readFile(failuresPath, 'utf-8');
      const manifest     = JSON.parse(raw) as FailuresManifestInterface;
      members            = manifest.titles.map((title: string): CategoryMemberInterface => ({ title, pageid: 0 }));
      log.info('scrapeWiki', `Mode: resume-failures — ${members.length.toString()} pages from failures.json`);
    } else if (opts.category !== undefined) {
      members = await scraper.fetchCategory(opts.category);
      log.info('scrapeWiki', `Mode: single category "${opts.category}" — ${members.length.toString()} pages`);
    } else if (configCategories !== undefined && configCategories.length > 0) {
      members = await ScrapeOrchestrator.fetchDeduplicatedCategories(scraper, configCategories);
      log.info('scrapeWiki', `Mode: ${configCategories.length.toString()} categories — ${members.length.toString()} unique pages`);
    } else {
      log.info('scrapeWiki', 'Mode: all pages in main namespace (this may take a while)');
      const maxPages = (wikiTarget as { maxPages?: number }).maxPages ?? 500;
      members = await scraper.fetchAllPages(maxPages);
    }

    const batchSize   = (wikiTarget as { batchSize?: number }).batchSize ?? 50;
    const concurrency = (clamped['concurrency'] as number | undefined) ?? 1;

    await ScrapeOrchestrator.runPipeline({
      targetId:       opts.target,
      outDir:         opts.outDir,
      scraper,
      members,
      log,
      batchSize,
      concurrency,
      resumeFailures: opts.resumeFailures === true,
      pipeline:       pipelineNames,
      targetConfig:   targetCfg,
    });
  }

  /** Reads `target.pipeline` and validates that it's a non-empty string array. */
  private static requirePipeline(target: Record<string, unknown>, targetId: string): string[] {
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
  }

  /**
   * Maps non-built-in pipeline entries (`<word>:<verb>`) to plugin file paths.
   * Built-in tasks (those starting with html:/wiki:/json:/jsonl:/validate:/crawl:)
   * are skipped because they self-register on `builtinTasks` import. Tasks
   * already registered (e.g. plugins imported eagerly by tests) are also skipped.
   */
  private static derivePluginPaths(pipeline: ReadonlyArray<string>): string[] {
    const paths: string[] = [];
    const seen = new Set<string>();
    for (const entry of pipeline) {
      if (BUILTIN_PREFIXES.some((p: string): boolean => entry.startsWith(p))) continue;
      if (TaskRegistry.has(entry)) continue;
      const colon = entry.indexOf(':');
      if (colon <= 0) continue;
      const word = entry.slice(0, colon);
      const verb = entry.slice(colon + 1);
      const path = `./plugins/${word}/${verb}.task.js`;
      if (!seen.has(path)) {
        seen.add(path);
        paths.push(path);
      }
    }
    return paths;
  }

  /** Builds a `ScraperCache` from `target.cache`, layering `target.maxPages` into `maxEntries`. */
  private static buildCache(target: Record<string, unknown>): ScraperCache | null {
    const cacheCfg = target['cache'];
    if (cacheCfg === undefined || cacheCfg === null) return null;
    const cfg = cacheCfg as ScraperCacheConfigInterface;
    if (cfg.mode === 'off') return null;
    const maxPages = target['maxPages'];
    const finalCfg: ScraperCacheConfigInterface = {
      ...cfg,
      ...(typeof maxPages === 'number' && maxPages > 0 ? { maxEntries: maxPages } : {}),
    };
    return ScraperCache.create(finalCfg);
  }

  /**
   * Determines the URL list for an HTML scrape.
   * If `crawl:list-targets` is part of the pipeline AND `paths` is empty, runs
   * the crawl task once to surface URLs. Otherwise returns `paths` verbatim.
   */
  private static async resolveHtmlUrls(opts: {
    paths:         ReadonlyArray<string>;
    pipelineNames: ReadonlyArray<string>;
    targetConfig:  Record<string, unknown>;
    target:        string;
    outDir:        string;
    cache:         ScraperCache | null;
    log:           ReturnType<typeof Logger.forComponent>;
  }): Promise<string[]> {
    if (opts.paths.length > 0) return [...opts.paths];
    if (!opts.pipelineNames.includes('crawl:list-targets')) return [];

    const discoveryState: PipelineStateInterface = {
      targetId: opts.target,
      page:     { targetId: opts.target, title: '', url: '' } as PipelinePageInterface,
      output:   null,
      context:  {
        target: opts.target,
        outDir: opts.outDir,
        config: opts.targetConfig,
        ...(opts.cache !== null ? { cache: opts.cache } : {}),
      },
    };

    const task = TaskRegistry.get('crawl:list-targets');
    await task(async (): Promise<void> => { /* terminal next */ }, discoveryState);

    const ctx = discoveryState.context as { targets?: ReadonlyArray<string> } | undefined;
    const discovered: ReadonlyArray<string> = ctx?.targets ?? [];
    opts.log.info('resolveHtmlUrls', `crawl:list-targets discovered ${discovered.length.toString()} URLs`);
    return [...discovered];
  }

  private static async fetchDeduplicatedCategories(
    scraper: MediaWikiScraper,
    categories: string[],
  ): Promise<CategoryMemberInterface[]> {
    const seen    = new Set<string>();
    const members: CategoryMemberInterface[] = [];
    for (const cat of categories) {
      const batch = await scraper.fetchCategory(cat);
      for (const m of batch) {
        if (!seen.has(m.title)) { seen.add(m.title); members.push(m); }
      }
    }
    return members;
  }

  /** Compute the output filename slug for a wiki page title. */
  private static toSlug(title: string): string {
    return title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  }

  private static async runPipeline(opts: RunPipelineOptionsInterface): Promise<void> {
    const { targetId, outDir, scraper, members, log, batchSize, concurrency, resumeFailures, pipeline: pipelineNames, targetConfig } = opts;

    // ── Resume: build set of already-written slugs ──────────────────────────
    const targetDir     = resolve(outDir, targetId);
    const existingFiles = await readdir(targetDir).catch((): string[] => []);
    const alreadyWritten = new Set<string>(
      existingFiles
        .filter((f: string): boolean => f.endsWith('.json') && f !== 'failures.json')
        .map((f: string): string => f.slice(0, -'.json'.length)),
    );

    const allTitles = members.map((m: CategoryMemberInterface): string => m.title);
    let skipped = 0;
    const pending: string[] = [];
    for (const title of allTitles) {
      if (alreadyWritten.has(ScrapeOrchestrator.toSlug(title))) {
        skipped++;
      } else {
        pending.push(title);
      }
    }

    if (skipped > 0) {
      log.info('scrapeWiki', `Resuming: ${skipped.toString()} pages already written, ${pending.length.toString()} remaining`);
    }

    // ── Batch loop ────────────────────────────────────────────────────────────
    // One Pipeline instance shared across all concurrent executions — its task
    // queue is read-only during execute() so concurrent calls are safe.
    const pipeline = Pipeline.create<PipelineStateInterface>({ name: targetId });
    for (const taskName of pipelineNames) pipeline.addTask(TaskRegistry.get(taskName));

    const runner   = ConcurrentPipeline.create(pipeline, concurrency, { name: targetId });
    const failures: string[] = [];
    let written = 0;

    for (let i = 0; i < pending.length; i += batchSize) {
      const slice = pending.slice(i, i + batchSize);
      const pages = await scraper.fetchPagesBatch(slice);

      const states: PipelineStateInterface[] = pages.map(
        (page): PipelineStateInterface => ({
          targetId,
          page:    { targetId, title: page.title, url: '', wikitext: page.wikitext },
          output:  null,
          context: {
            target: targetId,
            outDir,
            scraper,
            config: targetConfig,
          },
        }),
      );

      const result = await runner.executeAll(states);
      written += result.completed.length;
      for (const { state } of result.failed) {
        failures.push((state.page as { title: string }).title);
      }

      log.debug('scrapeWiki', `Progress: ${written.toString()}/${pending.length.toString()}`);
    }

    log.info('scrapeWiki', `Wrote ${written.toString()} pages to ${targetDir}`);

    // ── Failures manifest ─────────────────────────────────────────────────────
    const failuresPath = resolve(targetDir, 'failures.json');

    if (failures.length > 0) {
      const manifest: FailuresManifestInterface = {
        timestamp: new Date().toISOString(),
        count:     failures.length,
        titles:    failures,
      };
      await writeFile(failuresPath, JSON.stringify(manifest, null, 2));
      log.warn('scrapeWiki', `${failures.length.toString()} pages failed — written to failures.json`);
    } else if (resumeFailures) {
      // Clean up the failures manifest on a successful retry run
      await unlink(failuresPath).catch((): void => { /* already gone */ });
    }
  }
}

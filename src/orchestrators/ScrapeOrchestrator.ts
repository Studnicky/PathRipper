import { writeFile, readFile, unlink, mkdir, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { HtmlScraper } from '../scrapers/HtmlScraper.js';
import { MediaWikiScraper } from '../scrapers/MediaWikiScraper.js';
import type { CategoryMemberInterface } from '../types/MediaWikiScraper.js';
import { WikitextParser } from '../scrapers/WikitextParser.js';
import { Pipeline } from '../pipeline/Pipeline.js';
import type { NextFnInterface } from '../types/Pipeline.js';
import { TaskRegistry } from '../registry/TaskRegistry.js';
import { PipelineState } from '../registry/PipelineState.js';
import type { PipelineStateInterface } from '../types/PipelineState.js';
import { Logger } from '../modules/logger/logger.js';
import type {
  ScrapeHtmlOptionsInterface,
  ScrapeWikiOptionsInterface,
  RunPipelineOptionsInterface,
  FailuresManifestInterface,
} from '../types/ScrapeOrchestrator.js';
import type { ScrapeHtmlResult, ScrapeWikiResult } from '../types/Results.js';
import { ConfigClamp } from '../config/ConfigClamp.js';

export type { ScrapeHtmlOptionsInterface, ScrapeWikiOptionsInterface };

/**
 * Coordinates scraping pipelines for both HTML and MediaWiki targets.
 *
 * @remarks
 * All methods are static. Instantiation is forbidden. Call `scrapeHtml` or `scrapeWiki`
 * with validated options to execute a full scrape pipeline.
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

    const tasks = (htmlTarget as { tasks?: string[] }).tasks ?? [];
    await TaskRegistry.loadAll(tasks, opts.configDir);

    const scraper = HtmlScraper.create(ConfigClamp.html(htmlTarget as Record<string, unknown>, opts.target) as typeof htmlTarget);
    await mkdir(resolve(opts.outDir, opts.target), { recursive: true });

    for (const path of opts.paths) {
      const page     = await scraper.fetchPage(path);
      const pipeline = Pipeline.create<PipelineStateInterface>({ name: opts.target });
      if (TaskRegistry.has(`${opts.target}:parse`)) {
        pipeline.addTask(TaskRegistry.get(`${opts.target}:parse`));
      }
      pipeline.addTask(async (next: NextFnInterface, state: PipelineStateInterface): Promise<void> => {
        await next();
        const slug     = page.url.replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-').toLowerCase();
        const payload  = state.output ?? { url: page.url };
        const filePath = resolve(opts.outDir, opts.target, `${slug}.json`);
        await writeFile(filePath, JSON.stringify(payload, null, 2));
      });
      await pipeline.execute(PipelineState.fromHtmlPage(opts.target, page));
      log.info('scrapeHtml', `Wrote ${page.url}`);
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

    const tasks = (wikiTarget as { tasks?: string[] }).tasks ?? [];
    await TaskRegistry.loadAll(tasks, opts.configDir);

    const scraper = await MediaWikiScraper.create(ConfigClamp.mediawiki(wikiTarget as Record<string, unknown>, opts.target) as typeof wikiTarget);
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
      const allPagesLimit = (wikiTarget as { allPagesLimit?: number }).allPagesLimit ?? 500;
      members = await scraper.fetchAllPages(allPagesLimit);
    }

    const batchSize = (wikiTarget as { batchSize?: number }).batchSize ?? 50;

    await ScrapeOrchestrator.runPipeline({
      targetId:       opts.target,
      outDir:         opts.outDir,
      scraper,
      members,
      log,
      batchSize,
      resumeFailures: opts.resumeFailures === true,
    });
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
    const { targetId, outDir, scraper, members, log, batchSize, resumeFailures } = opts;

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
    const failures: string[] = [];
    let written = 0;

    for (let i = 0; i < pending.length; i += batchSize) {
      const slice = pending.slice(i, i + batchSize);
      const pages = await scraper.fetchPagesBatch(slice);

      for (const page of pages) {
        const pipeline = Pipeline.create<PipelineStateInterface>({ name: targetId });
        if (TaskRegistry.has(`${targetId}:parse`)) {
          pipeline.addTask(TaskRegistry.get(`${targetId}:parse`));
        }
        pipeline.addTask(async (next: NextFnInterface, state: PipelineStateInterface): Promise<void> => {
          await next();
          const slug    = ScrapeOrchestrator.toSlug(page.title);
          const payload = state.output !== null
            ? state.output
            : WikitextParser.parse(page.title, page.wikitext);
          await writeFile(resolve(outDir, targetId, `${slug}.json`), JSON.stringify(payload, null, 2));
          written++;
        });
        try {
          await pipeline.execute(PipelineState.fromWikiPage(targetId, page));
        } catch {
          failures.push(page.title);
        }
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

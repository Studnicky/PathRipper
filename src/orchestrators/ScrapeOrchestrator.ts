import { writeFile, mkdir } from 'node:fs/promises';
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
import type { ScrapeHtmlOptionsInterface, ScrapeWikiOptionsInterface } from '../types/ScrapeOrchestrator.js';
import type { ScrapeHtmlResult, ScrapeWikiResult } from '../types/Results.js';

export type { ScrapeHtmlOptionsInterface, ScrapeWikiOptionsInterface };

interface RunPipelineOptionsInterface {
  readonly targetId: string;
  readonly outDir:   string;
  readonly scraper:  MediaWikiScraper;
  readonly members:  CategoryMemberInterface[];
  readonly log:      ReturnType<typeof Logger.forComponent>;
}

/** Coordinates scraping pipelines for both HTML and MediaWiki targets. */
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

    const scraper = HtmlScraper.create(htmlTarget);
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

    const scraper = await MediaWikiScraper.create(wikiTarget);
    await mkdir(resolve(opts.outDir, opts.target), { recursive: true });

    // Resolve page list — three modes:
    // 1. --category flag → single category
    // 2. categories[] in config, no flag → iterate all listed categories, deduplicate
    // 3. No categories anywhere → enumerate every article in main namespace
    let members: CategoryMemberInterface[];
    const configCategories = (wikiTarget as { categories?: string[] }).categories;

    if (opts.category !== undefined) {
      members = await scraper.fetchCategory(opts.category);
      log.info('scrapeWiki', `Mode: single category "${opts.category}" — ${members.length.toString()} pages`);
    } else if (configCategories !== undefined && configCategories.length > 0) {
      members = await ScrapeOrchestrator.fetchDeduplicatedCategories(scraper, configCategories);
      log.info('scrapeWiki', `Mode: ${configCategories.length.toString()} categories — ${members.length.toString()} unique pages`);
    } else {
      log.info('scrapeWiki', 'Mode: all pages in main namespace (this may take a while)');
      members = await scraper.fetchAllPages();
    }

    await ScrapeOrchestrator.runPipeline({ targetId: opts.target, outDir: opts.outDir, scraper, members, log });
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

  private static async runPipeline(opts: RunPipelineOptionsInterface): Promise<void> {
    const { targetId, outDir, scraper, members, log } = opts;
    const BATCH = 50;
    const titles = members.map((m: CategoryMemberInterface): string => m.title);
    let written = 0;

    for (let i = 0; i < titles.length; i += BATCH) {
      const slice = titles.slice(i, i + BATCH);
      const pages = await scraper.fetchPagesBatch(slice);

      for (const page of pages) {
        const pipeline = Pipeline.create<PipelineStateInterface>({ name: targetId });
        if (TaskRegistry.has(`${targetId}:parse`)) {
          pipeline.addTask(TaskRegistry.get(`${targetId}:parse`));
        }
        pipeline.addTask(async (next: NextFnInterface, state: PipelineStateInterface): Promise<void> => {
          await next();
          const slug    = page.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
          const payload = state.output !== null
            ? state.output
            : WikitextParser.parse(page.title, page.wikitext);
          await writeFile(resolve(outDir, targetId, `${slug}.json`), JSON.stringify(payload, null, 2));
          written++;
        });
        await pipeline.execute(PipelineState.fromWikiPage(targetId, page));
      }

      log.debug('scrapeWiki', `Progress: ${written.toString()}/${titles.length.toString()}`);
    }

    log.info('scrapeWiki', `Wrote ${written.toString()} pages to ${resolve(outDir, targetId)}`);
  }
}

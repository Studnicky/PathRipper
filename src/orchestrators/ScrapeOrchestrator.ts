import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { HtmlScraper } from '../scrapers/HtmlScraper.js';
import { MediaWikiScraper } from '../scrapers/MediaWikiScraper.js';
import { WikitextParser } from '../scrapers/WikitextParser.js';
import { Pipeline } from '../pipeline/Pipeline.js';
import { TaskRegistry } from '../registry/TaskRegistry.js';
import { PipelineState } from '../registry/PipelineState.js';
import type { PipelineStateInterface } from '../registry/PipelineState.js';
import { Logger } from '../modules/logger/Logger.js';
import type { RipperConfigInterface } from '../schemas/internal/RipperConfigSchema.js';

export interface ScrapeHtmlOptionsInterface {
  readonly target:    string;
  readonly paths:     ReadonlyArray<string>;
  readonly outDir:    string;
  readonly configDir: string;
  readonly config:    RipperConfigInterface;
}

export interface ScrapeWikiOptionsInterface {
  readonly target:    string;
  readonly category:  string;
  readonly outDir:    string;
  readonly configDir: string;
  readonly config:    RipperConfigInterface;
}

export class ScrapeOrchestrator {
  private constructor() { /* static-only */ }

  public static async scrapeHtml(opts: ScrapeHtmlOptionsInterface): Promise<void> {
    const log        = Logger.forComponent('ScrapeOrchestrator');
    const htmlTarget = opts.config.targets?.[opts.target];

    if (htmlTarget === undefined) {
      log.error('scrapeHtml', `Unknown html target: ${opts.target}`);
      process.exit(1);
    }

    const tasks = (htmlTarget as { tasks?: string[] }).tasks ?? [];
    await TaskRegistry.loadAll(tasks, opts.configDir);

    const scraper = new HtmlScraper(htmlTarget);
    await mkdir(resolve(opts.outDir, opts.target), { recursive: true });

    for (const path of opts.paths) {
      const page     = await scraper.fetchPage(path);
      const pipeline = new Pipeline<PipelineStateInterface>({ name: opts.target });
      if (TaskRegistry.has(`${opts.target}:parse`)) {
        pipeline.addTask(TaskRegistry.get(`${opts.target}:parse`)!);
      }
      pipeline.addTask(async (next, state) => {
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

  public static async scrapeWiki(opts: ScrapeWikiOptionsInterface): Promise<void> {
    const log        = Logger.forComponent('ScrapeOrchestrator');
    const wikiTarget = opts.config.mediawiki?.[opts.target];

    if (wikiTarget === undefined) {
      log.error('scrapeWiki', `Unknown mediawiki target: ${opts.target}`);
      process.exit(1);
    }

    const tasks = (wikiTarget as { tasks?: string[] }).tasks ?? [];
    await TaskRegistry.loadAll(tasks, opts.configDir);

    const scraper = await MediaWikiScraper.create(wikiTarget);
    const pages   = await scraper.scrapeCategory(opts.category);
    await mkdir(resolve(opts.outDir, opts.target), { recursive: true });

    for (const page of pages) {
      const pipeline = new Pipeline<PipelineStateInterface>({ name: opts.target });
      if (TaskRegistry.has(`${opts.target}:parse`)) {
        pipeline.addTask(TaskRegistry.get(`${opts.target}:parse`)!);
      }
      pipeline.addTask(async (next, state) => {
        await next();
        const slug     = page.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        const payload  = state.output !== null
          ? state.output
          : WikitextParser.parse(page.title, page.wikitext);
        const filePath = resolve(opts.outDir, opts.target, `${slug}.json`);
        await writeFile(filePath, JSON.stringify(payload, null, 2));
      });
      await pipeline.execute(PipelineState.fromWikiPage(opts.target, page));
    }

    log.info('scrapeWiki', `Wrote ${pages.length.toString()} pages to ${resolve(opts.outDir, opts.target)}`);
  }
}

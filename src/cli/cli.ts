import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RipperConfig } from '../config/RipperConfig.js';
import { HtmlScraper } from '../scrapers/HtmlScraper.js';
import { MediaWikiScraper } from '../scrapers/MediaWikiScraper.js';
import { WikitextParser } from '../scrapers/WikitextParser.js';
import { LinkLister } from '../crawlers/LinkLister.js';
import { Logger } from '../modules/logger/Logger.js';
import { Pipeline } from '../pipeline/Pipeline.js';
import { TaskRegistry } from '../registry/TaskRegistry.js';
import { PipelineState } from '../registry/PipelineState.js';
import type { PipelineStateInterface } from '../registry/PipelineState.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8')) as { version: string };

const DEFAULT_CONFIG_PATH = './ripperoni.config.json';

const program = new Command();

program
  .name('ripperoni')
  .description('Configurable web scraper — HTML, MediaWiki, and link crawler.')
  .version(pkg.version);

program
  .command('scrape')
  .description('Scrape a configured target — detects html or mediawiki mode from config')
  .requiredOption('--target <name>', 'Target name from config (checked in targets then mediawiki)')
  .option('--paths <paths...>', 'Paths to scrape (html mode)')
  .option('--category <name>', 'Category to scrape (mediawiki mode)')
  .option('--config <path>', 'Config file path', DEFAULT_CONFIG_PATH)
  .option('--out <dir>', 'Output directory override')
  .action(async (opts: { target: string; paths?: string[]; category?: string; config: string; out?: string }) => {
    const log       = Logger.forComponent('cli');
    const config    = await RipperConfig.load(opts.config);
    const configDir = dirname(resolve(opts.config));

    const htmlTarget = config.targets?.[opts.target];
    const wikiTarget = config.mediawiki?.[opts.target];

    if (htmlTarget !== undefined) {
      if (!opts.paths?.length) { log.error('scrape', '--paths required for html targets'); process.exit(1); }
      const tasks = ((htmlTarget as Record<string, unknown>)['tasks'] as string[] | undefined) ?? [];
      await TaskRegistry.loadAll(tasks, configDir);
      const scraper = new HtmlScraper(htmlTarget);
      const outDir  = opts.out ?? config.output.basePath;
      await mkdir(resolve(outDir, opts.target), { recursive: true });
      for (const path of opts.paths!) {
        const page     = await scraper.fetchPage(path);
        const pipeline = new Pipeline<PipelineStateInterface>({ name: opts.target });
        if (TaskRegistry.has(`${opts.target}:parse`)) {
          pipeline.addTask(TaskRegistry.get(`${opts.target}:parse`)!);
        }
        pipeline.addTask(async (next, state) => {
          await next();
          const slug     = page.url.replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-').toLowerCase();
          const payload  = state.output ?? { url: page.url };
          const filePath = resolve(outDir, opts.target, `${slug}.json`);
          await writeFile(filePath, JSON.stringify(payload, null, 2));
        });
        await pipeline.execute(PipelineState.fromHtmlPage(opts.target, page));
        log.info('scrape', `Wrote ${page.url}`);
      }
      return;
    }

    if (wikiTarget !== undefined) {
      if (!opts.category) { log.error('scrape', '--category required for mediawiki targets'); process.exit(1); }
      const tasks = ((wikiTarget as Record<string, unknown>)['tasks'] as string[] | undefined) ?? [];
      await TaskRegistry.loadAll(tasks, configDir);
      const scraper = await MediaWikiScraper.create(wikiTarget);
      const pages   = await scraper.scrapeCategory(opts.category!);
      const outDir  = opts.out ?? config.output.basePath;
      await mkdir(resolve(outDir, opts.target), { recursive: true });
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
          const filePath = resolve(outDir, opts.target, `${slug}.json`);
          await writeFile(filePath, JSON.stringify(payload, null, 2));
        });
        await pipeline.execute(PipelineState.fromWikiPage(opts.target, page));
      }
      log.info('scrape', `Wrote ${pages.length.toString()} pages to ${resolve(outDir, opts.target)}`);
      return;
    }

    log.error('scrape', `Unknown target: ${opts.target} (not in targets or mediawiki)`);
    process.exit(1);
  });

program
  .command('scrape-html')
  .description('Scrape HTML pages from a configured target')
  .requiredOption('--target <name>', 'Target name from config')
  .requiredOption('--paths <paths...>', 'Paths to scrape (relative to baseUrl)')
  .option('--config <path>', 'Config file path', DEFAULT_CONFIG_PATH)
  .option('--out <dir>', 'Output directory override')
  .action(async (opts: { target: string; paths: string[]; config: string; out?: string }) => {
    const log    = Logger.forComponent('cli');
    const config = await RipperConfig.load(opts.config);
    const target = config.targets?.[opts.target];

    if (target === undefined) {
      log.error('scrape-html', `Unknown target: ${opts.target}`);
      process.exit(1);
    }

    const scraper = new HtmlScraper(target);

    for (const path of opts.paths) {
      const page = await scraper.fetchPage(path);
      log.info('scrape-html', `Fetched ${page.url}`);
    }
  });

program
  .command('scrape-wiki')
  .description('Scrape MediaWiki category pages')
  .requiredOption('--target <name>', 'MediaWiki target name from config')
  .requiredOption('--category <name>', 'Category name to scrape')
  .option('--config <path>', 'Config file path', DEFAULT_CONFIG_PATH)
  .option('--out <dir>', 'Output directory override')
  .action(async (opts: { target: string; category: string; config: string; out?: string }) => {
    const log    = Logger.forComponent('cli');
    const config = await RipperConfig.load(opts.config);
    const mwConf = config.mediawiki?.[opts.target];

    if (mwConf === undefined) {
      log.error('scrape-wiki', `Unknown mediawiki target: ${opts.target}`);
      process.exit(1);
    }

    const scraper = await MediaWikiScraper.create(mwConf);
    const pages   = await scraper.scrapeCategory(opts.category);
    const outDir  = opts.out ?? config.output.basePath;

    await mkdir(resolve(outDir, opts.target), { recursive: true });

    for (const page of pages) {
      const parsed   = WikitextParser.parse(page.title, page.wikitext);
      const slug     = page.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const filePath = resolve(outDir, opts.target, `${slug}.json`);
      await writeFile(filePath, JSON.stringify(parsed, null, 2));
    }

    log.info('scrape-wiki', `Wrote ${pages.length.toString()} pages to ${resolve(outDir, opts.target)}`);
  });

program
  .command('crawl')
  .description('Crawl links matching a pattern and collect target URLs')
  .requiredOption('--starts <urls...>', 'Starting URLs (one or more)')
  .requiredOption('--domain <regex>', 'Domain regex to stay within')
  .requiredOption('--target <regex>', 'Target URL pattern to collect')
  .requiredOption('--delimiter <regex>', 'Traversal pattern (pages to follow)')
  .option('--rate <ms>',   'Rate limit in ms between requests', '200')
  .option('--jitter <ms>', 'Random jitter (0..N ms) added to each request',  '0')
  .option('--max <n>',     'Maximum target URLs to collect (cap)')
  .action(async (opts: { starts: string[]; domain: string; target: string; delimiter: string; rate: string; jitter: string; max?: string }) => {
    const log  = Logger.forComponent('cli');
    const max  = opts.max !== undefined ? parseInt(opts.max, 10) : undefined;
    const list = await new LinkLister({
      domain:      new RegExp(opts.domain),
      target:      new RegExp(opts.target),
      delimiter:   new RegExp(opts.delimiter),
      rateLimitMs: parseInt(opts.rate, 10),
      jitterMs:    parseInt(opts.jitter, 10),
      ...(max !== undefined ? { maxPages: max } : {}),
    }).buildList(opts.starts);

    for (const link of list) log.info('crawl', link);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});

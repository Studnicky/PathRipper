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

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8')) as { version: string };

const DEFAULT_CONFIG_PATH = './ripperoni.config.json';

const program = new Command();

program
  .name('ripperoni')
  .description('Configurable web scraper — HTML, MediaWiki, and link crawler.')
  .version(pkg.version);

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
  .requiredOption('--start <url>', 'Starting URL')
  .requiredOption('--domain <regex>', 'Domain regex to stay within')
  .requiredOption('--target <regex>', 'Target URL pattern to collect')
  .requiredOption('--delimiter <regex>', 'Traversal pattern (pages to follow)')
  .option('--rate <ms>', 'Rate limit in ms between requests', '200')
  .action(async (opts: { start: string; domain: string; target: string; delimiter: string; rate: string }) => {
    const log  = Logger.forComponent('cli');
    const list = await new LinkLister({
      domain:      new RegExp(opts.domain),
      target:      new RegExp(opts.target),
      delimiter:   new RegExp(opts.delimiter),
      rateLimitMs: parseInt(opts.rate, 10),
    }).buildList(opts.start);

    for (const link of list) log.info('crawl', link);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});

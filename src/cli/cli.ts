import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RipperConfig } from '../config/RipperConfig.js';
import { LinkLister } from '../crawlers/LinkLister.js';
import { Logger } from '../modules/logger/Logger.js';
import { ScrapeOrchestrator } from '../orchestrators/ScrapeOrchestrator.js';

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
    const config    = await RipperConfig.load(opts.config);
    const configDir = dirname(resolve(opts.config));
    const outDir    = opts.out ?? config.output.basePath;
    const log       = Logger.forComponent('cli');

    const htmlTarget = config.targets?.[opts.target];
    const wikiTarget = config.mediawiki?.[opts.target];

    if (htmlTarget !== undefined) {
      if (!opts.paths?.length) { log.error('scrape', '--paths required for html targets'); process.exit(1); }
      await ScrapeOrchestrator.scrapeHtml({ target: opts.target, paths: opts.paths!, outDir, configDir, config });
      return;
    }
    if (wikiTarget !== undefined) {
      if (!opts.category) { log.error('scrape', '--category required for mediawiki targets'); process.exit(1); }
      await ScrapeOrchestrator.scrapeWiki({ target: opts.target, category: opts.category!, outDir, configDir, config });
      return;
    }
    log.error('scrape', `Unknown target: ${opts.target}`);
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
    const config    = await RipperConfig.load(opts.config);
    const configDir = dirname(resolve(opts.config));
    const outDir    = opts.out ?? config.output.basePath;
    const log       = Logger.forComponent('cli');

    if (config.targets?.[opts.target] === undefined) {
      log.error('scrape-html', `Unknown target: ${opts.target}`);
      process.exit(1);
    }

    await ScrapeOrchestrator.scrapeHtml({ target: opts.target, paths: opts.paths, outDir, configDir, config });
  });

program
  .command('scrape-wiki')
  .description('Scrape MediaWiki category pages')
  .requiredOption('--target <name>', 'MediaWiki target name from config')
  .requiredOption('--category <name>', 'Category name to scrape')
  .option('--config <path>', 'Config file path', DEFAULT_CONFIG_PATH)
  .option('--out <dir>', 'Output directory override')
  .action(async (opts: { target: string; category: string; config: string; out?: string }) => {
    const config    = await RipperConfig.load(opts.config);
    const configDir = dirname(resolve(opts.config));
    const outDir    = opts.out ?? config.output.basePath;
    const log       = Logger.forComponent('cli');

    if (config.mediawiki?.[opts.target] === undefined) {
      log.error('scrape-wiki', `Unknown mediawiki target: ${opts.target}`);
      process.exit(1);
    }

    await ScrapeOrchestrator.scrapeWiki({ target: opts.target, category: opts.category, outDir, configDir, config });
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

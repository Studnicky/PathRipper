import { Command } from 'commander';
import { readFileSync, existsSync, copyFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

import { Dagonizer }        from '@studnicky/dagonizer';
import { Logger }           from '../modules/logger/logger.js';
import { runDagFromFiles }  from '../run/runDag.js';
import { LinkLister }       from '../crawlers/LinkLister.js';
import { ScraperCache }     from '../modules/cache/ScraperCache.js';
import { CliState }         from '../state/CliState.js';
import {
  LoadConfigNode,
  ResolveTargetNode,
  DispatchHtmlScrapeNode,
  DispatchWikiScrapeNode,
  WriteManifestNode,
  ExitNode,
} from '../nodes/cli/index.js';
import type { CliServices }  from '../nodes/cli/index.js';
import { cliScrapeFlow, CLI_SCRAPE_FLOW } from '../flows/cliScrapeFlow.js';

const CLI_SCRAPE_DAG = CLI_SCRAPE_FLOW;

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')) as { version: string };

const DEFAULT_CONFIG_PATH   = './ripperoni.config.json';
const DEFAULT_RATE_LIMIT_MS = '200';
const DEFAULT_JITTER_MS     = '0';
const DECIMAL_RADIX         = 10;

// ── Module-level dispatcher (registered once at startup) ──────────────────────

const log = Logger.forComponent('cli');

const _holder: { current: CliServices | null } = { current: null };
const _dispatcher = new Dagonizer<CliState, CliServices>({
  services: new Proxy({} as CliServices, {
    get(_target, prop) {
      if (_holder.current === null) {
        throw new Error('CliServices accessed before initialisation');
      }
      return (_holder.current as unknown as Record<string | symbol, unknown>)[prop as string];
    },
  }),
});

_dispatcher.registerNode(LoadConfigNode);
_dispatcher.registerNode(ResolveTargetNode);
_dispatcher.registerNode(DispatchHtmlScrapeNode);
_dispatcher.registerNode(DispatchWikiScrapeNode);
_dispatcher.registerNode(WriteManifestNode);
_dispatcher.registerNode(ExitNode);
_dispatcher.registerDAG(cliScrapeFlow);

/** Initialises the services bag and returns the ready dispatcher. */
const initServices = (): Dagonizer<CliState, CliServices> => {
  _holder.current = { log };
  return _dispatcher;
};

// ── Commander program ─────────────────────────────────────────────────────────

const program = new Command();

program
  .name('ripperoni')
  .description('Configurable web scraper — HTML, MediaWiki, and link crawler.')
  .version(pkg.version);

program
  .command('scrape')
  .description('Scrape a configured target — detects html or mediawiki mode from config')
  .requiredOption('--target <name>', 'Target name from config (checked in targets then mediawiki)')
  .option('--paths <paths...>', 'Paths to scrape (html mode); bounds the scrape — when present, the crawl phase is skipped')
  .option('--category <name>', 'Category to scrape (mediawiki mode)')
  .option('--resume-failures', 'Re-scrape pages listed in the failures.json from the last run')
  .option('--config <path>', 'Config file path', DEFAULT_CONFIG_PATH)
  .option('--out <dir>', 'Output directory override')
  .action(async (opts: { target: string; paths?: string[]; category?: string; resumeFailures?: boolean; config: string; out?: string }): Promise<void> => {
    const dispatcher = initServices();
    const ctrl = new AbortController();
    process.on('SIGINT', () => { ctrl.abort(); });

    const state = new CliState();
    state.command    = 'scrape';
    state.configPath = opts.config;
    state.targetId   = opts.target;
    state.outDir     = opts.out ?? '';
    state.options    = {
      paths:          opts.paths,
      category:       opts.category,
      resumeFailures: opts.resumeFailures,
    };

    await dispatcher.execute(CLI_SCRAPE_DAG, state, { signal: ctrl.signal });
    process.exit(state.exitCode);
  });

program
  .command('scrape-html')
  .description('Scrape HTML pages from a configured target')
  .requiredOption('--target <name>', 'Target name from config')
  .requiredOption('--paths <paths...>', 'Paths to scrape (relative to baseUrl); bounds the scrape — the crawl phase is skipped')
  .option('--config <path>', 'Config file path', DEFAULT_CONFIG_PATH)
  .option('--out <dir>', 'Output directory override')
  .action(async (opts: { target: string; paths: string[]; config: string; out?: string }): Promise<void> => {
    const dispatcher = initServices();
    const ctrl = new AbortController();
    process.on('SIGINT', () => { ctrl.abort(); });

    const state = new CliState();
    state.command    = 'scrape-html';
    state.configPath = opts.config;
    state.targetId   = opts.target;
    state.outDir     = opts.out ?? '';
    state.options    = { paths: opts.paths };

    await dispatcher.execute(CLI_SCRAPE_DAG, state, { signal: ctrl.signal });
    process.exit(state.exitCode);
  });

program
  .command('scrape-wiki')
  .description('Scrape MediaWiki category pages')
  .requiredOption('--target <name>', 'MediaWiki target name from config')
  .option('--category <name>', 'Category to scrape (omit to use config categories or scrape all pages)')
  .option('--resume-failures', 'Re-scrape pages listed in the failures.json from the last run')
  .option('--config <path>', 'Config file path', DEFAULT_CONFIG_PATH)
  .option('--out <dir>', 'Output directory override')
  .action(async (opts: { target: string; category?: string; resumeFailures?: boolean; config: string; out?: string }): Promise<void> => {
    const dispatcher = initServices();
    const ctrl = new AbortController();
    process.on('SIGINT', () => { ctrl.abort(); });

    const state = new CliState();
    state.command    = 'scrape-wiki';
    state.configPath = opts.config;
    state.targetId   = opts.target;
    state.outDir     = opts.out ?? '';
    state.options    = {
      category:       opts.category,
      resumeFailures: opts.resumeFailures,
    };

    await dispatcher.execute(CLI_SCRAPE_DAG, state, { signal: ctrl.signal });
    process.exit(state.exitCode);
  });

program
  .command('crawl')
  .description('Crawl links matching a pattern and collect target URLs')
  .requiredOption('--starts <urls...>', 'Starting URLs (one or more)')
  .requiredOption('--domain <regex>', 'Domain regex to stay within')
  .requiredOption('--target <regex>', 'Target URL pattern to collect')
  .requiredOption('--delimiter <regex>', 'Traversal pattern (pages to follow)')
  .option('--rate <ms>',   'Rate limit in ms between requests', DEFAULT_RATE_LIMIT_MS)
  .option('--jitter <ms>', `Random jitter (0..N ms) added to each request`, DEFAULT_JITTER_MS)
  .option('--max <n>',     'Maximum target URLs to collect (cap)')
  .action(async (opts: { starts: string[]; domain: string; target: string; delimiter: string; rate: string; jitter: string; max?: string }): Promise<void> => {
    const max   = opts.max !== undefined ? parseInt(opts.max, DECIMAL_RADIX) : undefined;
    // Ad-hoc CLI crawl: ephemeral cache in tmp; not shared with any scraper run.
    const cacheDir = mkdtempSync(join(tmpdir(), 'ripperoni-crawl-'));
    const cache    = ScraperCache.create({ dir: cacheDir, mode: 'off' });
    const list = await LinkLister.create({
      domain:      new RegExp(opts.domain),
      target:      new RegExp(opts.target),
      delimiter:   new RegExp(opts.delimiter),
      rateLimitMs: parseInt(opts.rate, DECIMAL_RADIX),
      jitterMs:    parseInt(opts.jitter, DECIMAL_RADIX),
      ...(max !== undefined ? { maxPages: max } : {}),
      cache,
    }).buildList(opts.starts);

    for (const link of list) log.info('crawl', link);
  });

// ── Locate the project root (directory containing package.json) ───────────────
// Used by `scaffold` to resolve the committed example templates.
const PROJECT_ROOT = new URL('../../', import.meta.url).pathname;

program
  .command('run')
  .description('Execute a native DAG bundle — loads <dag>.dag.jsonld + a companion .state.json and dispatches the root DAG')
  .argument('<dag>', 'Path to the .dag.jsonld bundle file')
  .requiredOption('--state <path>', 'Path to the companion .state.json run-state file')
  .option('--out <dir>', 'Output directory override (default: ./output)')
  .action(async (dagArg: string, opts: { state: string; out?: string }): Promise<void> => {
    const dagPath   = resolve(dagArg);
    const statePath = resolve(opts.state);
    // Resolve configDir relative to the dag file's location so that
    // plugin module paths (e.g. ./plugins/MyNode.js) work from there —
    // mirroring how the legacy commands derive configDir from --config.
    const configDir = dirname(dagPath);
    const outDir    = opts.out ?? './output';

    try {
      await runDagFromFiles({ dagPath, statePath, outDir, configDir });
      process.exit(0);
    } catch (err: unknown) {
      process.stderr.write(String(err) + '\n');
      process.exit(1);
    }
  });

program
  .command('scaffold')
  .description('Write a starter <name>.dag.jsonld + <name>.state.json pair from the committed example templates')
  .argument('<name>', 'Base name for the generated pair (e.g. "mywiki" → mywiki.dag.jsonld + mywiki.state.json)')
  .action((nameArg: string): void => {
    const dagDest   = resolve(`${nameArg}.dag.jsonld`);
    const stateDest = resolve(`${nameArg}.state.json`);
    const dagSrc    = join(PROJECT_ROOT, 'ripperoni.example.dag.jsonld');
    const stateSrc  = join(PROJECT_ROOT, 'ripperoni.example.state.json');

    if (existsSync(dagDest)) {
      process.stderr.write(`scaffold: target already exists — ${dagDest}\n`);
      process.exit(1);
    }
    if (existsSync(stateDest)) {
      process.stderr.write(`scaffold: target already exists — ${stateDest}\n`);
      process.exit(1);
    }

    copyFileSync(dagSrc,   dagDest);
    copyFileSync(stateSrc, stateDest);

    process.stdout.write(`scaffold: wrote ${dagDest}\n`);
    process.stdout.write(`scaffold: wrote ${stateDest}\n`);
    process.stdout.write(`Edit the two files, then run: ripperoni run ${nameArg}.dag.jsonld --state ${nameArg}.state.json\n`);
    process.exit(0);
  });

program.parseAsync(process.argv).catch((err: unknown): never => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});

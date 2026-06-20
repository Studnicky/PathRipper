// Integration tests for the CLI scrape DAG.
//
// Verifies:
//   • Full DAG dispatch against a real config file (load → resolve → dispatch → manifest → exit).
//   • exitCode reflects success / partial / failure outcomes.
//   • Routing branches correctly for html and wiki targets.
//
// DispatchHtmlScrapeNode and DispatchWikiScrapeNode are replaced with fake nodes
// that don't make any real network calls — the test verifies routing and exit codes,
// not actual scrape behavior.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Dagonizer, RoutedBatchBuilder, Timeout } from '@studnicky/dagonizer';
import type { NodeInterface, NodeContextType, RoutedBatchType , Batch} from '@studnicky/dagonizer';

import { CliState }        from '../../src/state/CliState.js';
import {
  LoadConfigNode,
  ResolveTargetNode,
  WriteManifestNode,
  ExitNode,
} from '../../src/nodes/cli/index.js';
import type { CliServices }  from '../../src/nodes/cli/index.js';
import { cliScrapeFlow, CLI_SCRAPE_FLOW } from '../../src/flows/cliScrapeFlow.js';
import { Logger }            from '../../src/modules/logger/logger.js';

let tmpDir = '';

const MIXED_CONFIG = JSON.stringify({
  output: { basePath: './output', format: 'json', pretty: true },
  targets: {
    htmlsite: {
      baseUrl:  'https://html.example.com',
      pipeline: ['html:fetch', 'json:write'],
      cache:    { dir: './output/.cache/htmlsite', mode: 'read-write' },
    },
  },
  mediawiki: {
    mywiki: {
      apiUrl:   'https://wiki.example.com/api.php',
      pipeline: ['wiki:fetch', 'json:write'],
      cache:    { dir: './output/.cache/mywiki', mode: 'read-write' },
    },
  },
});

// ── Fake dispatch nodes ────────────────────────────────────────────────────────
// No real scraping — just set failedCount and return success.

let htmlRunCalls = 0;
let wikiRunCalls = 0;
let htmlShouldThrow = false;

const FakeDispatchHtmlScrapeNode: NodeInterface<CliState, 'success' | 'partial' | 'error', CliServices> = {
  name:     'cli:dispatch-html-scrape',
  outputs:  ['success', 'partial', 'error'],
  timeout:  Timeout.none(),
  async execute(
    batch:   Batch<CliState>,
    context: NodeContextType<CliServices>,
  ): Promise<RoutedBatchType<'success' | 'partial' | 'error', CliState>> {
    const state = batch.row(0).state;
    if (state.config === null) {
      state.errorMessage = 'FakeDispatch: config is null';
      return RoutedBatchBuilder.of('error', batch);
    }
    if (state.config.targets?.[state.targetId] === undefined) {
      state.errorMessage = `FakeDispatch: target "${state.targetId}" not found`;
      return RoutedBatchBuilder.of('error', batch);
    }
    htmlRunCalls++;
    if (htmlShouldThrow) {
      state.errorMessage = 'HTML scrape failed: something exploded';
      context.services.log.error('FakeDispatchHtmlScrapeNode', state.errorMessage);
      return RoutedBatchBuilder.of('error', batch);
    }
    state.failedCount = 0;
    return RoutedBatchBuilder.of('success', batch);
  },
};

const FakeDispatchWikiScrapeNode: NodeInterface<CliState, 'success' | 'partial' | 'error', CliServices> = {
  name:     'cli:dispatch-wiki-scrape',
  outputs:  ['success', 'partial', 'error'],
  timeout:  Timeout.none(),
  async execute(
    batch:    Batch<CliState>,
    _context: NodeContextType<CliServices>,
  ): Promise<RoutedBatchType<'success' | 'partial' | 'error', CliState>> {
    const state = batch.row(0).state;
    if (state.config === null) {
      state.errorMessage = 'FakeDispatch: config is null';
      return RoutedBatchBuilder.of('error', batch);
    }
    if (state.config.mediawiki?.[state.targetId] === undefined) {
      state.errorMessage = `FakeDispatch: wiki target "${state.targetId}" not found`;
      return RoutedBatchBuilder.of('error', batch);
    }
    wikiRunCalls++;
    state.failedCount = 0;
    return RoutedBatchBuilder.of('success', batch);
  },
};

// ── Dispatcher builder ─────────────────────────────────────────────────────────

const buildDispatcher = (): Dagonizer<CliState, CliServices> => {
  const holder: { current: CliServices | null } = { current: null };
  const dispatcher = new Dagonizer<CliState, CliServices>({
    services: new Proxy({} as CliServices, {
      get(_target, prop) {
        if (holder.current === null) throw new Error('services accessed before init');
        return (holder.current as unknown as Record<string | symbol, unknown>)[prop as string];
      },
    }),
  });
  holder.current = { log: Logger.forComponent('cliScrapeDAG.test') };

  dispatcher.registerNode(LoadConfigNode);
  dispatcher.registerNode(ResolveTargetNode);
  dispatcher.registerNode(FakeDispatchHtmlScrapeNode);
  dispatcher.registerNode(FakeDispatchWikiScrapeNode);
  dispatcher.registerNode(WriteManifestNode);
  dispatcher.registerNode(ExitNode);
  dispatcher.registerDAG(cliScrapeFlow);

  return dispatcher;
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('cliScrapeDAG integration', () => {
  before(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'ripper-dag-int-')); });
  after(async ()  => { await rm(tmpDir, { recursive: true, force: true }); });

  it('full HTML path: exitCode=0 on clean run completion', async () => {
    const configPath = join(tmpDir, 'html.config.json');
    await writeFile(configPath, MIXED_CONFIG, 'utf-8');

    htmlRunCalls = 0;
    htmlShouldThrow = false;

    const dispatcher = buildDispatcher();
    const state = new CliState();
    state.command    = 'scrape';
    state.configPath = configPath;
    state.targetId   = 'htmlsite';
    state.outDir     = '';
    state.options    = { paths: ['/page1'] };

    await dispatcher.execute(CLI_SCRAPE_FLOW, state);

    assert.equal(state.exitCode, 0, `Expected exitCode=0 but got ${state.exitCode.toString()} (${state.errorMessage})`);
    assert.equal(htmlRunCalls, 1);
  });

  it('full wiki path: exitCode=0 on clean run completion', async () => {
    const configPath = join(tmpDir, 'wiki.config.json');
    await writeFile(configPath, MIXED_CONFIG, 'utf-8');

    wikiRunCalls = 0;

    const dispatcher = buildDispatcher();
    const state = new CliState();
    state.command    = 'scrape';
    state.configPath = configPath;
    state.targetId   = 'mywiki';
    state.outDir     = '';
    state.options    = {};

    await dispatcher.execute(CLI_SCRAPE_FLOW, state);

    assert.equal(state.exitCode, 0, `Expected exitCode=0 but got ${state.exitCode.toString()} (${state.errorMessage})`);
    assert.equal(wikiRunCalls, 1);
  });

  it('config load failure: exitCode=1 without calling run functions', async () => {
    htmlRunCalls = 0;
    wikiRunCalls = 0;

    const dispatcher = buildDispatcher();
    const state = new CliState();
    state.command    = 'scrape';
    state.configPath = join(tmpDir, 'does-not-exist.json');
    state.targetId   = 'htmlsite';
    state.outDir     = '';
    state.options    = { paths: ['/page1'] };

    await dispatcher.execute(CLI_SCRAPE_FLOW, state);

    assert.equal(state.exitCode, 1);
    assert.equal(htmlRunCalls, 0);
    assert.equal(wikiRunCalls, 0);
  });

  it('unknown target: exitCode=1 without calling run functions', async () => {
    const configPath = join(tmpDir, 'unk.config.json');
    await writeFile(configPath, MIXED_CONFIG, 'utf-8');

    htmlRunCalls = 0;
    wikiRunCalls = 0;

    const dispatcher = buildDispatcher();
    const state = new CliState();
    state.command    = 'scrape';
    state.configPath = configPath;
    state.targetId   = 'ghost-target';
    state.outDir     = '';
    state.options    = {};

    await dispatcher.execute(CLI_SCRAPE_FLOW, state);

    assert.equal(state.exitCode, 1);
    assert.equal(htmlRunCalls, 0);
    assert.equal(wikiRunCalls, 0);
  });

  it('run error: exitCode=1', async () => {
    const configPath = join(tmpDir, 'err.config.json');
    await writeFile(configPath, MIXED_CONFIG, 'utf-8');

    htmlRunCalls = 0;
    htmlShouldThrow = true;

    const dispatcher = buildDispatcher();
    const state = new CliState();
    state.command    = 'scrape-html';
    state.configPath = configPath;
    state.targetId   = 'htmlsite';
    state.outDir     = '';
    state.options    = { paths: ['/page1'] };

    await dispatcher.execute(CLI_SCRAPE_FLOW, state);

    assert.equal(state.exitCode, 1);
    assert.ok(state.errorMessage.includes('something exploded'));

    htmlShouldThrow = false;
  });

  it('outDir falls back to config.output.basePath when not specified', async () => {
    const configPath = join(tmpDir, 'outdir.config.json');
    await writeFile(configPath, MIXED_CONFIG, 'utf-8');

    let capturedOutDir: string | undefined;
    const capturingNode: NodeInterface<CliState, 'success' | 'partial' | 'error', CliServices> = {
      name:     'cli:dispatch-html-scrape',
      outputs:  ['success', 'partial', 'error'],
      timeout:  Timeout.none(),
      async execute(batch: Batch<CliState>): Promise<RoutedBatchType<'success' | 'partial' | 'error', CliState>> {
        const state = batch.row(0).state;
        capturedOutDir = state.outDir;
        state.failedCount = 0;
        return RoutedBatchBuilder.of('success', batch);
      },
    };

    const holder: { current: CliServices | null } = { current: null };
    const dispatcher2 = new Dagonizer<CliState, CliServices>({
      services: new Proxy({} as CliServices, {
        get(_target, prop) {
          if (holder.current === null) throw new Error('services accessed before init');
          return (holder.current as unknown as Record<string | symbol, unknown>)[prop as string];
        },
      }),
    });
    holder.current = { log: Logger.forComponent('cliScrapeDAG.test') };
    dispatcher2.registerNode(LoadConfigNode);
    dispatcher2.registerNode(ResolveTargetNode);
    dispatcher2.registerNode(capturingNode);
    dispatcher2.registerNode(FakeDispatchWikiScrapeNode);
    dispatcher2.registerNode(WriteManifestNode);
    dispatcher2.registerNode(ExitNode);
    dispatcher2.registerDAG(cliScrapeFlow);

    const state = new CliState();
    state.command    = 'scrape-html';
    state.configPath = configPath;
    state.targetId   = 'htmlsite';
    state.outDir     = '';
    state.options    = { paths: ['/'] };

    await dispatcher2.execute(CLI_SCRAPE_FLOW, state);

    assert.equal(capturedOutDir, './output');
  });
});

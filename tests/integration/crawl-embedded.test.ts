/**
 * Integration test: embedded crawl DAG → scatter over discovered URLs.
 *
 * Verifies the native embedded-DAG crawl model end-to-end without real
 * network I/O:
 *   (a) The `crawl:discover` embedded DAG populates `state.urls` after
 *       the output mapping copies `crawl.discovered` → `urls`.
 *   (b) The scatter over `urls` runs a stub page body per discovered URL.
 *
 * The test uses a STUBBED global `fetch` returning canned HTML with a
 * couple of links matching the crawl regexes. No real network calls occur.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync }  from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { DAGDocument, Timeout, Batch } from '@studnicky/dagonizer';
import { RipperDagonizer }             from '../../src/dispatcher/RipperDagonizer.js';
import { ScrapeState }         from '../../src/state/ScrapeState.js';
import { PluginLoader }        from '../../src/run/PluginLoader.js';
import { RateLimiter }         from '../../src/modules/http/rateLimiter.js';
import { HttpRetryPolicy }     from '../../src/modules/http/httpRetryPolicy.js';
import { Logger }              from '../../src/modules/logger/logger.js';
import type { RipperServices } from '../../src/services/RipperServices.js';
import type { DagonizerInterface } from '@studnicky/dagonizer';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Fixture paths ──────────────────────────────────────────────────────────────

const CRAWL_DISCOVER_DAG_PATH = resolve(
  __dirname, '../../tests/e2e/fixtures/crawl-discover.dag.jsonld',
);
const AONPRD_CRAWL_DAG_PATH = resolve(
  __dirname, '../../tests/e2e/fixtures/aonprd-crawl.dag.jsonld',
);

// ── Canned HTML fixtures ───────────────────────────────────────────────────────

// Index page: links two category pages that match `delimiterRe` (category)
const INDEX_HTML = `
<html><body>
  <a href="https://example.test/category/a">Category A</a>
  <a href="https://example.test/category/b">Category B</a>
  <a href="https://other.test/offsite">offsite — ignored</a>
</body></html>`;

// Category pages: each links to target pages that match `targetRe` (?id=)
const CATEGORY_A_HTML = `
<html><body>
  <a href="https://example.test/Items.aspx?id=1">Item 1</a>
  <a href="https://example.test/Items.aspx?id=2">Item 2</a>
</body></html>`;

const CATEGORY_B_HTML = `
<html><body>
  <a href="https://example.test/Items.aspx?id=3">Item 3</a>
  <a href="https://example.test/Items.aspx?id=1">Item 1 (dup)</a>
</body></html>`;

const TARGET_HTML = `<html><body><h1>Item page</h1></body></html>`;

const PAGES: Record<string, string> = {
  'https://example.test/index':       INDEX_HTML,
  'https://example.test/category/a':  CATEGORY_A_HTML,
  'https://example.test/category/b':  CATEGORY_B_HTML,
  'https://example.test/Items.aspx?id=1': TARGET_HTML,
  'https://example.test/Items.aspx?id=2': TARGET_HTML,
  'https://example.test/Items.aspx?id=3': TARGET_HTML,
};

// ── DAG JSON-LD context (shared) ──────────────────────────────────────────────

const DAG_CONTEXT = {
  '@version': 1.1,
  'name':          { '@id': 'https://noocodex.dev/ontology/dag/name' },
  'version':       { '@id': 'https://noocodex.dev/ontology/dag/version' },
  'entrypoint':    { '@id': 'https://noocodex.dev/ontology/dag/entrypoint' },
  'nodes':         { '@id': 'https://noocodex.dev/ontology/dag/nodes', '@container': '@set' },
  'outputs':       { '@id': 'https://noocodex.dev/ontology/dag/outputs' },
  'node':          { '@id': 'https://noocodex.dev/ontology/dag/node' },
  'dag':           { '@id': 'https://noocodex.dev/ontology/dag/dag' },
  'body':          { '@id': 'https://noocodex.dev/ontology/dag/body' },
  'source':        { '@id': 'https://noocodex.dev/ontology/dag/source' },
  'itemKey':       { '@id': 'https://noocodex.dev/ontology/dag/itemKey' },
  'concurrency':   { '@id': 'https://noocodex.dev/ontology/dag/concurrency' },
  'gather':        { '@id': 'https://noocodex.dev/ontology/dag/gather' },
  'reducer':       { '@id': 'https://noocodex.dev/ontology/dag/reducer' },
  'outcome':       { '@id': 'https://noocodex.dev/ontology/dag/outcome' },
  'phase':         { '@id': 'https://noocodex.dev/ontology/dag/phase' },
  'stateMapping':  { '@id': 'https://noocodex.dev/ontology/dag/stateMapping' },
  'container':     { '@id': 'https://noocodex.dev/ontology/dag/container' },
  'DAG':           { '@id': 'https://noocodex.dev/ontology/dag/DAG' },
  'Placement':     { '@id': 'https://noocodex.dev/ontology/dag/Placement' },
  'SingleNode':    { '@id': 'https://noocodex.dev/ontology/dag/SingleNode' },
  'ScatterNode':   { '@id': 'https://noocodex.dev/ontology/dag/ScatterNode' },
  'EmbeddedDAGNode': { '@id': 'https://noocodex.dev/ontology/dag/EmbeddedDAGNode' },
  'TerminalNode':  { '@id': 'https://noocodex.dev/ontology/dag/TerminalNode' },
  'PhaseNode':     { '@id': 'https://noocodex.dev/ontology/dag/PhaseNode' },
} as const;

// ── Stub per-item DAG ──────────────────────────────────────────────────────────

/**
 * Minimal per-URL page DAG: just records the URL in `state.succeeded` and
 * terminates with `success`. No network call needed — we only need to verify
 * the scatter ran once per discovered URL.
 */
const STUB_PAGE_DAG = JSON.stringify({
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:stub:item-page',
  '@type':     'DAG',
  'name':       'stub:item-page',
  'version':   '1.0',
  'entrypoint': 'stub:record',
  'nodes': [
    {
      '@id':    'urn:noocodex:dag:stub:item-page/node/stub:record',
      '@type':  'SingleNode',
      'name':    'stub:record',
      'node':    'stub:record',
      'outputs': { 'success': 'stub-item:done' },
    },
    {
      '@id':     'urn:noocodex:dag:stub:item-page/node/stub-item:done',
      '@type':   'TerminalNode',
      'name':     'stub-item:done',
      'outcome':  'completed',
    },
  ],
});

/**
 * Orchestration DAG: embedded `crawl:discover` → scatter over `urls` using
 * `stub:item-page` as the body.
 *
 * The `stateMapping.output` copies `crawl.discovered` (child) → `urls` (parent)
 * after the embedded crawl completes. The scatter then iterates `urls`.
 */
const STUB_ORCH_DAG = JSON.stringify({
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:stub:crawl-orch',
  '@type':     'DAG',
  'name':       'stub:crawl-orch',
  'version':   '1.0',
  'entrypoint': 'discover',
  'nodes': [
    {
      '@id':    'urn:noocodex:dag:stub:crawl-orch/node/discover',
      '@type':  'EmbeddedDAGNode',
      'name':    'discover',
      'dag':     'crawl:discover',
      'stateMapping': {
        'output': { 'urls': 'crawl.discovered' },
      },
      'outputs': {
        'success': 'scrape',
        'error':   'crawl-failed',
      },
    },
    {
      '@id':    'urn:noocodex:dag:stub:crawl-orch/node/scrape',
      '@type':  'ScatterNode',
      'name':    'scrape',
      'source':  'urls',
      'body':    { 'dag': 'stub:item-page' },
      'itemKey': 'currentUrl',
      'gather': {
        'strategy':   'partition',
        'partitions': { 'success': 'succeeded', 'error': 'failed' },
      },
      'reducer': 'aggregate',
      'outputs': {
        'all-success': 'done',
        'partial':     'done',
        'all-error':   'done',
        'empty':       'done',
      },
    },
    {
      '@id':    'urn:noocodex:dag:stub:crawl-orch/node/done',
      '@type':  'TerminalNode',
      'name':    'done',
      'outcome': 'completed',
    },
    {
      '@id':    'urn:noocodex:dag:stub:crawl-orch/node/crawl-failed',
      '@type':  'TerminalNode',
      'name':    'crawl-failed',
      'outcome': 'failed',
    },
  ],
});

// ── Test suite ────────────────────────────────────────────────────────────────

describe('crawl-embedded integration', () => {
  let outDir: string;
  const realFetch = globalThis.fetch;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'ripperoni-crawl-embedded-'));

    // Stub global fetch — returns canned HTML per URL, 404 for unknown.
    globalThis.fetch = (async (input: Request | URL | string): Promise<Response> => {
      const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url);
      const body = PAGES[url];
      if (body === undefined) return new Response('Not Found', { status: 404 });
      return new Response(body, {
        status:  200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }) as typeof fetch;
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    await rm(outDir, { recursive: true, force: true });
  });

  it('crawl-discover.dag.jsonld and aonprd-crawl.dag.jsonld round-trip through DAGDocument.load', () => {
    const crawlDiscoverJson = readFileSync(CRAWL_DISCOVER_DAG_PATH, 'utf-8');
    const crawlDiscover     = DAGDocument.load(crawlDiscoverJson);
    assert.equal(crawlDiscover.name, 'crawl:discover');
    assert.equal(crawlDiscover.nodes.length, 5);
    // Re-serialize and reload to verify full round-trip
    const reloaded = DAGDocument.load(DAGDocument.serialize(crawlDiscover));
    assert.equal(reloaded.name, 'crawl:discover');

    const aonprdCrawlJson = readFileSync(AONPRD_CRAWL_DAG_PATH, 'utf-8');
    const aonprdCrawl     = DAGDocument.load(aonprdCrawlJson);
    assert.equal(aonprdCrawl.name, 'aonprd:crawl');
    assert.equal(aonprdCrawl.nodes.length, 4);
    const reloadedAonprd  = DAGDocument.load(DAGDocument.serialize(aonprdCrawl));
    assert.equal(reloadedAonprd.name, 'aonprd:crawl');
  });

  it('embedded crawl discovers URLs and scatter runs stub:record per URL', async () => {
    // ── Build services ──────────────────────────────────────────────────────
    const crawlLimiter = RateLimiter.create({ minTimeMs: 0 });
    const crawlPolicy  = HttpRetryPolicy.create({ maxAttempts: 1 });

    const holder: { current: RipperServices | null } = { current: null };
    const dispatcher = new RipperDagonizer<ScrapeState>({
      services: new Proxy({} as RipperServices, {
        get(_target, prop) {
          if (holder.current === null) {
            throw new Error('RipperServices accessed before initialisation');
          }
          return (holder.current as unknown as Record<string | symbol, unknown>)[prop as string];
        },
      }),
    });

    // Track which URLs the stub node was called for
    const processedUrls: string[] = [];

    // Stub node: records currentUrl in processedUrls, routes 'success'.
    const stubRecordNode = {
      name:    'stub:record',
      outputs: ['success'] as ['success'],
      timeout: Timeout.none(),
      async execute(batch: Batch<ScrapeState>) {
        for (const { state } of batch) {
          processedUrls.push(state.page.url);
        }
        const { RoutedBatchBuilder } = await import('@studnicky/dagonizer');
        return RoutedBatchBuilder.of('success', batch);
      },
    };

    const services: RipperServices = {
      log:          Logger.forComponent('crawl-embedded-test'),
      cache:        null,
      target:       { id: 'stub:crawl-orch' },
      outDir,
      crawler: {
        startUrls: ['https://example.test/index'],
        domain:    'example\\.test',
        target:    '\\?id=',
        delimiter: 'category|Items',
      },
      crawlLimiter,
      crawlPolicy,
      dispatcher: dispatcher as unknown as DagonizerInterface<ScrapeState, RipperServices>,
    };
    holder.current = services;

    // ── Register nodes + DAGs ───────────────────────────────────────────────
    PluginLoader.registerBuiltinNodes(dispatcher);
    dispatcher.registerNode(stubRecordNode);
    dispatcher.registerDAG(DAGDocument.load(STUB_PAGE_DAG));
    const orchDag = DAGDocument.load(STUB_ORCH_DAG);
    dispatcher.registerDAG(orchDag);

    // ── Seed state and dispatch ─────────────────────────────────────────────
    const state = new ScrapeState();
    await dispatcher.execute(orchDag.name, state);

    // ── Assertions ──────────────────────────────────────────────────────────

    // (a) The embedded crawl populated state.urls after stateMapping.output copy.
    // The 3 unique target URLs (?id=1, ?id=2, ?id=3) should have been discovered.
    assert.ok(
      state.urls.length >= 2,
      `Expected ≥2 discovered URLs in state.urls, got ${state.urls.length.toString()}: ${JSON.stringify(state.urls)}`,
    );
    for (const url of state.urls) {
      assert.match(url, /\?id=/, `URL should match target regex: ${url}`);
    }
    // No duplicate entries
    const uniqueUrls = new Set(state.urls);
    assert.equal(uniqueUrls.size, state.urls.length, 'state.urls must be deduplicated');

    // (b) The scatter ran stub:record once per discovered URL.
    assert.equal(
      processedUrls.length,
      state.urls.length,
      `Expected stub:record to run ${state.urls.length.toString()} times (once per discovered URL), `
        + `ran ${processedUrls.length.toString()} times`,
    );

    // Verify succeeded list was populated by the scatter's partition strategy
    assert.equal(
      state.succeeded.length,
      state.urls.length,
      `Expected ${state.urls.length.toString()} succeeded items, got ${state.succeeded.length.toString()}`,
    );
  });

  it('crawl with maxPages=2 limits discovered URLs to 2', async () => {
    const crawlLimiter = RateLimiter.create({ minTimeMs: 0 });
    const crawlPolicy  = HttpRetryPolicy.create({ maxAttempts: 1 });

    const holder: { current: RipperServices | null } = { current: null };
    const dispatcher = new RipperDagonizer<ScrapeState>({
      services: new Proxy({} as RipperServices, {
        get(_target, prop) {
          if (holder.current === null) {
            throw new Error('RipperServices accessed before initialisation');
          }
          return (holder.current as unknown as Record<string | symbol, unknown>)[prop as string];
        },
      }),
    });

    const stubRecordNode = {
      name:    'stub:record',
      outputs: ['success'] as ['success'],
      timeout: Timeout.none(),
      async execute(batch: Batch<ScrapeState>) {
        const { RoutedBatchBuilder } = await import('@studnicky/dagonizer');
        return RoutedBatchBuilder.of('success', batch);
      },
    };

    const services: RipperServices = {
      log:    Logger.forComponent('crawl-embedded-test-maxpages'),
      cache:  null,
      target: { id: 'stub:crawl-orch' },
      outDir,
      crawler: {
        startUrls: ['https://example.test/index'],
        domain:    'example\\.test',
        target:    '\\?id=',
        delimiter: 'category|Items',
        maxPages:  2,
      },
      crawlLimiter,
      crawlPolicy,
      dispatcher: dispatcher as unknown as DagonizerInterface<ScrapeState, RipperServices>,
    };
    holder.current = services;

    PluginLoader.registerBuiltinNodes(dispatcher);
    dispatcher.registerNode(stubRecordNode);
    dispatcher.registerDAG(DAGDocument.load(STUB_PAGE_DAG));
    const orchDag = DAGDocument.load(STUB_ORCH_DAG);
    dispatcher.registerDAG(orchDag);

    const state = new ScrapeState();
    await dispatcher.execute(orchDag.name, state);

    assert.ok(
      state.urls.length <= 2,
      `Expected ≤2 URLs with maxPages=2, got ${state.urls.length.toString()}`,
    );
  });
});

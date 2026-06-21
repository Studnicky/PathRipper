// Integration test: fixture-based scrape with the new folder-split output layout.
//
// Raw content (html) goes to <outDir>/<target>/raw/<slug>.html
// Plugin JSON goes to <outDir>/<target>/<pluginTaskName>/<slug>.json  (no _raw embed)
//
// Uses a fake fetch to serve a known HTML fixture and the full
// runDag + built-in nodes pipeline.  No network calls.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, readdir, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DAGDocument } from '@studnicky/dagonizer';
import { runDag }      from '../../src/run/runDag.js';
import type { RunStateType } from '../../src/types/RunState.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load a real AONPRD fixture HTML so the content is non-trivial.
const FIXTURE_HTML_PATH = resolve(__dirname, '../e2e/plugins/fixtures/aonprd/condition-blinded.html');

// ── JSON-LD context (shared by all orchestration + per-page DAGs) ──────────────

const DAG_CONTEXT = {
  '@version': 1.1,
  'name':       { '@id': 'https://noocodex.dev/ontology/dag/name' },
  'version':    { '@id': 'https://noocodex.dev/ontology/dag/version' },
  'entrypoint': { '@id': 'https://noocodex.dev/ontology/dag/entrypoint' },
  'nodes':      { '@id': 'https://noocodex.dev/ontology/dag/nodes', '@container': '@set' },
  'outputs':    { '@id': 'https://noocodex.dev/ontology/dag/outputs' },
  'node':       { '@id': 'https://noocodex.dev/ontology/dag/node' },
  'dag':        { '@id': 'https://noocodex.dev/ontology/dag/dag' },
  'body':       { '@id': 'https://noocodex.dev/ontology/dag/body' },
  'source':     { '@id': 'https://noocodex.dev/ontology/dag/source' },
  'itemKey':    { '@id': 'https://noocodex.dev/ontology/dag/itemKey' },
  'concurrency':{ '@id': 'https://noocodex.dev/ontology/dag/concurrency' },
  'gather':     { '@id': 'https://noocodex.dev/ontology/dag/gather' },
  'reducer':    { '@id': 'https://noocodex.dev/ontology/dag/reducer' },
  'outcome':    { '@id': 'https://noocodex.dev/ontology/dag/outcome' },
  'phase':      { '@id': 'https://noocodex.dev/ontology/dag/phase' },
  'stateMapping':{ '@id': 'https://noocodex.dev/ontology/dag/stateMapping' },
  'container':  { '@id': 'https://noocodex.dev/ontology/dag/container' },
  'DAG':            { '@id': 'https://noocodex.dev/ontology/dag/DAG' },
  'Placement':      { '@id': 'https://noocodex.dev/ontology/dag/Placement' },
  'SingleNode':     { '@id': 'https://noocodex.dev/ontology/dag/SingleNode' },
  'ScatterNode':    { '@id': 'https://noocodex.dev/ontology/dag/ScatterNode' },
  'EmbeddedDAGNode':{ '@id': 'https://noocodex.dev/ontology/dag/EmbeddedDAGNode' },
  'TerminalNode':   { '@id': 'https://noocodex.dev/ontology/dag/TerminalNode' },
  'PhaseNode':      { '@id': 'https://noocodex.dev/ontology/dag/PhaseNode' },
} as const;

// ── OrchDag — inline orchestration entry DAG builder ─────────────────────────

/**
 * Builds a serialised JSON-LD orchestration entry DAG that scatters `urls` over
 * the given per-page DAG name.  Loaded via `DAGDocument.load(OrchDag.forScenario(...))`.
 */
class OrchDag {
  static forScenario(name: string, pageDagName: string): string {
    return JSON.stringify({
      '@context':  DAG_CONTEXT,
      '@id':       `urn:noocodex:dag:${name}`,
      '@type':     'DAG',
      'name':       name,
      'version':   '1.0',
      'entrypoint': 'scrape-urls',
      'nodes': [
        {
          '@id':       `urn:noocodex:dag:${name}/node/scrape-urls`,
          '@type':     'ScatterNode',
          'name':       'scrape-urls',
          'source':     'urls',
          'body':       { 'dag': pageDagName },
          'gather': {
            'strategy':   'partition',
            'partitions': { 'success': 'succeeded', 'error': 'failed' },
          },
          'outputs': {
            'all-success': 'done',
            'partial':     'done',
            'all-error':   'done',
            'empty':       'done',
          },
          'itemKey': 'currentUrl',
          'reducer': 'aggregate',
        },
        {
          '@id':     `urn:noocodex:dag:${name}/node/done`,
          '@type':   'TerminalNode',
          'name':     'done',
          'outcome':  'completed',
        },
      ],
    });
  }

  /**
   * Builds a two-scatter orchestration: a `scrape` scatter over `urls` whose
   * failed items partition into `failed`, then a `retry` scatter over `failed`
   * whose failures partition into `failedAfterRetry` (which `runDag` writes to
   * `failures.json`).  Both scatters reference the same per-page DAG.
   */
  static scrapeRetry(name: string, pageDagName: string): string {
    return JSON.stringify({
      '@context':  DAG_CONTEXT,
      '@id':       `urn:noocodex:dag:${name}`,
      '@type':     'DAG',
      'name':       name,
      'version':   '1.0',
      'entrypoint': 'scrape',
      'nodes': [
        {
          '@id':       `urn:noocodex:dag:${name}/node/scrape`,
          '@type':     'ScatterNode',
          'name':       'scrape',
          'source':     'urls',
          'body':       { 'dag': pageDagName },
          'gather': {
            'strategy':   'partition',
            'partitions': { 'success': 'succeeded', 'error': 'failed' },
          },
          'outputs': {
            'all-success': 'retry',
            'partial':     'retry',
            'all-error':   'retry',
            'empty':       'retry',
          },
          'itemKey': 'currentUrl',
          'reducer': 'aggregate',
        },
        {
          '@id':       `urn:noocodex:dag:${name}/node/retry`,
          '@type':     'ScatterNode',
          'name':       'retry',
          'source':     'failed',
          'body':       { 'dag': pageDagName },
          'gather': {
            'strategy':   'partition',
            'partitions': { 'success': 'recovered', 'error': 'failedAfterRetry' },
          },
          'outputs': {
            'all-success': 'done',
            'partial':     'done',
            'all-error':   'done',
            'empty':       'done',
          },
          'itemKey': 'currentUrl',
          'reducer': 'aggregate',
        },
        {
          '@id':     `urn:noocodex:dag:${name}/node/done`,
          '@type':   'TerminalNode',
          'name':     'done',
          'outcome':  'completed',
        },
      ],
    });
  }
}

// ── Stub plugin per-page DAG JSON-LD content ──────────────────────────────────

/**
 * Per-page DAG: html:fetch → stub:parse → json:write
 * pluginTaskName = 'stub:parse' → JSON at <outDir>/<orchName>/stub:parse/<slug>.json
 */
const PARSE_PAGE_DAG = JSON.stringify({
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:stub:parse-page',
  '@type':     'DAG',
  'name':       'stub:parse-page',
  'version':   '1.0',
  'entrypoint': 'html:fetch',
  'nodes': [
    {
      '@id':    'urn:noocodex:dag:stub:parse-page/node/html:fetch',
      '@type':  'SingleNode',
      'name':    'html:fetch',
      'node':    'html:fetch',
      'outputs': { 'success': 'stub:parse', 'cached': 'stub:parse', 'error': 'stub-page:failed' },
    },
    {
      '@id':    'urn:noocodex:dag:stub:parse-page/node/stub:parse',
      '@type':  'SingleNode',
      'name':    'stub:parse',
      'node':    'stub:parse',
      'outputs': { 'success': 'json:write', 'error': 'stub-page:failed' },
    },
    {
      '@id':    'urn:noocodex:dag:stub:parse-page/node/json:write',
      '@type':  'SingleNode',
      'name':    'json:write',
      'node':    'json:write',
      'outputs': { 'success': 'stub-page:completed', 'skipped': 'stub-page:completed' },
    },
    {
      '@id':    'urn:noocodex:dag:stub:parse-page/node/stub-page:completed',
      '@type':  'TerminalNode',
      'name':    'stub-page:completed',
      'outcome': 'completed',
    },
    {
      '@id':    'urn:noocodex:dag:stub:parse-page/node/stub-page:failed',
      '@type':  'TerminalNode',
      'name':    'stub-page:failed',
      'outcome': 'failed',
    },
  ],
});

/**
 * Per-page DAG: html:fetch → html:write-raw → stub:parse → json:write
 * Produces both raw HTML and plugin JSON.
 */
const RAW_PAGE_DAG = JSON.stringify({
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:stub:raw-page',
  '@type':     'DAG',
  'name':       'stub:raw-page',
  'version':   '1.0',
  'entrypoint': 'html:fetch',
  'nodes': [
    {
      '@id':    'urn:noocodex:dag:stub:raw-page/node/html:fetch',
      '@type':  'SingleNode',
      'name':    'html:fetch',
      'node':    'html:fetch',
      'outputs': { 'success': 'html:write-raw', 'cached': 'html:write-raw', 'error': 'stub-raw-page:failed' },
    },
    {
      '@id':    'urn:noocodex:dag:stub:raw-page/node/html:write-raw',
      '@type':  'SingleNode',
      'name':    'html:write-raw',
      'node':    'html:write-raw',
      'outputs': { 'success': 'stub:parse', 'error': 'stub-raw-page:failed' },
    },
    {
      '@id':    'urn:noocodex:dag:stub:raw-page/node/stub:parse',
      '@type':  'SingleNode',
      'name':    'stub:parse',
      'node':    'stub:parse',
      'outputs': { 'success': 'json:write', 'error': 'stub-raw-page:failed' },
    },
    {
      '@id':    'urn:noocodex:dag:stub:raw-page/node/json:write',
      '@type':  'SingleNode',
      'name':    'json:write',
      'node':    'json:write',
      'outputs': { 'success': 'stub-raw-page:completed', 'skipped': 'stub-raw-page:completed' },
    },
    {
      '@id':    'urn:noocodex:dag:stub:raw-page/node/stub-raw-page:completed',
      '@type':  'TerminalNode',
      'name':    'stub-raw-page:completed',
      'outcome': 'completed',
    },
    {
      '@id':    'urn:noocodex:dag:stub:raw-page/node/stub-raw-page:failed',
      '@type':  'TerminalNode',
      'name':    'stub-raw-page:failed',
      'outcome': 'failed',
    },
  ],
});

/**
 * Per-page DAG: html:fetch → html:write-raw only (no plugin parse step).
 */
const RAW_ONLY_PAGE_DAG = JSON.stringify({
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:stub:raw-only-page',
  '@type':     'DAG',
  'name':       'stub:raw-only-page',
  'version':   '1.0',
  'entrypoint': 'html:fetch',
  'nodes': [
    {
      '@id':    'urn:noocodex:dag:stub:raw-only-page/node/html:fetch',
      '@type':  'SingleNode',
      'name':    'html:fetch',
      'node':    'html:fetch',
      'outputs': { 'success': 'html:write-raw', 'cached': 'html:write-raw', 'error': 'stub-raw-only-page:failed' },
    },
    {
      '@id':    'urn:noocodex:dag:stub:raw-only-page/node/html:write-raw',
      '@type':  'SingleNode',
      'name':    'html:write-raw',
      'node':    'html:write-raw',
      'outputs': { 'success': 'stub-raw-only-page:completed', 'error': 'stub-raw-only-page:failed' },
    },
    {
      '@id':    'urn:noocodex:dag:stub:raw-only-page/node/stub-raw-only-page:completed',
      '@type':  'TerminalNode',
      'name':    'stub-raw-only-page:completed',
      'outcome': 'completed',
    },
    {
      '@id':    'urn:noocodex:dag:stub:raw-only-page/node/stub-raw-only-page:failed',
      '@type':  'TerminalNode',
      'name':    'stub-raw-only-page:failed',
      'outcome': 'failed',
    },
  ],
});

// ── Test suite ────────────────────────────────────────────────────────────────

describe('rawContent integration (folder-split layout)', () => {
  let outDir:      string;
  let pluginDir:   string;
  let fixtureHtml: string;
  const realFetch = globalThis.fetch;

  beforeEach(async () => {
    outDir      = await mkdtemp(join(tmpdir(), 'ripperoni-raw-content-'));
    fixtureHtml = readFileSync(FIXTURE_HTML_PATH, 'utf8');

    // Write the stub plugin into <outDir>/plugins/stub/ so configDir = outDir resolves it.
    pluginDir = join(outDir, 'plugins', 'stub');
    await mkdir(pluginDir, { recursive: true });

    const dagonzerIndexPath = resolve(
      __dirname, '..', '..', 'node_modules', '@studnicky', 'dagonizer', 'dist', 'index.js',
    );

    // index.js — exports register(dispatcher) that registers stub:parse node.
    await writeFile(join(pluginDir, 'index.js'), `
import { RoutedBatchBuilder, Timeout } from ${JSON.stringify(`file://${dagonzerIndexPath}`)};

const stubParseNode = {
  name:    'stub:parse',
  outputs: ['success'],
  timeout: Timeout.none(),
  async execute(batch) {
    for (const { state } of batch) {
      state.output = { name: 'fixture-page' };
    }
    return RoutedBatchBuilder.of('success', batch);
  },
};

export function register(dispatcher) {
  dispatcher.registerNode(stubParseNode);
}
`);

    // Per-page DAG files — all three variants written so any scenario can reference them.
    await writeFile(join(pluginDir, 'parse-page.dag.jsonld'), PARSE_PAGE_DAG);
    await writeFile(join(pluginDir, 'raw-page.dag.jsonld'),   RAW_PAGE_DAG);
    await writeFile(join(pluginDir, 'raw-only-page.dag.jsonld'), RAW_ONLY_PAGE_DAG);

    // Intercept all HTTP requests and return the fixture HTML.
    globalThis.fetch = (async (): Promise<Response> =>
      new Response(fixtureHtml, {
        status:  200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    ) as typeof fetch;
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    await rm(outDir, { recursive: true, force: true });
  });

  it('plugin pipeline writes JSON to <target>/ and does NOT embed _raw', async () => {
    // Entry DAG name 'raw-default' scatters over stub:parse-page.
    // pluginTaskName is derived only from the bundle's placements — the entry
    // DAG uses ScatterNode.body.dag (not SingleNode.node), so pluginTaskName
    // is undefined. JSON lands directly at <outDir>/raw-default/<slug>.json.
    const entryDag = DAGDocument.load(OrchDag.forScenario('raw-default', 'stub:parse-page'));
    const state = {
      output:  { basePath: outDir },
      baseUrl: 'https://fixture.test',
      urls:    ['https://fixture.test/condition-blinded'],
    } satisfies RunStateType;

    await runDag({ dags: [entryDag], state, outDir, configDir: outDir });

    const targetDir = join(outDir, 'raw-default');
    const files = (await readdir(targetDir)).filter((file) => file.endsWith('.json') && file !== 'failures.json');
    assert.ok(files.length === 1, `expected 1 plugin JSON file, got ${files.length.toString()}`);

    const parsed = JSON.parse(
      await readFile(join(targetDir, files[0]!), 'utf8'),
    ) as { name: string; _raw?: unknown };

    assert.equal(parsed.name, 'fixture-page');
    assert.equal(parsed._raw, undefined, '_raw must NOT be embedded in plugin JSON');
  });

  it('raw HTML is written to <target>/raw/<slug>.html when html:write-raw is in pipeline', async () => {
    // Entry DAG 'raw-html' scatters over stub:raw-page (fetch → write-raw → parse → json:write).
    // Raw HTML lands in <outDir>/raw-html/raw/; JSON lands in <outDir>/raw-html/ (no subdir).
    const entryDag = DAGDocument.load(OrchDag.forScenario('raw-html', 'stub:raw-page'));
    const state = {
      output:  { basePath: outDir },
      baseUrl: 'https://fixture.test',
      urls:    ['https://fixture.test/condition-blinded'],
    } satisfies RunStateType;

    await runDag({ dags: [entryDag], state, outDir, configDir: outDir });

    const rawDir   = join(outDir, 'raw-html', 'raw');
    const rawFiles = (await readdir(rawDir)).filter((file) => file.endsWith('.html'));
    assert.ok(rawFiles.length === 1, `expected 1 raw HTML file, got ${rawFiles.length.toString()}`);
    assert.equal(await readFile(join(rawDir, rawFiles[0]!), 'utf8'), fixtureHtml, 'raw HTML must match fixture byte-for-byte');

    // pluginTaskName undefined (ScatterNode.body.dag, not SingleNode.node in bundle)
    // → JSON at <outDir>/raw-html/<slug>.json directly
    const targetDir = join(outDir, 'raw-html');
    const jsonFiles = (await readdir(targetDir)).filter((file) => file.endsWith('.json') && file !== 'failures.json');
    assert.ok(jsonFiles.length === 1, `expected 1 plugin JSON file in raw-html/, got ${jsonFiles.length.toString()}`);
  });

  it('no-plugin pipeline (raw-only): only raw/ folder is populated', async () => {
    // Entry DAG 'raw-only' scatters over stub:raw-only-page (fetch → write-raw, no parse).
    // stub:raw-only-page has no SingleNode with stub: prefix → pluginTaskName = undefined
    // but the namespace 'stub' still gets discovered from ScatterNode.body.dag = 'stub:raw-only-page'.
    const entryDag = DAGDocument.load(OrchDag.forScenario('raw-only', 'stub:raw-only-page'));
    const state = {
      output:  { basePath: outDir },
      baseUrl: 'https://fixture.test',
      urls:    ['https://fixture.test/condition-blinded'],
    } satisfies RunStateType;

    await runDag({ dags: [entryDag], state, outDir, configDir: outDir });

    const rawDir   = join(outDir, 'raw-only', 'raw');
    const rawFiles = (await readdir(rawDir)).filter((file) => file.endsWith('.html'));
    assert.ok(rawFiles.length === 1, `expected 1 raw HTML file, got ${rawFiles.length.toString()}`);

    const targetFiles = await readdir(join(outDir, 'raw-only'));
    const jsonFiles   = targetFiles.filter((file) => file.endsWith('.json') && file !== 'failures.json');
    assert.equal(jsonFiles.length, 0, 'no JSON output expected without a plugin step');
  });

  it('includeRawContent: false — _raw absent from plugin JSON', async () => {
    const entryDag = DAGDocument.load(OrchDag.forScenario('raw-off', 'stub:parse-page'));
    const state = {
      output:           { basePath: outDir },
      baseUrl:          'https://fixture.test',
      urls:             ['https://fixture.test/condition-blinded'],
      includeRawContent: false,
    } satisfies RunStateType;

    await runDag({ dags: [entryDag], state, outDir, configDir: outDir });

    // pluginTaskName undefined → JSON at <outDir>/raw-off/<slug>.json
    const targetDir = join(outDir, 'raw-off');
    const names = (await readdir(targetDir)).filter((file) => file.endsWith('.json') && file !== 'failures.json');
    assert.ok(names.length === 1, `expected 1 JSON file, got ${names.length.toString()}`);

    const parsed = JSON.parse(
      await readFile(join(targetDir, names[0]!), 'utf8'),
    ) as { _raw?: unknown };

    assert.equal(parsed._raw, undefined, '_raw must be absent when includeRawContent: false');
  });

  it('scrape + retry: deliberately-failing URL surfaces in failures.json', async () => {
    const FAILING_URL = 'https://fixture.test/will-fail';
    const PASSING_URL = 'https://fixture.test/condition-blinded';

    globalThis.fetch = (async (input: Request | URL | string): Promise<Response> => {
      const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url);
      if (url.endsWith('/will-fail')) {
        return new Response('not found', { status: 404 });
      }
      return new Response(fixtureHtml, {
        status:  200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }) as typeof fetch;

    // Two-scatter orchestration: scrape → retry. The 404 URL fails html:fetch,
    // routes to the page DAG's FAILED terminal, partitions into `failed`, gets
    // re-scattered by the retry scatter, fails again, and partitions into
    // `failedAfterRetry` — which runDag writes to failures.json.
    const entryDag = DAGDocument.load(OrchDag.scrapeRetry('retry-flow', 'stub:parse-page'));
    const state = {
      output:           { basePath: outDir },
      baseUrl:          'https://fixture.test',
      urls:             [PASSING_URL, FAILING_URL],
      includeRawContent: false,
      cache:             { mode: 'off' as const, dir: join(outDir, '.cache') },
    } satisfies RunStateType;

    await runDag({ dags: [entryDag], state, outDir, configDir: outDir });

    // runDag writes the failures manifest at <outDir>/failures.json (the run-level
    // outDir root), not under the per-target subdir — see runDag's failures step.
    const failuresPath = join(outDir, 'failures.json');
    const manifest = JSON.parse(await readFile(failuresPath, 'utf8')) as {
      timestamp: string; count: number; titles: string[];
    };
    assert.equal(manifest.count, 1, 'expected exactly one item in failures.json');
    assert.equal(manifest.titles.length, 1);
    assert.equal(manifest.titles[0], FAILING_URL, 'failing URL must be present after retry exhaustion');

    // pluginTaskName undefined → JSON at <outDir>/retry-flow/<slug>.json.
    // The passing URL still produces exactly one JSON output.
    const targetDir = join(outDir, 'retry-flow');
    const files = (await readdir(targetDir)).filter((file) => file.endsWith('.json') && file !== 'failures.json');
    assert.equal(files.length, 1, 'expected exactly one JSON output for the passing URL');
  });

  it('AONPRD-like full pipeline produces raw/ and sibling JSON output', async () => {
    // Entry DAG 'aonprd' scatters over stub:raw-page (fetch → write-raw → parse → json:write).
    // pluginTaskName undefined (ScatterNode.body.dag in entry DAG, not SingleNode.node)
    // → raw HTML at <outDir>/aonprd/raw/<slug>.html
    // → JSON at <outDir>/aonprd/<slug>.json
    const entryDag = DAGDocument.load(OrchDag.forScenario('aonprd', 'stub:raw-page'));
    const state = {
      output:  { basePath: outDir },
      baseUrl: 'https://2e.aonprd.com',
      urls:    ['https://2e.aonprd.com/Conditions.aspx?ID=1'],
    } satisfies RunStateType;

    await runDag({ dags: [entryDag], state, outDir, configDir: outDir });

    const rawDir   = join(outDir, 'aonprd', 'raw');
    const rawFiles = (await readdir(rawDir)).filter((file) => file.endsWith('.html'));
    assert.ok(rawFiles.length === 1, `expected 1 raw HTML file, got ${rawFiles.length.toString()}`);
    assert.equal(rawFiles[0], 'Conditions.aspx-ID-1.html');

    const targetDir = join(outDir, 'aonprd');
    const jsonFiles = (await readdir(targetDir)).filter((file) => file.endsWith('.json') && file !== 'failures.json');
    assert.ok(jsonFiles.length === 1, `expected 1 plugin JSON file, got ${jsonFiles.length.toString()}`);
    assert.equal(jsonFiles[0], 'Conditions.aspx-ID-1.json');

    const parsed = JSON.parse(
      await readFile(join(targetDir, jsonFiles[0]!), 'utf8'),
    ) as { _raw?: unknown };
    assert.equal(parsed._raw, undefined, '_raw must NOT appear in plugin JSON');
  });
});

// Integration test: fixture-based scrape with the new folder-split output layout.
//
// Raw content (html) goes to <outDir>/<target>/raw/<slug>.html
// Plugin JSON goes to <outDir>/<target>/<pluginTaskName>/<slug>.json  (no _raw embed)
//
// Uses a fake fetch to serve a known HTML fixture and the full
// runHtml + built-in nodes pipeline.  No network calls.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runHtml } from '../../src/run/runHtml.js';
import type { NormalizedRipperConfigInterface }   from '../../src/types/Config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load a real AONPRD fixture HTML so the content is non-trivial.
const FIXTURE_HTML_PATH = resolve(__dirname, '../e2e/plugins/fixtures/aonprd/condition-blinded.html');

// The plugin loader requires a real file at configDir/plugins/stub/parse.task.js.
// We write a temporary plugin file that exports register() in beforeEach.

import { writeFile, mkdir } from 'node:fs/promises';

describe('rawContent integration (folder-split layout)', () => {
  let outDir:      string;
  let pluginDir:   string;
  let fixtureHtml: string;
  const realFetch = globalThis.fetch;

  beforeEach(async () => {
    outDir      = await mkdtemp(join(tmpdir(), 'ripperoni-raw-content-'));
    fixtureHtml = await readFile(FIXTURE_HTML_PATH, 'utf8');

    // Write a temporary plugin file that exports register() for stub:parse.
    // The plugin uses an absolute import path to DAGDeriver so it can be loaded
    // from a tmp directory where node_modules is not accessible via traversal.
    pluginDir = join(outDir, 'plugins', 'stub');
    await mkdir(pluginDir, { recursive: true });
    const dagDeriverAbsPath = resolve(
      __dirname, '..', '..', 'node_modules', '@noocodex', 'dagonizer', 'dist', 'derive', 'index.js',
    );
    await writeFile(join(pluginDir, 'parse.task.js'), `
import { DAGDeriver } from ${JSON.stringify(`file://${dagDeriverAbsPath}`)};

const stubParseNode = {
  name: 'stub:parse',
  outputs: ['success'],
  async execute(state) {
    state.output = { _type: 'stub', name: 'fixture-page' };
    return { output: 'success' };
  },
};

const stubParseDAG = DAGDeriver.derive({
  name:       'stub:parse',
  version:    '1.0',
  entrypoint: 'parse',
  contracts: [
    { name: 'parse', hardRequired: [], produces: [], outputs: ['success'] },
  ],
  annotations: {
    terminals: { parse: [{ outcome: 'success', target: null }] },
  },
});

export function register(dispatcher) {
  dispatcher.registerNode(stubParseNode);
  dispatcher.registerDAG(stubParseDAG);
}
`);

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

  const makeConfig = (targetName: string, pipeline: string[], extra: Record<string, unknown> = {}): NormalizedRipperConfigInterface => ({
    output: { basePath: outDir },
    targets: {
      [targetName]: {
        baseUrl: 'https://fixture.test',
        pipeline,
        ...extra,
      },
    },
  } as unknown as NormalizedRipperConfigInterface);

  it('plugin pipeline writes JSON to <target>/<pluginTaskName>/ and does NOT embed _raw', async () => {
    const config = makeConfig('raw-default', ['html:fetch', 'stub:parse', 'json:write']);
    await runHtml({
      target:    'raw-default',
      paths:     ['https://fixture.test/condition-blinded'],
      outDir,
      configDir: outDir,
      config,
    });

    const pDir   = join(outDir, 'raw-default', 'stub:parse');
    const files  = (await readdir(pDir)).filter((f: string) => f.endsWith('.json') && f !== 'failures.json');
    assert.ok(files.length === 1, `expected 1 plugin JSON file, got ${files.length.toString()}`);

    const parsed = JSON.parse(
      await readFile(join(pDir, files[0]!), 'utf8'),
    ) as { _type: string; name: string; _raw?: unknown };

    assert.equal(parsed._type, 'stub');
    assert.equal(parsed.name, 'fixture-page');
    assert.equal(parsed._raw, undefined, '_raw must NOT be embedded in plugin JSON');
  });

  it('raw HTML is written to <target>/raw/<slug>.html when html:write-raw is in pipeline', async () => {
    const config = makeConfig('raw-html', ['html:fetch', 'html:write-raw', 'stub:parse', 'json:write']);
    await runHtml({
      target:    'raw-html',
      paths:     ['https://fixture.test/condition-blinded'],
      outDir,
      configDir: outDir,
      config,
    });

    const rawDir   = join(outDir, 'raw-html', 'raw');
    const rawFiles = (await readdir(rawDir)).filter((f: string) => f.endsWith('.html'));
    assert.ok(rawFiles.length === 1, `expected 1 raw HTML file, got ${rawFiles.length.toString()}`);
    assert.equal(await readFile(join(rawDir, rawFiles[0]!), 'utf8'), fixtureHtml, 'raw HTML must match fixture byte-for-byte');

    const pDir     = join(outDir, 'raw-html', 'stub:parse');
    const jsonFiles = (await readdir(pDir)).filter((f: string) => f.endsWith('.json'));
    assert.ok(jsonFiles.length === 1, `expected 1 plugin JSON file in stub:parse/, got ${jsonFiles.length.toString()}`);
  });

  it('no-plugin pipeline (raw-only): only raw/ folder is populated', async () => {
    const config = makeConfig('raw-only', ['html:fetch', 'html:write-raw']);
    await runHtml({
      target:    'raw-only',
      paths:     ['https://fixture.test/condition-blinded'],
      outDir,
      configDir: outDir,
      config,
    });

    const rawDir   = join(outDir, 'raw-only', 'raw');
    const rawFiles = (await readdir(rawDir)).filter((f: string) => f.endsWith('.html'));
    assert.ok(rawFiles.length === 1, `expected 1 raw HTML file, got ${rawFiles.length.toString()}`);

    const targetFiles = await readdir(join(outDir, 'raw-only'));
    const jsonFiles   = targetFiles.filter((f: string) => f.endsWith('.json') && f !== 'failures.json');
    assert.equal(jsonFiles.length, 0, 'no JSON output expected without a plugin step');
  });

  it('includeRawContent: false — _raw absent from plugin JSON', async () => {
    const config = makeConfig('raw-off', ['html:fetch', 'stub:parse', 'json:write'], { includeRawContent: false });
    await runHtml({
      target:    'raw-off',
      paths:     ['https://fixture.test/condition-blinded'],
      outDir,
      configDir: outDir,
      config,
    });

    const pDir  = join(outDir, 'raw-off', 'stub:parse');
    const names = (await readdir(pDir)).filter((f: string) => f.endsWith('.json') && f !== 'failures.json');
    assert.ok(names.length === 1, `expected 1 JSON file, got ${names.length.toString()}`);

    const parsed = JSON.parse(
      await readFile(join(pDir, names[0]!), 'utf8'),
    ) as { _type: string; _raw?: unknown };

    assert.equal(parsed._type, 'stub');
    assert.equal(parsed._raw, undefined, '_raw must be absent when includeRawContent: false');
  });

  it('scrape + retry: deliberately-failing URL surfaces in failures.json', async () => {
    const FAILING_URL  = 'https://fixture.test/will-fail';
    const PASSING_URL  = 'https://fixture.test/condition-blinded';
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url);
      if (url.endsWith('/will-fail')) {
        return new Response('not found', { status: 404 });
      }
      return new Response(fixtureHtml, {
        status:  200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }) as typeof fetch;

    const config = makeConfig('retry-flow', ['html:fetch', 'stub:parse', 'json:write'], {
      cache:             { mode: 'off' as const, dir: join(outDir, '.cache') },
      includeRawContent: false,
    });
    await runHtml({
      target:    'retry-flow',
      paths:     [PASSING_URL, FAILING_URL],
      outDir,
      configDir: outDir,
      config,
    });

    const failuresPath = join(outDir, 'retry-flow', 'failures.json');
    const manifest = JSON.parse(await readFile(failuresPath, 'utf8')) as {
      timestamp: string; count: number; titles: string[];
    };
    assert.equal(manifest.count, 1, 'expected exactly one item in failures.json');
    assert.equal(manifest.titles.length, 1);
    assert.equal(manifest.titles[0], FAILING_URL, 'failing URL must be present after retry exhaustion');

    const pDir  = join(outDir, 'retry-flow', 'stub:parse');
    const files = (await readdir(pDir)).filter((f: string) => f.endsWith('.json'));
    assert.equal(files.length, 1, 'expected exactly one JSON output for the passing URL');
  });

  it('AONPRD-like full pipeline produces raw/ and stub:parse/ sibling folders', async () => {
    const config = makeConfig('aonprd', ['html:fetch', 'html:write-raw', 'stub:parse', 'json:write']);
    await runHtml({
      target:    'aonprd',
      paths:     ['https://2e.aonprd.com/Conditions.aspx?ID=1'],
      outDir,
      configDir: outDir,
      config,
    });

    const rawDir   = join(outDir, 'aonprd', 'raw');
    const rawFiles = (await readdir(rawDir)).filter((f: string) => f.endsWith('.html'));
    assert.ok(rawFiles.length === 1, `expected 1 raw HTML file, got ${rawFiles.length.toString()}`);
    assert.equal(rawFiles[0], 'Conditions.aspx-ID-1.html');

    const pDir     = join(outDir, 'aonprd', 'stub:parse');
    const jsonFiles = (await readdir(pDir)).filter((f: string) => f.endsWith('.json'));
    assert.ok(jsonFiles.length === 1, `expected 1 plugin JSON file, got ${jsonFiles.length.toString()}`);
    assert.equal(jsonFiles[0], 'Conditions.aspx-ID-1.json');

    const parsed = JSON.parse(
      await readFile(join(pDir, jsonFiles[0]!), 'utf8'),
    ) as { _type: string; _raw?: unknown };
    assert.equal(parsed._type, 'stub');
    assert.equal(parsed._raw, undefined, '_raw must NOT appear in plugin JSON');
  });
});

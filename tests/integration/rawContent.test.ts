// Integration test: fixture-based scrape with the new folder-split output layout.
//
// Raw content (html) goes to <outDir>/<target>/raw/<slug>.html
// Plugin JSON goes to <outDir>/<target>/<pluginTaskName>/<slug>.json  (no _raw embed)
//
// Uses a fake fetch to serve a known HTML fixture and the full
// ScrapeOrchestrator + builtinTasks pipeline.  No network calls.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ScrapeOrchestrator } from '../../src/orchestrators/ScrapeOrchestrator.js';
import { TaskRegistry }       from '../../src/registry/TaskRegistry.js';
import {
  htmlFetchTask,
  htmlWriteRawTask,
  wikiWriteRawTask,
  wikiFetchTask,
  jsonWriteTask,
  jsonlAppendTask,
  validateSchemaTask,
  crawlListTargetsTask,
} from '../../src/registry/builtinTasks.js';
import type { PipelineStateInterface } from '../../src/types/PipelineState.js';
import type { TaskFnInterface } from '../../src/types/Pipeline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load a real AONPRD fixture HTML so the content is non-trivial.
const FIXTURE_HTML_PATH = resolve(__dirname, '../e2e/plugins/fixtures/aonprd/condition-blinded.html');

// Minimal plugin: sets state.output to a stub so json:write has something to write.
const stubParseTask: TaskFnInterface<PipelineStateInterface> = async (next, state) => {
  state.output = { _type: 'stub', name: 'fixture-page' };
  await next();
};

describe('rawContent integration (folder-split layout)', () => {
  let outDir:      string;
  let fixtureHtml: string;
  const realFetch = globalThis.fetch;

  beforeEach(async () => {
    outDir      = await mkdtemp(join(tmpdir(), 'ripperoni-raw-content-'));
    fixtureHtml = await readFile(FIXTURE_HTML_PATH, 'utf8');

    // Intercept all HTTP requests and return the fixture HTML.
    globalThis.fetch = (async (): Promise<Response> =>
      new Response(fixtureHtml, {
        status:  200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    ) as typeof fetch;

    // Reset registry and re-register all builtins + the stub plugin.
    TaskRegistry.reset();
    TaskRegistry.register('html:fetch',         htmlFetchTask);
    TaskRegistry.register('wiki:fetch',         wikiFetchTask);
    TaskRegistry.register('html:write-raw',     htmlWriteRawTask);
    TaskRegistry.register('wiki:write-raw',     wikiWriteRawTask);
    TaskRegistry.register('json:write',         jsonWriteTask);
    TaskRegistry.register('jsonl:append',       jsonlAppendTask);
    TaskRegistry.register('validate:schema',    validateSchemaTask);
    TaskRegistry.register('crawl:list-targets', crawlListTargetsTask);
    TaskRegistry.register('stub:parse', stubParseTask);
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    await rm(outDir, { recursive: true, force: true });
  });

  it('plugin pipeline writes JSON to <target>/<pluginTaskName>/ and does NOT embed _raw', async () => {
    // Pipeline: html:fetch -> stub:parse -> json:write
    // stub:parse is the pluginTaskName; orchestrator injects it into context.
    const config = {
      output: { basePath: outDir },
      targets: {
        'raw-default': {
          baseUrl:  'https://fixture.test',
          pipeline: ['html:fetch', 'stub:parse', 'json:write'],
        },
      },
    };

    await ScrapeOrchestrator.scrapeHtml({
      target:    'raw-default',
      paths:     ['https://fixture.test/condition-blinded'],
      outDir,
      configDir: __dirname,
      config:    config as Parameters<typeof ScrapeOrchestrator.scrapeHtml>[0]['config'],
    });

    // Plugin JSON should be in <target>/stub:parse/ subfolder
    const pluginDir = join(outDir, 'raw-default', 'stub:parse');
    const files     = (await readdir(pluginDir)).filter((f: string) => f.endsWith('.json') && f !== 'failures.json');
    assert.ok(files.length === 1, `expected 1 plugin JSON file, got ${files.length.toString()}`);

    const parsed = JSON.parse(
      await readFile(join(pluginDir, files[0]!), 'utf8'),
    ) as { _type: string; name: string; _raw?: unknown };

    assert.equal(parsed._type, 'stub');
    assert.equal(parsed.name, 'fixture-page');
    assert.equal(parsed._raw, undefined, '_raw must NOT be embedded in plugin JSON');
  });

  it('raw HTML is written to <target>/raw/<slug>.html when html:write-raw is in pipeline', async () => {
    const config = {
      output: { basePath: outDir },
      targets: {
        'raw-html': {
          baseUrl:  'https://fixture.test',
          pipeline: ['html:fetch', 'html:write-raw', 'stub:parse', 'json:write'],
        },
      },
    };

    await ScrapeOrchestrator.scrapeHtml({
      target:    'raw-html',
      paths:     ['https://fixture.test/condition-blinded'],
      outDir,
      configDir: __dirname,
      config:    config as Parameters<typeof ScrapeOrchestrator.scrapeHtml>[0]['config'],
    });

    // Raw HTML should be in <target>/raw/ subfolder
    const rawDir  = join(outDir, 'raw-html', 'raw');
    const rawFiles = (await readdir(rawDir)).filter((f: string) => f.endsWith('.html'));
    assert.ok(rawFiles.length === 1, `expected 1 raw HTML file, got ${rawFiles.length.toString()}`);

    const rawContent = await readFile(join(rawDir, rawFiles[0]!), 'utf8');
    assert.equal(rawContent, fixtureHtml, 'raw HTML must match fixture byte-for-byte');

    // Plugin JSON in stub:parse subfolder
    const pluginDir  = join(outDir, 'raw-html', 'stub:parse');
    const jsonFiles  = (await readdir(pluginDir)).filter((f: string) => f.endsWith('.json'));
    assert.ok(jsonFiles.length === 1, `expected 1 plugin JSON file in stub:parse/, got ${jsonFiles.length.toString()}`);
  });

  it('no-plugin pipeline (raw-only): only raw/ folder is populated, no plugin subfolder', async () => {
    // Pipeline: html:fetch -> html:write-raw (no json:write or plugin)
    const config = {
      output: { basePath: outDir },
      targets: {
        'raw-only': {
          baseUrl:  'https://fixture.test',
          pipeline: ['html:fetch', 'html:write-raw'],
        },
      },
    };

    await ScrapeOrchestrator.scrapeHtml({
      target:    'raw-only',
      paths:     ['https://fixture.test/condition-blinded'],
      outDir,
      configDir: __dirname,
      config:    config as Parameters<typeof ScrapeOrchestrator.scrapeHtml>[0]['config'],
    });

    // Raw HTML should exist
    const rawDir   = join(outDir, 'raw-only', 'raw');
    const rawFiles = (await readdir(rawDir)).filter((f: string) => f.endsWith('.html'));
    assert.ok(rawFiles.length === 1, `expected 1 raw HTML file, got ${rawFiles.length.toString()}`);

    // No plugin JSON should exist at the target root
    const targetDir   = join(outDir, 'raw-only');
    const targetFiles = await readdir(targetDir);
    const jsonFiles   = targetFiles.filter((f: string) => f.endsWith('.json') && f !== 'failures.json');
    assert.equal(jsonFiles.length, 0, 'no JSON output expected without a plugin step');
  });

  it('includeRawContent: false — no raw embed and _raw absent from state.page', async () => {
    const config = {
      output: { basePath: outDir },
      targets: {
        'raw-off': {
          baseUrl:           'https://fixture.test',
          pipeline:          ['html:fetch', 'stub:parse', 'json:write'],
          includeRawContent: false,
        },
      },
    };

    await ScrapeOrchestrator.scrapeHtml({
      target:    'raw-off',
      paths:     ['https://fixture.test/condition-blinded'],
      outDir,
      configDir: __dirname,
      config:    config as Parameters<typeof ScrapeOrchestrator.scrapeHtml>[0]['config'],
    });

    const pluginDir = join(outDir, 'raw-off', 'stub:parse');
    const names     = (await readdir(pluginDir)).filter((f: string) => f.endsWith('.json') && f !== 'failures.json');
    assert.ok(names.length === 1, `expected 1 JSON file, got ${names.length.toString()}`);

    const parsed = JSON.parse(
      await readFile(join(pluginDir, names[0]!), 'utf8'),
    ) as { _type: string; _raw?: unknown };

    assert.equal(parsed._type, 'stub');
    assert.equal(parsed._raw, undefined, '_raw must be absent when includeRawContent: false is set');
  });

  it('AONPRD-like full pipeline produces raw/ and stub:parse/ sibling folders', async () => {
    // Simulates: output/aonprd/raw/Conditions.aspx-ID-1.html + output/aonprd/stub:parse/Conditions.aspx-ID-1.json
    const config = {
      output: { basePath: outDir },
      targets: {
        'aonprd': {
          baseUrl:  'https://2e.aonprd.com',
          pipeline: ['html:fetch', 'html:write-raw', 'stub:parse', 'json:write'],
        },
      },
    };

    await ScrapeOrchestrator.scrapeHtml({
      target:    'aonprd',
      paths:     ['https://2e.aonprd.com/Conditions.aspx?ID=1'],
      outDir,
      configDir: __dirname,
      config:    config as Parameters<typeof ScrapeOrchestrator.scrapeHtml>[0]['config'],
    });

    // raw/ folder: Conditions.aspx-ID-1.html
    const rawDir   = join(outDir, 'aonprd', 'raw');
    const rawFiles = (await readdir(rawDir)).filter((f: string) => f.endsWith('.html'));
    assert.ok(rawFiles.length === 1, `expected 1 raw HTML file, got ${rawFiles.length.toString()}`);
    assert.equal(rawFiles[0], 'Conditions.aspx-ID-1.html', `expected Conditions.aspx-ID-1.html, got ${rawFiles[0] ?? '?'}`);

    // stub:parse/ folder: Conditions.aspx-ID-1.json
    const pluginDir  = join(outDir, 'aonprd', 'stub:parse');
    const jsonFiles  = (await readdir(pluginDir)).filter((f: string) => f.endsWith('.json'));
    assert.ok(jsonFiles.length === 1, `expected 1 plugin JSON file, got ${jsonFiles.length.toString()}`);
    assert.equal(jsonFiles[0], 'Conditions.aspx-ID-1.json', `expected Conditions.aspx-ID-1.json, got ${jsonFiles[0] ?? '?'}`);

    const parsed = JSON.parse(
      await readFile(join(pluginDir, jsonFiles[0]!), 'utf8'),
    ) as { _type: string; _raw?: unknown };
    assert.equal(parsed._type, 'stub');
    assert.equal(parsed._raw, undefined, '_raw must NOT appear in plugin JSON');
  });
});

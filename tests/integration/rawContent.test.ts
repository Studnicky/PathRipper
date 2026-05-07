// Integration test: fixture-based scrape with includeRawContent: true
// verifies that _raw.content in the output JSON matches the input HTML byte-for-byte.
//
// Uses a fake fetch to serve a known HTML fixture and the full
// ScrapeOrchestrator + builtinTasks pipeline.  No network calls.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
import type { RawContentInterface } from '../../src/types/PipelineState.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load a real AONPRD fixture HTML so the content is non-trivial.
const FIXTURE_HTML_PATH = resolve(__dirname, '../e2e/plugins/fixtures/aonprd/condition-blinded.html');

// Minimal plugin: sets state.output to a stub so json:write has something to write.
const stubParseTask: TaskFnInterface<PipelineStateInterface> = async (next, state) => {
  state.output = { _type: 'stub', name: 'fixture-page' };
  await next();
};

describe('rawContent integration', () => {
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
    // We cannot rely on ESM module re-execution for side-effects, so we
    // import the task functions directly and register them here.
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

  it('output JSON includes _raw.content by default (no flag set)', async () => {
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

    const files  = (await import('node:fs/promises')).readdir(join(outDir, 'raw-default'));
    const names  = (await files).filter((f: string) => f.endsWith('.json') && f !== 'failures.json');
    assert.ok(names.length === 1, `expected 1 JSON file, got ${names.length.toString()}`);

    const parsed = JSON.parse(
      await readFile(join(outDir, 'raw-default', names[0]!), 'utf8'),
    ) as { _type: string; _raw?: RawContentInterface };

    assert.equal(parsed._type, 'stub');
    assert.ok(parsed._raw !== undefined, '_raw should be present by default');
    assert.equal(parsed._raw.contentType, 'text/html');
    assert.equal(parsed._raw.content, fixtureHtml, '_raw.content must match the fixture HTML byte-for-byte');
    assert.ok(typeof parsed._raw.fetchedAt === 'string' && parsed._raw.fetchedAt.length > 0, 'fetchedAt must be an ISO string');
  });

  it('output JSON includes _raw.content equal to the fetched HTML when includeRawContent is explicitly true', async () => {
    const config = {
      output: { basePath: outDir },
      targets: {
        'raw-test': {
          baseUrl:           'https://fixture.test',
          pipeline:          ['html:fetch', 'stub:parse', 'json:write'],
          includeRawContent: true,
        },
      },
    };

    await ScrapeOrchestrator.scrapeHtml({
      target:    'raw-test',
      paths:     ['https://fixture.test/condition-blinded'],
      outDir,
      configDir: __dirname,
      config:    config as Parameters<typeof ScrapeOrchestrator.scrapeHtml>[0]['config'],
    });

    const files  = (await import('node:fs/promises')).readdir(join(outDir, 'raw-test'));
    const names  = (await files).filter((f: string) => f.endsWith('.json') && f !== 'failures.json');
    assert.ok(names.length === 1, `expected 1 JSON file, got ${names.length.toString()}`);

    const parsed = JSON.parse(
      await readFile(join(outDir, 'raw-test', names[0]!), 'utf8'),
    ) as { _type: string; _raw?: RawContentInterface };

    assert.equal(parsed._type, 'stub');
    assert.ok(parsed._raw !== undefined, '_raw should be present when explicitly opted in');
    assert.equal(parsed._raw.contentType, 'text/html');
    assert.equal(parsed._raw.content, fixtureHtml, '_raw.content must match the fixture HTML byte-for-byte');
    assert.ok(typeof parsed._raw.fetchedAt === 'string' && parsed._raw.fetchedAt.length > 0, 'fetchedAt must be an ISO string');
  });

  it('output JSON does NOT include _raw when includeRawContent is false (opt-out)', async () => {
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

    const files  = (await import('node:fs/promises')).readdir(join(outDir, 'raw-off'));
    const names  = (await files).filter((f: string) => f.endsWith('.json') && f !== 'failures.json');
    assert.ok(names.length === 1, `expected 1 JSON file, got ${names.length.toString()}`);

    const parsed = JSON.parse(
      await readFile(join(outDir, 'raw-off', names[0]!), 'utf8'),
    ) as { _type: string; _raw?: unknown };

    assert.equal(parsed._type, 'stub');
    assert.equal(parsed._raw, undefined, '_raw must be absent when includeRawContent: false is set');
  });

  it('pipeline with no plugin step produces _raw dump without plugin-specific fields', async () => {
    // Validates Item I: a pipeline of ["html:fetch", "json:write"] with no plugin
    // should produce output with _raw populated and no plugin-specific keys.
    // json:write skips when output is null, so we use jsonl:append via a stub that
    // leaves output populated — but here we test the raw fetch side only via
    // a minimal stub that sets a bare output without plugin fields.
    const bareStubTask: TaskFnInterface<PipelineStateInterface> = async (next, state) => {
      state.output = {};
      await next();
    };
    TaskRegistry.register('bare:stub', bareStubTask);

    const config = {
      output: { basePath: outDir },
      targets: {
        'raw-no-plugin': {
          baseUrl:  'https://fixture.test',
          pipeline: ['html:fetch', 'bare:stub', 'json:write'],
        },
      },
    };

    await ScrapeOrchestrator.scrapeHtml({
      target:    'raw-no-plugin',
      paths:     ['https://fixture.test/condition-blinded'],
      outDir,
      configDir: __dirname,
      config:    config as Parameters<typeof ScrapeOrchestrator.scrapeHtml>[0]['config'],
    });

    const files  = (await import('node:fs/promises')).readdir(join(outDir, 'raw-no-plugin'));
    const names  = (await files).filter((f: string) => f.endsWith('.json') && f !== 'failures.json');
    assert.ok(names.length === 1, `expected 1 JSON file, got ${names.length.toString()}`);

    const parsed = JSON.parse(
      await readFile(join(outDir, 'raw-no-plugin', names[0]!), 'utf8'),
    ) as { _raw?: RawContentInterface; _type?: unknown };

    assert.ok(parsed._raw !== undefined, '_raw must be present even with no plugin');
    assert.equal(parsed._raw.contentType, 'text/html');
    assert.equal(parsed._raw.content, fixtureHtml, '_raw.content must match fixture HTML');
    assert.equal(parsed._type, undefined, 'no plugin-specific _type field should be present');
  });
});

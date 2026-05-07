import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RawContentInterface } from '../../../src/types/PipelineState.js';

import { TaskRegistry } from '../../../src/registry/TaskRegistry.js';
import { ExternalSchemaError } from '../../../src/errors/ExternalSchemaError.js';
import type { PipelineStateInterface } from '../../../src/types/PipelineState.js';
import type { ScrapedPageInterface } from '../../../src/types/HtmlScraper.js';

import '../../../src/registry/builtinTasks.js';

const TARGET = 'unit-target';

const buildState = (overrides: Partial<PipelineStateInterface> = {}): PipelineStateInterface => {
  const base: PipelineStateInterface = {
    targetId: TARGET,
    page:     { targetId: TARGET, title: 'My Page', url: 'https://example.test/page' },
    output:   null,
  };
  return { ...base, ...overrides };
};

const noopNext = async (): Promise<void> => { /* terminal next */ };

class FakeHtmlScraper {
  public calls: string[] = [];
  public constructor(private readonly response: ScrapedPageInterface) { /* fixture */ }
  public async fetchPage(path: string): Promise<ScrapedPageInterface> {
    this.calls.push(path);
    return Promise.resolve(this.response);
  }
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

describe('builtinTasks', () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'ripper-builtin-'));
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  describe('registration', () => {
    it('registers all seven built-in tasks at module load', () => {
      assert.equal(TaskRegistry.has('html:fetch'),      true);
      assert.equal(TaskRegistry.has('wiki:fetch'),      true);
      assert.equal(TaskRegistry.has('html:write-raw'),  true);
      assert.equal(TaskRegistry.has('wiki:write-raw'),  true);
      assert.equal(TaskRegistry.has('json:write'),      true);
      assert.equal(TaskRegistry.has('jsonl:append'),    true);
      assert.equal(TaskRegistry.has('validate:schema'), true);
    });
  });

  describe('html:fetch', () => {
    it('fetches via context.scraper and stores html + resolved url on the page', async () => {
      const scraper = new FakeHtmlScraper({
        url:  'https://example.test/page-resolved',
        html: '<html><body>hello</body></html>',
        // CheerioAPI not needed for this assertion path; cast keeps the fixture lean.
        $: ((): unknown => ({}))() as unknown as ScrapedPageInterface['$'],
      });
      const state = buildState({
        context: { target: TARGET, outDir, scraper: scraper as unknown as never, config: {} },
      });

      const task = TaskRegistry.get('html:fetch');
      await task(noopNext, state);

      assert.deepEqual(scraper.calls, ['https://example.test/page']);
      assert.equal(state.page.html, '<html><body>hello</body></html>');
      assert.equal(state.page.url,  'https://example.test/page-resolved');
    });

    it('throws when context is absent', async () => {
      const state = buildState();
      const task  = TaskRegistry.get('html:fetch');
      await assert.rejects(task(noopNext, state), (e: unknown) => e instanceof ExternalSchemaError);
    });
  });

  describe('html:write-raw', () => {
    it('writes html to <outDir>/<target>/raw/<slug>.html', async () => {
      const state = buildState({
        page:    { targetId: TARGET, title: 'Example Page!', url: 'https://example.test/x', html: '<p>raw</p>' },
        context: { target: TARGET, outDir, config: {} },
      });
      const task = TaskRegistry.get('html:write-raw');
      await task(noopNext, state);

      const expected = join(outDir, TARGET, 'raw', 'example-page.html');
      const body     = await readFile(expected, 'utf8');
      assert.equal(body, '<p>raw</p>');
    });

    it('throws when html is missing', async () => {
      const state = buildState({
        context: { target: TARGET, outDir, config: {} },
      });
      const task = TaskRegistry.get('html:write-raw');
      await assert.rejects(task(noopNext, state), (e: unknown) => e instanceof ExternalSchemaError);
    });
  });

  describe('json:write', () => {
    it('writes pretty JSON to <outDir>/<target>/<slug>.json with the correct slug', async () => {
      const state = buildState({
        page:    { targetId: TARGET, title: 'Some Title 123', url: 'https://x.test/y' },
        context: { target: TARGET, outDir, config: {} },
        output:  { hello: 'world' },
      });
      const task = TaskRegistry.get('json:write');
      await task(noopNext, state);

      const expected = join(outDir, TARGET, 'some-title-123.json');
      const body     = await readFile(expected, 'utf8');
      assert.equal(body, '{\n  "hello": "world"\n}');
    });

    it('skips writing when output is null', async () => {
      const state = buildState({
        context: { target: TARGET, outDir, config: {} },
      });
      const task = TaskRegistry.get('json:write');
      await task(noopNext, state);

      const expected = join(outDir, TARGET, 'my-page.json');
      assert.equal(await exists(expected), false);
    });
  });

  describe('jsonl:append', () => {
    it('appends one JSON line per invocation to <outDir>/<target>/all.jsonl', async () => {
      const ctx  = { target: TARGET, outDir, config: {} };
      const task = TaskRegistry.get('jsonl:append');

      await task(noopNext, buildState({ context: ctx, output: { n: 1 } }));
      await task(noopNext, buildState({ context: ctx, output: { n: 2 } }));
      await task(noopNext, buildState({ context: ctx, output: { n: 3 } }));

      const expected = join(outDir, TARGET, 'all.jsonl');
      const body     = await readFile(expected, 'utf8');
      assert.equal(body, '{"n":1}\n{"n":2}\n{"n":3}\n');
    });
  });

  describe('html:fetch + includeRawContent', () => {
    it('sets _raw on state.page when includeRawContent is true', async () => {
      const HTML = '<html><body>raw test</body></html>';
      const scraper = new FakeHtmlScraper({
        url:  'https://example.test/page-resolved',
        html: HTML,
        $: ((): unknown => ({}))() as unknown as ScrapedPageInterface['$'],
      });
      const state = buildState({
        context: { target: TARGET, outDir, scraper: scraper as unknown as never, config: { includeRawContent: true } },
      });

      const task = TaskRegistry.get('html:fetch');
      await task(noopNext, state);

      assert.ok(state.page._raw !== undefined, '_raw should be set');
      const raw = state.page._raw as RawContentInterface;
      assert.equal(raw.contentType, 'text/html');
      assert.equal(raw.content, HTML);
      assert.ok(typeof raw.fetchedAt === 'string' && raw.fetchedAt.length > 0);
    });

    it('does NOT set _raw on state.page when includeRawContent is false', async () => {
      const scraper = new FakeHtmlScraper({
        url:  'https://example.test/page-resolved',
        html: '<html><body>no raw</body></html>',
        $: ((): unknown => ({}))() as unknown as ScrapedPageInterface['$'],
      });
      const state = buildState({
        context: { target: TARGET, outDir, scraper: scraper as unknown as never, config: { includeRawContent: false } },
      });

      const task = TaskRegistry.get('html:fetch');
      await task(noopNext, state);

      assert.equal(state.page._raw, undefined);
    });

    it('does NOT set _raw on state.page when includeRawContent is absent', async () => {
      const scraper = new FakeHtmlScraper({
        url:  'https://example.test/page-resolved',
        html: '<html><body>no raw</body></html>',
        $: ((): unknown => ({}))() as unknown as ScrapedPageInterface['$'],
      });
      const state = buildState({
        context: { target: TARGET, outDir, scraper: scraper as unknown as never, config: {} },
      });

      const task = TaskRegistry.get('html:fetch');
      await task(noopNext, state);

      assert.equal(state.page._raw, undefined);
    });
  });

  describe('json:write + _raw injection', () => {
    it('includes _raw in written JSON when page._raw is set', async () => {
      const raw: RawContentInterface = { contentType: 'text/html', content: '<p>hello</p>', fetchedAt: '2026-01-01T00:00:00.000Z' };
      const state = buildState({
        page:    { targetId: TARGET, title: 'Raw Page', url: 'https://example.test/raw', html: '<p>hello</p>', _raw: raw },
        context: { target: TARGET, outDir, config: { includeRawContent: true } },
        output:  { name: 'Raw Page' },
      });
      const task = TaskRegistry.get('json:write');
      await task(noopNext, state);

      const expected = join(outDir, TARGET, 'raw-page.json');
      const parsed   = JSON.parse(await readFile(expected, 'utf8')) as { name: string; _raw?: RawContentInterface };
      assert.equal(parsed.name, 'Raw Page');
      assert.ok(parsed._raw !== undefined, '_raw should appear in output');
      assert.equal(parsed._raw.contentType, 'text/html');
      assert.equal(parsed._raw.content, '<p>hello</p>');
    });

    it('does not include _raw in written JSON when page._raw is absent', async () => {
      const state = buildState({
        context: { target: TARGET, outDir, config: {} },
        output:  { name: 'Plain Page' },
      });
      const task = TaskRegistry.get('json:write');
      await task(noopNext, state);

      const expected = join(outDir, TARGET, 'my-page.json');
      const parsed   = JSON.parse(await readFile(expected, 'utf8')) as { name: string; _raw?: unknown };
      assert.equal(parsed.name, 'Plain Page');
      assert.equal(parsed._raw, undefined);
    });
  });

  describe('jsonl:append + _raw injection', () => {
    it('includes _raw in appended JSONL rows when page._raw is set', async () => {
      const raw: RawContentInterface = { contentType: 'text/html', content: '<b>bold</b>', fetchedAt: '2026-06-01T00:00:00.000Z' };
      const ctx  = { target: TARGET, outDir, config: { includeRawContent: true } };
      const task = TaskRegistry.get('jsonl:append');

      await task(noopNext, buildState({
        page:    { targetId: TARGET, title: 'A', url: 'https://x.test/a', _raw: raw },
        context: ctx,
        output:  { n: 1 },
      }));

      const outFile = join(outDir, TARGET, 'all.jsonl');
      const body    = await readFile(outFile, 'utf8');
      const row     = JSON.parse(body.split('\n')[0]!) as { n: number; _raw?: RawContentInterface };
      assert.equal(row.n, 1);
      assert.ok(row._raw !== undefined, '_raw should appear in JSONL row');
      assert.equal(row._raw.content, '<b>bold</b>');
    });

    it('does not include _raw in appended JSONL rows when page._raw is absent', async () => {
      const ctx  = { target: TARGET, outDir, config: {} };
      const task = TaskRegistry.get('jsonl:append');

      await task(noopNext, buildState({ context: ctx, output: { n: 99 } }));

      const outFile = join(outDir, TARGET, 'all.jsonl');
      const body    = await readFile(outFile, 'utf8');
      const row     = JSON.parse(body.split('\n')[0]!) as { n: number; _raw?: unknown };
      assert.equal(row.n, 99);
      assert.equal(row._raw, undefined);
    });
  });

  describe('validate:schema', () => {
    it('is a no-op when config.outputSchema is unset', async () => {
      const state = buildState({
        context: { target: TARGET, outDir, config: {} },
        output:  { anything: true },
      });
      const task = TaskRegistry.get('validate:schema');
      await task(noopNext, state);
    });

    it('passes when output matches the schema', async () => {
      const schemaPath = join(outDir, 'schema.json');
      await writeFile(schemaPath, JSON.stringify({
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' } },
      }), 'utf8');

      const state = buildState({
        context: { target: TARGET, outDir, config: { outputSchema: schemaPath } },
        output:  { name: 'goblin' },
      });
      const task = TaskRegistry.get('validate:schema');
      await task(noopNext, state);
    });

    it('throws when output violates the schema', async () => {
      const schemaPath = join(outDir, 'schema-strict.json');
      await writeFile(schemaPath, JSON.stringify({
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' } },
      }), 'utf8');

      const state = buildState({
        context: { target: TARGET, outDir, config: { outputSchema: schemaPath } },
        output:  { name: 42 },
      });
      const task = TaskRegistry.get('validate:schema');
      await assert.rejects(task(noopNext, state), (e: unknown) => e instanceof ExternalSchemaError);
    });
  });
});

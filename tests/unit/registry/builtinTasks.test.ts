import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

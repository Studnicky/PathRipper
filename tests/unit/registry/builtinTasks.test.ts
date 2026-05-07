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
    it('writes html to <outDir>/<target>/raw/<url-slug>.html (URL-based filename)', async () => {
      // URL https://example.test/page -> slug "page"
      const state = buildState({
        page:    { targetId: TARGET, title: 'Example Page!', url: 'https://example.test/page', html: '<p>raw</p>' },
        context: { target: TARGET, outDir, config: {} },
      });
      const task = TaskRegistry.get('html:write-raw');
      await task(noopNext, state);

      const expected = join(outDir, TARGET, 'raw', 'page.html');
      const body     = await readFile(expected, 'utf8');
      assert.equal(body, '<p>raw</p>');
    });

    it('writes html with query-string URL to <outDir>/<target>/raw/<url-slug>.html', async () => {
      // URL https://2e.aonprd.com/Feats.aspx?ID=750 -> slug "Feats.aspx-ID-750"
      const state = buildState({
        page:    { targetId: TARGET, title: 'Dwarven Lore', url: 'https://2e.aonprd.com/Feats.aspx?ID=750', html: '<p>feat</p>' },
        context: { target: TARGET, outDir, config: {} },
      });
      const task = TaskRegistry.get('html:write-raw');
      await task(noopNext, state);

      const expected = join(outDir, TARGET, 'raw', 'Feats.aspx-ID-750.html');
      const body     = await readFile(expected, 'utf8');
      assert.equal(body, '<p>feat</p>');
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
    it('writes pretty JSON to <outDir>/<target>/<url-slug>.json when no plugin task name', async () => {
      // No pluginTaskName: file goes to <target>/<url-slug>.json
      // URL https://x.test/page-title -> slug "page-title"
      const state = buildState({
        page:    { targetId: TARGET, title: 'Some Title 123', url: 'https://x.test/page-title' },
        context: { target: TARGET, outDir, config: {} },
        output:  { hello: 'world' },
      });
      const task = TaskRegistry.get('json:write');
      await task(noopNext, state);

      const expected = join(outDir, TARGET, 'page-title.json');
      const body     = await readFile(expected, 'utf8');
      assert.equal(body, '{\n  "hello": "world"\n}');
    });

    it('writes pretty JSON to <outDir>/<target>/<pluginTaskName>/<slug>.json when pluginTaskName is set', async () => {
      // pluginTaskName = 'aonprd:parse', URL https://2e.aonprd.com/Feats.aspx?ID=750
      const state = buildState({
        page:    { targetId: TARGET, title: 'Dwarven Lore', url: 'https://2e.aonprd.com/Feats.aspx?ID=750' },
        context: { target: TARGET, outDir, config: {}, pluginTaskName: 'aonprd:parse' },
        output:  { _type: 'feat', name: 'Dwarven Lore' },
      });
      const task = TaskRegistry.get('json:write');
      await task(noopNext, state);

      const expected = join(outDir, TARGET, 'aonprd:parse', 'Feats.aspx-ID-750.json');
      const body     = await readFile(expected, 'utf8');
      const parsed   = JSON.parse(body) as { _type: string; name: string };
      assert.equal(parsed._type, 'feat');
      assert.equal(parsed.name,  'Dwarven Lore');
    });

    it('does NOT include _raw in written JSON (raw lives in raw/ folder)', async () => {
      const raw: RawContentInterface = { contentType: 'text/html', content: '<p>hello</p>', fetchedAt: '2026-01-01T00:00:00.000Z' };
      const state = buildState({
        page:    { targetId: TARGET, title: 'Raw Page', url: 'https://example.test/raw-page', html: '<p>hello</p>', _raw: raw },
        context: { target: TARGET, outDir, config: {}, pluginTaskName: 'stub:parse' },
        output:  { name: 'Raw Page' },
      });
      const task = TaskRegistry.get('json:write');
      await task(noopNext, state);

      const expected = join(outDir, TARGET, 'stub:parse', 'raw-page.json');
      const parsed   = JSON.parse(await readFile(expected, 'utf8')) as { name: string; _raw?: unknown };
      assert.equal(parsed.name, 'Raw Page');
      assert.equal(parsed._raw, undefined, '_raw must NOT appear in plugin JSON output');
    });

    it('skips writing when output is null', async () => {
      const state = buildState({
        context: { target: TARGET, outDir, config: {} },
      });
      const task = TaskRegistry.get('json:write');
      await task(noopNext, state);

      // With URL https://example.test/page -> slug "page"
      const expected = join(outDir, TARGET, 'page.json');
      assert.equal(await exists(expected), false);
    });

    it('writes to <target>/<slug>.json (no subfolder) when splitByTaskName is false', async () => {
      const state = buildState({
        page:    { targetId: TARGET, title: 'X', url: 'https://x.test/entry' },
        context: { target: TARGET, outDir, config: {}, pluginTaskName: 'myplugin:parse', splitByTaskName: false },
        output:  { n: 42 },
      });
      const task = TaskRegistry.get('json:write');
      await task(noopNext, state);

      // splitByTaskName: false -> ignores pluginTaskName subfolder
      const expected = join(outDir, TARGET, 'entry.json');
      const parsed   = JSON.parse(await readFile(expected, 'utf8')) as { n: number };
      assert.equal(parsed.n, 42);
    });
  });

  describe('jsonl:append', () => {
    it('appends one JSON line per invocation to <outDir>/<target>/all.jsonl (no plugin)', async () => {
      const ctx  = { target: TARGET, outDir, config: {} };
      const task = TaskRegistry.get('jsonl:append');

      await task(noopNext, buildState({ context: ctx, output: { n: 1 } }));
      await task(noopNext, buildState({ context: ctx, output: { n: 2 } }));
      await task(noopNext, buildState({ context: ctx, output: { n: 3 } }));

      const expected = join(outDir, TARGET, 'all.jsonl');
      const body     = await readFile(expected, 'utf8');
      assert.equal(body, '{"n":1}\n{"n":2}\n{"n":3}\n');
    });

    it('appends to <outDir>/<target>/<pluginTaskName>/all.jsonl when pluginTaskName is set', async () => {
      const ctx  = { target: TARGET, outDir, config: {}, pluginTaskName: 'myplugin:parse' };
      const task = TaskRegistry.get('jsonl:append');

      await task(noopNext, buildState({ context: ctx, output: { n: 1 } }));
      await task(noopNext, buildState({ context: ctx, output: { n: 2 } }));

      const expected = join(outDir, TARGET, 'myplugin:parse', 'all.jsonl');
      const body     = await readFile(expected, 'utf8');
      assert.equal(body, '{"n":1}\n{"n":2}\n');
    });

    it('does NOT include _raw in appended JSONL rows', async () => {
      const raw: RawContentInterface = { contentType: 'text/html', content: '<b>bold</b>', fetchedAt: '2026-06-01T00:00:00.000Z' };
      const ctx  = { target: TARGET, outDir, config: {}, pluginTaskName: 'stub:parse' };
      const task = TaskRegistry.get('jsonl:append');

      await task(noopNext, buildState({
        page:    { targetId: TARGET, title: 'A', url: 'https://x.test/a', _raw: raw },
        context: ctx,
        output:  { n: 1 },
      }));

      const outFile = join(outDir, TARGET, 'stub:parse', 'all.jsonl');
      const body    = await readFile(outFile, 'utf8');
      const row     = JSON.parse(body.split('\n')[0]!) as { n: number; _raw?: unknown };
      assert.equal(row.n, 1);
      assert.equal(row._raw, undefined, '_raw must NOT appear in plugin JSONL output');
    });
  });

  describe('html:fetch + includeRawContent', () => {
    it('sets _raw on state.page by default (includeRawContent absent)', async () => {
      const HTML = '<html><body>raw test</body></html>';
      const scraper = new FakeHtmlScraper({
        url:  'https://example.test/page-resolved',
        html: HTML,
        $: ((): unknown => ({}))() as unknown as ScrapedPageInterface['$'],
      });
      const state = buildState({
        context: { target: TARGET, outDir, scraper: scraper as unknown as never, config: {} },
      });

      const task = TaskRegistry.get('html:fetch');
      await task(noopNext, state);

      assert.ok(state.page._raw !== undefined, '_raw should be set by default');
      const raw = state.page._raw as RawContentInterface;
      assert.equal(raw.contentType, 'text/html');
      assert.equal(raw.content, HTML);
      assert.ok(typeof raw.fetchedAt === 'string' && raw.fetchedAt.length > 0);
    });

    it('sets _raw on state.page when includeRawContent is explicitly true', async () => {
      const HTML = '<html><body>raw explicit</body></html>';
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

      assert.ok(state.page._raw !== undefined, '_raw should be set when explicitly opted in');
      const raw = state.page._raw as RawContentInterface;
      assert.equal(raw.contentType, 'text/html');
      assert.equal(raw.content, HTML);
    });

    it('does NOT set _raw on state.page when includeRawContent is false (opt-out)', async () => {
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

      assert.equal(state.page._raw, undefined, '_raw must be absent when opt-out is set');
    });
  });

  describe('html:fetch — no plugin step (raw dump only)', () => {
    it('produces _raw.content on state.page without any plugin task running', async () => {
      const HTML = '<html><body>no plugin</body></html>';
      const scraper = new FakeHtmlScraper({
        url:  'https://example.test/page-resolved',
        html: HTML,
        $: ((): unknown => ({}))() as unknown as ScrapedPageInterface['$'],
      });
      const state = buildState({
        context: { target: TARGET, outDir, scraper: scraper as unknown as never, config: {} },
        output:  null,
      });

      // Only html:fetch runs — no plugin parse task.
      const task = TaskRegistry.get('html:fetch');
      await task(noopNext, state);

      assert.ok(state.page._raw !== undefined, '_raw must be populated even with no plugin');
      assert.equal((state.page._raw as RawContentInterface).content, HTML);
      assert.equal(state.output, null, 'output stays null — no plugin ran to populate it');
    });
  });

  describe('URL-based filename derivation', () => {
    it('derives slug from URL path+query (Feats.aspx?ID=750)', async () => {
      // Feats.aspx?ID=750 -> Feats.aspx-ID-750
      const state = buildState({
        page:    { targetId: TARGET, title: '', url: 'https://2e.aonprd.com/Feats.aspx?ID=750', html: '<p>feat</p>' },
        context: { target: TARGET, outDir, config: {} },
      });
      const task = TaskRegistry.get('html:write-raw');
      await task(noopNext, state);
      const expected = join(outDir, TARGET, 'raw', 'Feats.aspx-ID-750.html');
      assert.equal(await exists(expected), true, `Expected file at ${expected}`);
    });

    it('derives slug from URL path+query with multiple params (Spells.aspx?ID=1042)', async () => {
      const state = buildState({
        page:    { targetId: TARGET, title: '', url: 'https://2e.aonprd.com/Spells.aspx?ID=1042', html: '<p>spell</p>' },
        context: { target: TARGET, outDir, config: {} },
      });
      const task = TaskRegistry.get('html:write-raw');
      await task(noopNext, state);
      const expected = join(outDir, TARGET, 'raw', 'Spells.aspx-ID-1042.html');
      assert.equal(await exists(expected), true, `Expected file at ${expected}`);
    });

    it('derives slug from URL with nested path (no query)', async () => {
      // /wiki/Goblin -> wiki-Goblin
      const state = buildState({
        page:    { targetId: TARGET, title: '', url: 'https://example.com/wiki/Goblin', html: '<p>g</p>' },
        context: { target: TARGET, outDir, config: {} },
      });
      const task = TaskRegistry.get('html:write-raw');
      await task(noopNext, state);
      const expected = join(outDir, TARGET, 'raw', 'wiki-Goblin.html');
      assert.equal(await exists(expected), true, `Expected file at ${expected}`);
    });

    it('falls back to title-based slug when URL is empty', async () => {
      // No URL (wiki page), title = 'Goblin Warrior'
      const state = buildState({
        page:    { targetId: TARGET, title: 'Goblin Warrior', url: '', wikitext: '==Goblin==', html: undefined },
        context: { target: TARGET, outDir, config: {} },
      });
      const task = TaskRegistry.get('wiki:write-raw');
      await task(noopNext, state);
      const expected = join(outDir, TARGET, 'raw', 'goblin-warrior.txt');
      assert.equal(await exists(expected), true, `Expected file at ${expected}`);
    });
  });

  describe('folder split — plugin vs no-plugin pipelines', () => {
    it('json:write without plugin produces file directly under <target>/ (no subfolder)', async () => {
      // No pluginTaskName: simulates a pipeline with no plugin step
      const state = buildState({
        page:    { targetId: TARGET, title: 'T', url: 'https://x.test/entry-a' },
        context: { target: TARGET, outDir, config: {} },
        output:  { raw_only: true },
      });
      const task = TaskRegistry.get('json:write');
      await task(noopNext, state);

      const expected = join(outDir, TARGET, 'entry-a.json');
      assert.equal(await exists(expected), true, `Expected ${expected}`);
      // No plugin subfolder should exist
      const pluginDir = join(outDir, TARGET, 'plugin');
      assert.equal(await exists(pluginDir), false, 'No plugin subfolder when no plugin task');
    });

    it('json:write with plugin produces file under <target>/<pluginTaskName>/ subfolder', async () => {
      const state = buildState({
        page:    { targetId: TARGET, title: 'T', url: 'https://x.test/entry-b' },
        context: { target: TARGET, outDir, config: {}, pluginTaskName: 'aonprd:parse' },
        output:  { _type: 'feat' },
      });
      const task = TaskRegistry.get('json:write');
      await task(noopNext, state);

      const expected = join(outDir, TARGET, 'aonprd:parse', 'entry-b.json');
      assert.equal(await exists(expected), true, `Expected ${expected}`);
    });

    it('multiple plugin task names produce sibling folders', async () => {
      const taskA = TaskRegistry.get('json:write');
      const taskB = TaskRegistry.get('json:write');

      await taskA(noopNext, buildState({
        page:    { targetId: TARGET, title: 'X', url: 'https://x.test/r1' },
        context: { target: TARGET, outDir, config: {}, pluginTaskName: 'aonprd-feats:parse' },
        output:  { _type: 'feat' },
      }));

      await taskB(noopNext, buildState({
        page:    { targetId: TARGET, title: 'Y', url: 'https://x.test/r2' },
        context: { target: TARGET, outDir, config: {}, pluginTaskName: 'aonprd-spells:parse' },
        output:  { _type: 'spell' },
      }));

      assert.equal(await exists(join(outDir, TARGET, 'aonprd-feats:parse', 'r1.json')),  true);
      assert.equal(await exists(join(outDir, TARGET, 'aonprd-spells:parse', 'r2.json')), true);
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

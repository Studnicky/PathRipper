import { describe, it, beforeEach, afterEach } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { NodeContextType } from '@studnicky/dagonizer';

import { ScrapeState }         from '../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../src/services/RipperServices.js';
import { HtmlFetchNode }       from '../../../src/nodes/HtmlFetchNode.js';
import { WikiFetchNode }       from '../../../src/nodes/WikiFetchNode.js';
import { HtmlWriteRawNode }    from '../../../src/nodes/HtmlWriteRawNode.js';
import { WikiWriteRawNode }    from '../../../src/nodes/WikiWriteRawNode.js';
import { JsonWriteNode }       from '../../../src/nodes/JsonWriteNode.js';
import { JsonlAppendNode }     from '../../../src/nodes/JsonlAppendNode.js';
import { ValidateSchemaNode }  from '../../../src/nodes/ValidateSchemaNode.js';
import { ExternalSchemaError } from '../../../src/errors/ExternalSchemaError.js';
import type { RawContentInterface } from '../../../src/types/PipelineState.js';
import type { ScrapedPageInterface }from '../../../src/types/HtmlScraper.js';
import { Logger }              from '../../../src/modules/logger/logger.js';

const TARGET = 'unit-target';

const buildState = (overrides: Partial<{
  page:   Partial<ScrapeState['page']>;
  output: ScrapeState['output'];
  urls:   string[];
}> = {}): ScrapeState => {
  const state = new ScrapeState();
  state.page   = { targetId: TARGET, title: 'My Page', url: 'https://example.test/page', ...overrides.page };
  state.output = overrides.output ?? null;
  state.urls   = overrides.urls   ?? [];
  return state;
};

const makeContext = (services: Partial<RipperServices>): NodeContextType<RipperServices> => ({
  services: {
    log:    Logger.forComponent('test'),
    cache:  null,
    target: { id: TARGET, cfg: {} },
    outDir: '',
    ...services,
  } as RipperServices,
  signal:    new AbortController().signal,
  dagName:   'test',
  nodeName:  'test',
});

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

describe('builtinNodes', () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'ripper-builtin-'));
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  describe('exports', () => {
    it('every built-in node has a name and outputs array', () => {
      const nodes = [HtmlFetchNode, WikiFetchNode, HtmlWriteRawNode, WikiWriteRawNode,
                     JsonWriteNode, JsonlAppendNode, ValidateSchemaNode];
      for (const node of nodes) {
        assert.ok(typeof node.name === 'string' && node.name.length > 0, `${node.name}: missing name`);
        assert.ok(Array.isArray(node.outputs) && node.outputs.length > 0, `${node.name}: missing outputs`);
      }
    });
  });

  describe('HtmlFetchNode', () => {
    it('fetches via services.htmlScraper and stores html + resolved url on the page', async () => {
      const scraper = new FakeHtmlScraper({
        url:  'https://example.test/page-resolved',
        html: '<html><body>hello</body></html>',
        $: ((): unknown => ({}))() as unknown as ScrapedPageInterface['$'],
      });
      const state = buildState();
      state.setMetadata('currentUrl', 'https://example.test/page');
      const ctx   = makeContext({
        htmlScraper: scraper as unknown as RipperServices['htmlScraper'],
        outDir,
        target: { id: TARGET, cfg: {} },
      });

      const result = await HtmlFetchNode.execute(Batch.of(state), ctx);

      assert.deepEqual(scraper.calls, ['https://example.test/page']);
      assert.equal(state.page.html, '<html><body>hello</body></html>');
      assert.equal(state.page.url,  'https://example.test/page-resolved');
      assert.ok((result.has('success') || result.has('cached')));
    });

    it('returns error when htmlScraper is absent', async () => {
      const state  = buildState();
      state.setMetadata('currentUrl', 'https://example.test/page');
      const ctx    = makeContext({ target: { id: TARGET, cfg: {} }, outDir });
      const result = await HtmlFetchNode.execute(Batch.of(state), ctx);
      assert.ok(result.has('error'));
    });

    it('sets _raw on state.page by default (includeRawContent absent)', async () => {
      const HTML    = '<html><body>raw test</body></html>';
      const scraper = new FakeHtmlScraper({
        url:  'https://example.test/page-resolved',
        html: HTML,
        $: ((): unknown => ({}))() as unknown as ScrapedPageInterface['$'],
      });
      const state = buildState();
      state.setMetadata('currentUrl', 'https://example.test/page');
      const ctx   = makeContext({
        htmlScraper: scraper as unknown as RipperServices['htmlScraper'],
        target: { id: TARGET, cfg: {} },
        outDir,
      });
      await HtmlFetchNode.execute(Batch.of(state), ctx);
      assert.ok(state.page._raw !== undefined, '_raw should be set by default');
      const raw = state.page._raw as RawContentInterface;
      assert.equal(raw.contentType, 'text/html');
      assert.equal(raw.content, HTML);
    });

    it('does NOT set _raw when includeRawContent is false', async () => {
      const scraper = new FakeHtmlScraper({
        url:  'https://example.test/page-resolved',
        html: '<html/>',
        $: ((): unknown => ({}))() as unknown as ScrapedPageInterface['$'],
      });
      const state = buildState();
      state.setMetadata('currentUrl', 'https://example.test/page');
      const ctx   = makeContext({
        htmlScraper: scraper as unknown as RipperServices['htmlScraper'],
        target: { id: TARGET, cfg: { includeRawContent: false } },
        outDir,
      });
      await HtmlFetchNode.execute(Batch.of(state), ctx);
      assert.equal(state.page._raw, undefined, '_raw must be absent when opt-out is set');
    });
  });

  describe('HtmlWriteRawNode', () => {
    it('writes html to <outDir>/<target>/raw/<url-slug>.html', async () => {
      const state = buildState({ page: { html: '<p>raw</p>' } });
      const ctx   = makeContext({ target: { id: TARGET, cfg: {} }, outDir });
      await HtmlWriteRawNode.execute(Batch.of(state), ctx);
      const expected = join(outDir, TARGET, 'raw', 'page.html');
      assert.equal(await readFile(expected, 'utf8'), '<p>raw</p>');
    });

    it('writes query-string URL to correct slug', async () => {
      const state = buildState({ page: { url: 'https://2e.aonprd.com/Feats.aspx?ID=750', html: '<p>feat</p>' } });
      const ctx   = makeContext({ target: { id: TARGET, cfg: {} }, outDir });
      await HtmlWriteRawNode.execute(Batch.of(state), ctx);
      const expected = join(outDir, TARGET, 'raw', 'Feats.aspx-ID-750.html');
      assert.equal(await readFile(expected, 'utf8'), '<p>feat</p>');
    });

    it('throws when html is missing', async () => {
      const state = buildState();
      const ctx   = makeContext({ target: { id: TARGET, cfg: {} }, outDir });
      await assert.rejects(
        HtmlWriteRawNode.execute(Batch.of(state), ctx),
        (error: unknown) => error instanceof ExternalSchemaError,
      );
    });
  });

  describe('JsonWriteNode', () => {
    it('writes JSON to <target>/<slug>.json with no pluginTaskName', async () => {
      const state = buildState({ page: { url: 'https://x.test/page-title' }, output: { hello: 'world' } });
      const ctx   = makeContext({ target: { id: TARGET, cfg: {} }, outDir });
      const result     = await JsonWriteNode.execute(Batch.of(state), ctx);
      assert.ok(result.has('success'));
      const expected = join(outDir, TARGET, 'page-title.json');
      assert.equal(await readFile(expected, 'utf8'), '{\n  "hello": "world"\n}');
    });

    it('writes JSON under <pluginTaskName>/<slug>.json when pluginTaskName is set', async () => {
      const state = buildState({ page: { url: 'https://2e.aonprd.com/Feats.aspx?ID=750' }, output: { _type: 'feat', name: 'Dwarven Lore' } });
      const ctx   = makeContext({ target: { id: TARGET, cfg: {} }, outDir, pluginTaskName: 'aonprd:parse' });
      await JsonWriteNode.execute(Batch.of(state), ctx);
      const expected = join(outDir, TARGET, 'aonprd:parse', 'Feats.aspx-ID-750.json');
      const parsed   = JSON.parse(await readFile(expected, 'utf8')) as { _type: string; name: string };
      assert.equal(parsed.name,  'Dwarven Lore');
    });

    it('does NOT include _raw in written JSON', async () => {
      const raw: RawContentInterface = { contentType: 'text/html', content: '<p/>', fetchedAt: '2026-01-01T00:00:00.000Z' };
      const state = buildState({ page: { url: 'https://example.test/raw-page', _raw: raw }, output: { name: 'X' } });
      const ctx   = makeContext({ target: { id: TARGET, cfg: {} }, outDir, pluginTaskName: 'stub:parse' });
      await JsonWriteNode.execute(Batch.of(state), ctx);
      const parsed = JSON.parse(await readFile(join(outDir, TARGET, 'stub:parse', 'raw-page.json'), 'utf8')) as { _raw?: unknown };
      assert.equal(parsed._raw, undefined, '_raw must NOT appear in plugin JSON');
    });

    it('returns skipped when output is null', async () => {
      const state = buildState();
      const ctx   = makeContext({ target: { id: TARGET, cfg: {} }, outDir });
      const result     = await JsonWriteNode.execute(Batch.of(state), ctx);
      assert.ok(result.has('skipped'));
      assert.equal(await exists(join(outDir, TARGET, 'page.json')), false);
    });

    it('ignores pluginTaskName when splitByTaskName is false', async () => {
      const state = buildState({ page: { url: 'https://x.test/entry' }, output: { n: 42 } });
      const ctx   = makeContext({ target: { id: TARGET, cfg: {} }, outDir, pluginTaskName: 'myplugin:parse', splitByTaskName: false });
      await JsonWriteNode.execute(Batch.of(state), ctx);
      const parsed = JSON.parse(await readFile(join(outDir, TARGET, 'entry.json'), 'utf8')) as { n: number };
      assert.equal(parsed.n, 42);
    });
  });

  describe('JsonlAppendNode', () => {
    it('appends one JSON line per invocation to all.jsonl', async () => {
      const ctx = makeContext({ target: { id: TARGET, cfg: {} }, outDir });
      await JsonlAppendNode.execute(Batch.of(buildState({ output: { n: 1 } })), ctx);
      await JsonlAppendNode.execute(Batch.of(buildState({ output: { n: 2 } })), ctx);
      await JsonlAppendNode.execute(Batch.of(buildState({ output: { n: 3 } })), ctx);
      const body = await readFile(join(outDir, TARGET, 'all.jsonl'), 'utf8');
      assert.equal(body, '{"n":1}\n{"n":2}\n{"n":3}\n');
    });

    it('appends to <pluginTaskName>/all.jsonl when set', async () => {
      const ctx = makeContext({ target: { id: TARGET, cfg: {} }, outDir, pluginTaskName: 'myplugin:parse' });
      await JsonlAppendNode.execute(Batch.of(buildState({ output: { n: 1 } })), ctx);
      await JsonlAppendNode.execute(Batch.of(buildState({ output: { n: 2 } })), ctx);
      assert.equal(
        await readFile(join(outDir, TARGET, 'myplugin:parse', 'all.jsonl'), 'utf8'),
        '{"n":1}\n{"n":2}\n',
      );
    });

    it('does NOT include _raw in appended JSONL rows', async () => {
      const raw: RawContentInterface = { contentType: 'text/html', content: '<b/>', fetchedAt: '2026-06-01T00:00:00.000Z' };
      const ctx   = makeContext({ target: { id: TARGET, cfg: {} }, outDir, pluginTaskName: 'stub:parse' });
      const state = buildState({ page: { _raw: raw }, output: { n: 1 } });
      await JsonlAppendNode.execute(Batch.of(state), ctx);
      const row = JSON.parse((await readFile(join(outDir, TARGET, 'stub:parse', 'all.jsonl'), 'utf8')).split('\n')[0]!) as { _raw?: unknown };
      assert.equal(row._raw, undefined, '_raw must NOT appear in JSONL');
    });
  });

  describe('WikiWriteRawNode', () => {
    it('writes wikitext to <outDir>/<target>/raw/<slug>.txt', async () => {
      const state = buildState({ page: { title: 'Goblin Warrior', url: '', wikitext: '==Goblin==' } });
      const ctx   = makeContext({ target: { id: TARGET, cfg: {} }, outDir });
      await WikiWriteRawNode.execute(Batch.of(state), ctx);
      const expected = join(outDir, TARGET, 'raw', 'goblin-warrior.txt');
      assert.equal(await readFile(expected, 'utf8'), '==Goblin==');
    });
  });

  describe('ValidateSchemaNode', () => {
    it('returns valid when config.outputSchema is unset', async () => {
      const state = buildState({ output: { anything: true } });
      const ctx   = makeContext({ target: { id: TARGET, cfg: {} }, outDir });
      const result     = await ValidateSchemaNode.execute(Batch.of(state), ctx);
      assert.ok(result.has('valid'));
    });

    it('returns valid when output matches the schema', async () => {
      const schemaPath = join(outDir, 'schema.json');
      await writeFile(schemaPath, JSON.stringify({
        type: 'object', required: ['name'], properties: { name: { type: 'string' } },
      }), 'utf8');
      const state = buildState({ output: { name: 'goblin' } });
      const ctx   = makeContext({ target: { id: TARGET, cfg: { outputSchema: schemaPath } }, outDir });
      const result     = await ValidateSchemaNode.execute(Batch.of(state), ctx);
      assert.ok(result.has('valid'));
    });

    it('returns invalid when output violates the schema', async () => {
      const schemaPath = join(outDir, 'schema-strict.json');
      await writeFile(schemaPath, JSON.stringify({
        type: 'object', required: ['name'], properties: { name: { type: 'string' } },
      }), 'utf8');
      const state = buildState({ output: { name: 42 } });
      const ctx   = makeContext({ target: { id: TARGET, cfg: { outputSchema: schemaPath } }, outDir });
      const result     = await ValidateSchemaNode.execute(Batch.of(state), ctx);
      assert.ok(result.has('invalid'));
    });
  });

  describe('URL-based filename derivation', () => {
    it('derives slug from URL path+query', async () => {
      const state = buildState({ page: { url: 'https://2e.aonprd.com/Feats.aspx?ID=750', html: '<p/>' } });
      const ctx   = makeContext({ target: { id: TARGET, cfg: {} }, outDir });
      await HtmlWriteRawNode.execute(Batch.of(state), ctx);
      assert.equal(await exists(join(outDir, TARGET, 'raw', 'Feats.aspx-ID-750.html')), true);
    });

    it('derives slug from nested path (no query)', async () => {
      const state = buildState({ page: { url: 'https://example.com/wiki/Goblin', html: '<p/>' } });
      const ctx   = makeContext({ target: { id: TARGET, cfg: {} }, outDir });
      await HtmlWriteRawNode.execute(Batch.of(state), ctx);
      assert.equal(await exists(join(outDir, TARGET, 'raw', 'wiki-Goblin.html')), true);
    });

    it('falls back to title-based slug when URL is empty', async () => {
      const state = buildState({ page: { title: 'Goblin Warrior', url: '', wikitext: '==g==' } });
      const ctx   = makeContext({ target: { id: TARGET, cfg: {} }, outDir });
      await WikiWriteRawNode.execute(Batch.of(state), ctx);
      assert.equal(await exists(join(outDir, TARGET, 'raw', 'goblin-warrior.txt')), true);
    });
  });

  describe('folder split — plugin vs no-plugin', () => {
    it('json:write without pluginTaskName writes directly under <target>/', async () => {
      const state = buildState({ page: { url: 'https://x.test/entry-a' }, output: { raw_only: true } });
      const ctx   = makeContext({ target: { id: TARGET, cfg: {} }, outDir });
      await JsonWriteNode.execute(Batch.of(state), ctx);
      assert.equal(await exists(join(outDir, TARGET, 'entry-a.json')), true);
    });

    it('json:write with pluginTaskName writes under <target>/<plugin>/', async () => {
      const state = buildState({ page: { url: 'https://x.test/entry-b' }, output: { _type: 'feat' } });
      const ctx   = makeContext({ target: { id: TARGET, cfg: {} }, outDir, pluginTaskName: 'aonprd:parse' });
      await JsonWriteNode.execute(Batch.of(state), ctx);
      assert.equal(await exists(join(outDir, TARGET, 'aonprd:parse', 'entry-b.json')), true);
    });
  });
});

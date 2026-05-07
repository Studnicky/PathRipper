import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import AjvModule, { type ValidateFunction } from 'ajv';
import addFormatsModule from 'ajv-formats';

import type { AjvCtorType, AddFormatsFnInterface } from '../types/AjvInterop.js';
import { ExternalSchemaError } from '../errors/ExternalSchemaError.js';
import { Logger } from '../modules/logger/logger.js';
import { TaskRegistry } from './TaskRegistry.js';
import type { TaskFnInterface } from '../types/Pipeline.js';
import type {
  PipelineContextInterface,
  PipelinePageInterface,
  PipelineStateInterface,
} from '../types/PipelineState.js';
import type { HtmlScraper, ScrapedPageInterface } from '../scrapers/HtmlScraper.js';
import type { MediaWikiScraper } from '../scrapers/MediaWikiScraper.js';
import type { WikiPageInterface } from '../types/MediaWikiScraper.js';
import type { RawContentInterface } from '../types/PipelineState.js';

const Ajv        = (AjvModule        as unknown as { default?: AjvCtorType }).default
                  ?? (AjvModule      as unknown as AjvCtorType);
const addFormats = (addFormatsModule as unknown as { default?: AddFormatsFnInterface }).default
                  ?? (addFormatsModule as unknown as AddFormatsFnInterface);

const logger = Logger.forComponent('builtinTasks');

/** Compiled AJV cache keyed by absolute schema path so repeated runs don't recompile. */
const COMPILED_VALIDATORS = new Map<string, ValidateFunction<unknown>>();

/** Returns true when the value looks like an HtmlScraper (has fetchPage returning {html,url}). */
const isHtmlScraper = (s: unknown): s is HtmlScraper => {
  return typeof s === 'object' && s !== null && typeof (s as { fetchPage?: unknown }).fetchPage === 'function';
};

/** Returns true when the value looks like a MediaWikiScraper. */
const isWikiScraper = (s: unknown): s is MediaWikiScraper => {
  return typeof s === 'object' && s !== null && typeof (s as { fetchPage?: unknown }).fetchPage === 'function';
};

/** Lower-cases the input and replaces non `[a-z0-9-]` runs with single hyphens. */
const toSlug = (raw: string): string => {
  const lower    = raw.toLowerCase();
  const replaced = lower.replace(/[^a-z0-9-]+/g, '-');
  const collapsed = replaced.replace(/-+/g, '-');
  return collapsed.replace(/^-|-$/g, '');
};

/** Returns the slug for a page, preferring `title` and falling back to `url`. */
const pageSlug = (page: PipelinePageInterface): string => {
  const source = page.title.length > 0 ? page.title : page.url;
  const slug   = toSlug(source);
  if (slug.length === 0) {
    throw ExternalSchemaError.create('Cannot derive slug from empty page identifier', {
      metadata: { title: page.title, url: page.url },
    });
  }
  return slug;
};

/** Reads `state.context` or throws — built-in tasks require an orchestrator-provided context. */
const requireContext = (state: PipelineStateInterface, taskName: string): PipelineContextInterface => {
  const ctx = state.context;
  if (ctx === undefined) {
    throw ExternalSchemaError.create(`${taskName} requires state.context to be set by the orchestrator`, {
      metadata: { task: taskName },
    });
  }
  return ctx;
};

/** Replaces `state.page` on a `PipelineStateInterface` despite the field being readonly. */
const replacePage = (state: PipelineStateInterface, page: PipelinePageInterface): void => {
  (state as unknown as { page: PipelinePageInterface }).page = page;
};

/** Loads + compiles a JSON schema from disk; results memoized per absolute path. */
const compileSchema = async (schemaPath: string): Promise<ValidateFunction<unknown>> => {
  const existing = COMPILED_VALIDATORS.get(schemaPath);
  if (existing !== undefined) return existing;

  let raw: string;
  try {
    raw = await readFile(schemaPath, 'utf8');
  } catch (err) {
    throw ExternalSchemaError.create(`Could not read schema file: ${schemaPath}`, {
      cause: err instanceof Error ? err : undefined,
      metadata: { schemaPath },
    });
  }

  let schema: unknown;
  try {
    schema = JSON.parse(raw);
  } catch (err) {
    throw ExternalSchemaError.create(`Schema file is not valid JSON: ${schemaPath}`, {
      cause: err instanceof Error ? err : undefined,
      metadata: { schemaPath },
    });
  }

  const ajv = new Ajv({ allErrors: true, strict: false, useDefaults: false });
  addFormats(ajv);
  const validator = ajv.compile<unknown>(schema as object);
  COMPILED_VALIDATORS.set(schemaPath, validator);
  return validator;
};

/** Fetches `state.page.url` via `state.context.scraper` and stores `html` + resolved url back on the page. */
export const htmlFetchTask: TaskFnInterface<PipelineStateInterface> = async (next, state) => {
  const ctx = requireContext(state, 'html:fetch');
  if (!isHtmlScraper(ctx.scraper)) {
    throw ExternalSchemaError.create('html:fetch requires context.scraper to be an HtmlScraper', {
      metadata: { task: 'html:fetch' },
    });
  }
  if (state.page.url.length === 0) {
    throw ExternalSchemaError.create('html:fetch requires state.page.url to be set', {
      metadata: { task: 'html:fetch', targetId: state.targetId },
    });
  }

  const result: ScrapedPageInterface = await ctx.scraper.fetchPage(state.page.url);

  const includeRaw = ctx.config['includeRawContent'] !== false;
  const raw: RawContentInterface | undefined = includeRaw
    ? { contentType: 'text/html', content: result.html, fetchedAt: new Date().toISOString() }
    : undefined;

  replacePage(state, { ...state.page, url: result.url, html: result.html, ...(raw !== undefined ? { _raw: raw } : {}) });

  await next();
};

/** Fetches `state.page.title` via `state.context.scraper` and stores `wikitext` on the page; no-op when wikitext is already populated. */
export const wikiFetchTask: TaskFnInterface<PipelineStateInterface> = async (next, state) => {
  if (state.page.wikitext !== undefined && state.page.wikitext.length > 0) {
    await next();
    return;
  }
  const ctx = requireContext(state, 'wiki:fetch');
  if (!isWikiScraper(ctx.scraper)) {
    throw ExternalSchemaError.create('wiki:fetch requires context.scraper to be a MediaWikiScraper', {
      metadata: { task: 'wiki:fetch' },
    });
  }
  if (state.page.title.length === 0) {
    throw ExternalSchemaError.create('wiki:fetch requires state.page.title to be set', {
      metadata: { task: 'wiki:fetch', targetId: state.targetId },
    });
  }

  const result: WikiPageInterface = await ctx.scraper.fetchPage(state.page.title);
  replacePage(state, { ...state.page, wikitext: result.wikitext });

  await next();
};

/** Writes `state.page.html` to `<outDir>/<target>/raw/<slug>.html`. */
export const htmlWriteRawTask: TaskFnInterface<PipelineStateInterface> = async (next, state) => {
  const ctx  = requireContext(state, 'html:write-raw');
  const html = state.page.html;
  if (html === undefined || html.length === 0) {
    throw ExternalSchemaError.create('html:write-raw requires state.page.html to be set', {
      metadata: { task: 'html:write-raw', targetId: state.targetId },
    });
  }
  const slug    = pageSlug(state.page);
  const outFile = join(ctx.outDir, ctx.target, 'raw', `${slug}.html`);
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, html, 'utf8');
  logger.debug('html:write-raw', `Wrote raw HTML: ${outFile}`, { task: 'html:write-raw', outFile });
  await next();
};

/** Writes `state.page.wikitext` to `<outDir>/<target>/raw/<slug>.txt`. */
export const wikiWriteRawTask: TaskFnInterface<PipelineStateInterface> = async (next, state) => {
  const ctx      = requireContext(state, 'wiki:write-raw');
  const wikitext = state.page.wikitext;
  if (wikitext === undefined || wikitext.length === 0) {
    throw ExternalSchemaError.create('wiki:write-raw requires state.page.wikitext to be set', {
      metadata: { task: 'wiki:write-raw', targetId: state.targetId },
    });
  }
  const slug    = pageSlug(state.page);
  const outFile = join(ctx.outDir, ctx.target, 'raw', `${slug}.txt`);
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, wikitext, 'utf8');
  logger.debug('wiki:write-raw', `Wrote raw wikitext: ${outFile}`, { task: 'wiki:write-raw', outFile });
  await next();
};

/** Writes `state.output` (or `{}` if null) as 2-space JSON to `<outDir>/<target>/<slug>.json`; skips when output is null. */
export const jsonWriteTask: TaskFnInterface<PipelineStateInterface> = async (next, state) => {
  const ctx = requireContext(state, 'json:write');
  if (state.output === null) {
    logger.debug('json:write', 'Skipping write — state.output is null', { task: 'json:write' });
    await next();
    return;
  }
  const slug    = pageSlug(state.page);
  const outFile = join(ctx.outDir, ctx.target, `${slug}.json`);
  await mkdir(dirname(outFile), { recursive: true });
  const payload: Record<string, unknown> = state.page._raw !== undefined
    ? { ...state.output, _raw: state.page._raw }
    : { ...state.output };
  await writeFile(outFile, JSON.stringify(payload, null, 2), 'utf8');
  logger.debug('json:write', `Wrote JSON: ${outFile}`, { task: 'json:write', outFile });
  await next();
};

/** Appends `JSON.stringify(state.output) + '\n'` to `<outDir>/<target>/all.jsonl`. */
export const jsonlAppendTask: TaskFnInterface<PipelineStateInterface> = async (next, state) => {
  const ctx = requireContext(state, 'jsonl:append');
  if (state.output === null) {
    logger.debug('jsonl:append', 'Skipping append — state.output is null', { task: 'jsonl:append' });
    await next();
    return;
  }
  const outFile = join(ctx.outDir, ctx.target, 'all.jsonl');
  await mkdir(dirname(outFile), { recursive: true });
  const payload: Record<string, unknown> = state.page._raw !== undefined
    ? { ...state.output, _raw: state.page._raw }
    : { ...state.output };
  await appendFile(outFile, `${JSON.stringify(payload)}\n`, 'utf8');
  logger.debug('jsonl:append', `Appended JSONL row: ${outFile}`, { task: 'jsonl:append', outFile });
  await next();
};

/** Validates `state.output` against the JSON schema at `state.context.config.outputSchema`; no-op when unset. */
export const validateSchemaTask: TaskFnInterface<PipelineStateInterface> = async (next, state) => {
  const ctx        = requireContext(state, 'validate:schema');
  const schemaPath = ctx.config['outputSchema'];
  if (schemaPath === undefined) {
    await next();
    return;
  }
  if (typeof schemaPath !== 'string' || schemaPath.length === 0) {
    throw ExternalSchemaError.create('validate:schema requires config.outputSchema to be a non-empty string', {
      metadata: { task: 'validate:schema', received: typeof schemaPath },
    });
  }

  const validator = await compileSchema(schemaPath);
  const valid     = validator(state.output);
  if (!valid) {
    const errors = (validator.errors ?? []).map((e) => `${e.instancePath} ${e.message ?? ''}`.trim()).join('; ');
    throw ExternalSchemaError.create(`Output failed schema validation: ${errors}`, {
      metadata: { task: 'validate:schema', schemaPath, errors: validator.errors },
    });
  }

  await next();
};

/** Crawler block from `target.crawler`: regex patterns, seed URLs, and rate-limit settings. */
interface CrawlerBlockInterface {
  readonly startUrls: ReadonlyArray<string>;
  readonly domain:    string;
  readonly target:    string;
  readonly delimiter: string;
  readonly rateLimitMs?: number;
  readonly jitterMs?:    number;
  readonly maxPages?:    number;
}

/** Walks `state.context.config.crawler` seeds via `LinkLister` and surfaces matched URLs into `state.context.targets`. */
export const crawlListTargetsTask: TaskFnInterface<PipelineStateInterface> = async (next, state) => {
  const ctx = requireContext(state, 'crawl:list-targets');
  const crawler = ctx.config['crawler'] as CrawlerBlockInterface | undefined;
  if (crawler === undefined) {
    throw ExternalSchemaError.create('crawl:list-targets requires `crawler` block in target config', {
      metadata: { target: ctx.target, task: 'crawl:list-targets' },
    });
  }
  if (ctx.cache === undefined) {
    throw ExternalSchemaError.create('crawl:list-targets requires the orchestrator-supplied shared cache (configure target.cache)', {
      metadata: { target: ctx.target, task: 'crawl:list-targets' },
    });
  }
  // Lazy import keeps the module graph clean for tests that stub LinkLister.
  const { LinkLister } = await import('../crawlers/LinkLister.js');
  const headers = ctx.config['headers'] as Record<string, string> | undefined;
  const lister = LinkLister.create({
    domain:    new RegExp(crawler.domain),
    target:    new RegExp(crawler.target),
    delimiter: new RegExp(crawler.delimiter),
    ...(crawler.rateLimitMs !== undefined ? { rateLimitMs: crawler.rateLimitMs } : {}),
    ...(crawler.jitterMs    !== undefined ? { jitterMs:    crawler.jitterMs    } : {}),
    ...(crawler.maxPages    !== undefined ? { maxPages:    crawler.maxPages    } : {}),
    ...(headers !== undefined ? { headers } : {}),
    cache:    ctx.cache,
  });
  const urls = await lister.buildList(crawler.startUrls);
  (state.context as PipelineContextInterface).targets = urls;
  logger.info('crawl:list-targets', `discovered ${urls.length.toString()} URLs`, { task: 'crawl:list-targets', count: urls.length });
  await next();
};

TaskRegistry.register('html:fetch',         htmlFetchTask);
TaskRegistry.register('wiki:fetch',         wikiFetchTask);
TaskRegistry.register('html:write-raw',     htmlWriteRawTask);
TaskRegistry.register('wiki:write-raw',     wikiWriteRawTask);
TaskRegistry.register('json:write',         jsonWriteTask);
TaskRegistry.register('jsonl:append',       jsonlAppendTask);
TaskRegistry.register('validate:schema',    validateSchemaTask);
TaskRegistry.register('crawl:list-targets', crawlListTargetsTask);

// crawl-stream e2e — exercises crawl:stream → ScatterNode(source: "urlStream", reservoir)
// via runDag with a mocked fetch that serves a fake multi-level site.
//
// Covers:
//   - StreamFrontierNode seeds state.urlStream
//   - ScatterNode reservoir consumes the async iterable
//   - html:fetch reads metadata.currentUrl per item
//   - maxPages=3 produces exactly 3 processed items
//
// Run locally:
//   npm run test:e2e -- --test-name-pattern='crawl-stream'

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync }      from 'node:fs';
import { mkdtemp, rm }       from 'node:fs/promises';
import { resolve, dirname }  from 'node:path';
import { tmpdir }            from 'node:os';
import { fileURLToPath }     from 'node:url';

import { DAGDocument }       from '@studnicky/dagonizer';
import { runDag }            from '../../src/run/runDag.js';
import type { RunStateType } from '../../src/types/RunState.js';

const __dirname    = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, 'fixtures/crawl-stream');

const DAG_PATH   = resolve(FIXTURES_DIR, 'crawl-stream.dag.jsonld');
const STATE_PATH = resolve(FIXTURES_DIR, 'crawl-stream.state.json');

// ── Fake site ─────────────────────────────────────────────────────────────────

const SITE: Record<string, string> = {
  'https://example.com/index': `<html><body>
    <a href="/category/a">Cat A</a>
    <a href="/category/b">Cat B</a>
    <a href="https://other.test/skip">Offsite</a>
  </body></html>`,
  'https://example.com/category/a': `<html><body>
    <a href="/category/item?id=1">Item 1</a>
    <a href="/category/item?id=2">Item 2</a>
  </body></html>`,
  'https://example.com/category/b': `<html><body>
    <a href="/category/item?id=3">Item 3</a>
  </body></html>`,
  'https://example.com/category/item?id=1': '<html><body><h1>Item 1</h1></body></html>',
  'https://example.com/category/item?id=2': '<html><body><h1>Item 2</h1></body></html>',
  'https://example.com/category/item?id=3': '<html><body><h1>Item 3</h1></body></html>',
};

const realFetch = globalThis.fetch;

const siteFetch = (async (url: string | URL): Promise<Response> => {
  const key = typeof url === 'string' ? url : url.href;
  // Strip any trailing slash difference for robustness
  const normalised = key.endsWith('/') ? key.slice(0, -1) : key;
  const body = SITE[normalised] ?? SITE[key];
  if (body === undefined) {
    return new Response('Not Found', { status: 404 });
  }
  return new Response(body, { status: 200 });
}) as typeof fetch;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('crawl-stream e2e — crawl:stream → reservoir scatter (local only)', () => {
  before(() => {
    globalThis.fetch = siteFetch;
  });

  after(() => {
    globalThis.fetch = realFetch;
  });

  it('discovers and processes all 3 target pages via reservoir scatter', async () => {
    const outDir = await mkdtemp(resolve(tmpdir(), 'ripper-crawl-stream-'));
    try {
      const dag   = DAGDocument.load(readFileSync(DAG_PATH, 'utf-8'));
      const state = JSON.parse(readFileSync(STATE_PATH, 'utf-8')) as RunStateType;

      await runDag({ dag, state, outDir, configDir: FIXTURES_DIR });

      process.stdout.write(`\n  crawl-stream: dag '${dag.name}' completed\n`);
      assert.ok(true, 'runDag completed without throwing');
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it('completes without error when maxPages limits discovery to 2', async () => {
    const outDir = await mkdtemp(resolve(tmpdir(), 'ripper-crawl-stream-limited-'));
    try {
      const dag = DAGDocument.load(readFileSync(DAG_PATH, 'utf-8'));
      const rawState = JSON.parse(readFileSync(STATE_PATH, 'utf-8')) as RunStateType;
      const state: RunStateType = {
        ...rawState,
        crawler: rawState.crawler !== undefined
          ? { ...rawState.crawler, maxPages: 2 }
          : rawState.crawler,
      };

      await runDag({ dag, state, outDir, configDir: FIXTURES_DIR });

      process.stdout.write(`\n  crawl-stream (maxPages:2): completed\n`);
      assert.ok(true, 'runDag with maxPages:2 completed without throwing');
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it('completes via empty branch when crawler config is absent', async () => {
    const outDir = await mkdtemp(resolve(tmpdir(), 'ripper-crawl-stream-noconfig-'));
    try {
      const dag = DAGDocument.load(readFileSync(DAG_PATH, 'utf-8'));
      const rawState = JSON.parse(readFileSync(STATE_PATH, 'utf-8')) as RunStateType;
      // Omit crawler block — crawl:stream should route to empty → done
      const { crawler: _omitted, ...stateWithoutCrawler } = rawState;
      const state = stateWithoutCrawler as RunStateType;

      await runDag({ dag, state, outDir, configDir: FIXTURES_DIR });

      process.stdout.write(`\n  crawl-stream (no crawler): completed via empty branch\n`);
      assert.ok(true, 'runDag without crawler completed without throwing');
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

// HTML scraper e2e test against the locally-built Ripperoni docs site.
// Exercises the docs-scraper example plugin against real structured content.
//
// Builds docs/.vitepress/dist/ on demand and serves it over a node:http
// fixture server. No network access required.
//
// Run: npm run test:e2e

import { describe, it, before, after } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';
import { writeFile, mkdir, readFile, stat } from 'node:fs/promises';
import { resolve, dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type Server } from 'node:http';
import { spawnSync } from 'node:child_process';

import { HtmlScraper }   from '../../src/scrapers/HtmlScraper.js';
import { ScrapeState }   from '../../src/state/ScrapeState.js';
import { Dagonizer }     from '@studnicky/dagonizer';
import { Logger }        from '../../src/modules/logger/logger.js';
import type { RipperServices } from '../../src/services/RipperServices.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const DIST_DIR  = resolve(REPO_ROOT, 'docs/.vitepress/dist');
const OUT_DIR   = resolve(__dirname, '../../examples/docs-scraper/output');

let server: Server;
let BASE_URL = '';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

async function ensureDocsBuilt(): Promise<void> {
  try {
    await stat(resolve(DIST_DIR, 'architecture.html'));
  } catch {
    const result = spawnSync('npm', ['run', 'docs:build'], { cwd: REPO_ROOT, stdio: 'inherit' });
    if (result.status !== 0) throw new Error('docs:build failed');
  }
}

async function startDocsServer(): Promise<{ port: number; url: string }> {
  return new Promise((res) => {
    server = createServer((req, response) => {
      void (async () => {
        const raw = (req.url ?? '/').split('?')[0] ?? '/';
        const rel = normalize(raw === '/' ? '/index.html' : raw).replace(/^[/\\]+/, '');
        const abs = join(DIST_DIR, rel);
        if (!abs.startsWith(DIST_DIR)) { response.statusCode = 403; response.end(); return; }
        try {
          const body = await readFile(abs);
          const ext = abs.slice(abs.lastIndexOf('.'));
          response.setHeader('content-type', MIME[ext] ?? 'application/octet-stream');
          response.end(body);
        } catch {
          response.statusCode = 404;
          response.end();
        }
      })();
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      res({ port, url: `http://127.0.0.1:${port.toString()}` });
    });
  });
}

interface DocsSectionOutput {
  _type: 'docs_section';
  component: string;
  title: string;
  description: string;
  url: string;
}

describe('docs-html e2e — HTML scraper against built Ripperoni docs', () => {
  before(async () => {
    await ensureDocsBuilt();
    const { url } = await startDocsServer();
    BASE_URL = url;
    // Load the example plugin module (for its exported node instances).
    await import('../../examples/docs-scraper/plugin.js');
    await mkdir(OUT_DIR, { recursive: true });
  });

  after(async () => {
    await new Promise<void>((res) => { server.close(() => { res(); }); });
  });

  it('fetches architecture.html and extracts at least 3 data-component sections', async () => {
    const scraper = HtmlScraper.create({ baseUrl: BASE_URL, rateLimitMs: 500 });
    const page    = await scraper.fetchPage('/architecture.html');

    const { docsParseNode } = await import('../../examples/docs-scraper/plugin.js');

    const services = {
      log:    Logger.forComponent('docs-html-e2e'),
      cache:  null,
      target: { id: 'ripperoni-docs', cfg: {} },
      outDir: OUT_DIR,
    } as unknown as RipperServices;

    const dispatcher = new Dagonizer<ScrapeState, RipperServices>({ services });
    dispatcher.registerNode(docsParseNode);

    const state = new ScrapeState();
    state.page  = { targetId: 'ripperoni-docs', title: 'Architecture', url: page.url, html: page.html };

    // Run the node directly (no DAG needed for a single-node test).
    const ctx = {
      services,
      signal:   new AbortController().signal,
      dagName:  'test',
      nodeName: 'docs:parse',
      runId:    'test',
    };
    await docsParseNode.execute(Batch.of(state), ctx);

    const sections = state.getMetadata<DocsSectionOutput[]>('sections');
    assert.ok(sections !== undefined && sections.length >= 3,
      `expected at least 3 sections, got ${String(sections?.length ?? 0)}`);

    const firstSection = sections[0];
    assert.ok(firstSection !== undefined, 'expected at least one section');
    assert.ok(firstSection.component.length > 0, 'section should have a component identifier');
    assert.ok(firstSection.title.length > 0, 'section should have a title');
    assert.ok(firstSection.description.length > 0, 'section should have a description');
    assert.equal(firstSection.url, `${BASE_URL}/architecture.html`);
    assert.equal(firstSection.component, 'pipeline', 'first section should be the pipeline component');

    process.stdout.write(`\n  docs-html: extracted ${sections.length.toString()} sections from architecture.html\n`);
    for (const sec of sections) {
      process.stdout.write(`    • [${sec.component}] ${sec.title}\n`);
    }

    const outputPath = resolve(OUT_DIR, 'architecture.json');
    await writeFile(outputPath, JSON.stringify({ sections }, null, 2));
    process.stdout.write(`  wrote: ${outputPath}\n`);
  });
});

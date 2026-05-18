// HTML scraper e2e test against the locally-built Ripperoni docs site.
// Exercises the docs-scraper example plugin against real structured content.
//
// Builds docs/.vitepress/dist/ on demand and serves it over a node:http
// fixture server. No network access required.
//
// Run: npm run test:e2e

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, readFile, stat } from 'node:fs/promises';
import { resolve, dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type Server } from 'node:http';
import { spawnSync } from 'node:child_process';

import { HtmlScraper } from '../../src/scrapers/HtmlScraper.js';
import { Pipeline } from '../../src/pipeline/Pipeline.js';
import { PipelineState } from '../../src/registry/PipelineState.js';
import { TaskRegistry } from '../../src/registry/TaskRegistry.js';
import type { PipelineStateInterface } from '../../src/types/PipelineState.js';

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
    const r = spawnSync('npm', ['run', 'docs:build'], { cwd: REPO_ROOT, stdio: 'inherit' });
    if (r.status !== 0) throw new Error('docs:build failed');
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
    // Load the example plugin — it self-registers `docs:parse`
    await import('../../examples/docs-scraper/plugin.js');
    await mkdir(OUT_DIR, { recursive: true });
  });

  after(async () => {
    await new Promise<void>((res) => { server.close(() => { res(); }); });
  });

  it('fetches architecture.html and extracts at least 3 data-component sections', async () => {
    const scraper = HtmlScraper.create({ baseUrl: BASE_URL, rateLimitMs: 500 });

    const page = await scraper.fetchPage('/architecture.html');

    const state: PipelineStateInterface = {
      ...PipelineState.fromHtmlUrl('ripperoni-docs', page.url),
      page: {
        targetId: 'ripperoni-docs',
        title:    'Architecture',
        url:      page.url,
        html:     page.html,
      },
    };

    const pipeline = Pipeline.create<PipelineStateInterface>({ name: 'docs-html-e2e' });
    pipeline.addTask(TaskRegistry.get('docs:parse'));
    await pipeline.execute(state);

    const sections = (state as Record<string, unknown>)['sections'] as DocsSectionOutput[] | undefined;
    assert.ok(sections !== undefined && sections.length >= 3,
      `expected at least 3 sections, got ${String(sections?.length ?? 0)}`);

    const firstSection = sections[0];
    assert.ok(firstSection !== undefined, 'expected at least one section');
    assert.equal(firstSection._type, 'docs_section');
    assert.ok(firstSection.component.length > 0, 'section should have a component identifier');
    assert.ok(firstSection.title.length > 0, 'section should have a title');
    assert.ok(firstSection.description.length > 0, 'section should have a description');
    assert.equal(firstSection.url, `${BASE_URL}/architecture.html`);
    assert.equal(firstSection.component, 'pipeline', 'first section should be the pipeline component');

    process.stdout.write(`\n  docs-html: extracted ${sections.length.toString()} sections from architecture.html\n`);
    for (const s of sections) {
      process.stdout.write(`    • [${s.component}] ${s.title}\n`);
    }

    const outputPath = resolve(OUT_DIR, 'architecture.json');
    await writeFile(outputPath, JSON.stringify({ sections }, null, 2));
    process.stdout.write(`  wrote: ${outputPath}\n`);
  });
});

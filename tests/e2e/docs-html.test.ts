// HTML scraper e2e test against the live PathRipper docs site.
// Exercises the docs-scraper example plugin against real structured content.
//
// Requires network access to https://studnicky.github.io/PathRipper/
//
// Run: npm run test:e2e

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HtmlScraper } from '../../src/scrapers/HtmlScraper.js';
import { Pipeline } from '../../src/pipeline/Pipeline.js';
import { PipelineState } from '../../src/registry/PipelineState.js';
import { TaskRegistry } from '../../src/registry/TaskRegistry.js';
import type { PipelineStateInterface } from '../../src/types/PipelineState.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL  = 'https://studnicky.github.io/PathRipper';
const OUT_DIR   = resolve(__dirname, '../../examples/docs-scraper/output');

interface DocsSectionOutput {
  _type: 'docs_section';
  component: string;
  title: string;
  description: string;
  url: string;
}

describe('docs-html e2e — HTML scraper against live PathRipper docs', () => {
  before(async () => {
    // Load the example plugin — it self-registers `docs:parse`
    await import('../../examples/docs-scraper/plugin.js');
    await mkdir(OUT_DIR, { recursive: true });
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

    process.stdout.write(`\n  docs-html: extracted ${sections.length.toString()} sections from architecture.html\n`);
    for (const s of sections) {
      process.stdout.write(`    • [${s.component}] ${s.title}\n`);
    }

    const outputPath = resolve(OUT_DIR, 'architecture.json');
    await writeFile(outputPath, JSON.stringify({ sections }, null, 2));
    process.stdout.write(`  wrote: ${outputPath}\n`);
  });
});

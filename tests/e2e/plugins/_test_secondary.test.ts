// E2e test for the `_test_secondary` plugin.
//
// Demonstrates the AONPRD Layer-1 capability binaries
// (`labelPairBlockNode`, `sectionWalkerNode`, `sourceRefNode`,
// `metaTagsNode`) are reusable by a non-AON plugin so long as that plugin
// supplies its own `CommonStrategy` to `makeLoadAndCommonNode`.
//
// The fixture is hand-crafted with bare `<h2>` / `<h3>` headings (no `.title`
// class) and `<div class="citation">` source blocks — neither pattern would
// be recognised by the AON strategy. The secondary strategy reads them
// directly. The fact that this test passes IS the proof that Layer 1 is now
// strategy-driven and the binary is shared.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseSecondaryHtml } from '../../../plugins/_test_secondary/parse.task.js';

const __dirname    = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR  = resolve(__dirname, 'fixtures/_test_secondary');

type SampleOutputShape = {
  _type:    string;
  url:      string;
  name:     string;
  sources:  ReadonlyArray<{ book: string | null; page: number | null; source_id: number | null; raw: string }>;
  sections: ReadonlyArray<{ heading: string; level: 2 | 3 }>;
}

describe('_test_secondary plugin — strategy reuse', () => {
  it('parses a non-AON fixture through the shared AONPRD Layer-1 capabilities', async () => {
    const html = await readFile(resolve(FIXTURE_DIR, 'sample.html'), 'utf-8');
    const url  = 'https://secondary.test/Articles.aspx?ID=1';
    const out  = await parseSecondaryHtml(html, url) as unknown as SampleOutputShape;

    assert.equal(out.url,   url);
    assert.equal(out.name,  'Sample Article');

    // ── H16 — SectionWalkerStrategy: bare `<h2>` / `<h3>` headings recognised
    const sectionHeadings = out.sections.map((sec) => sec.heading);
    assert.deepEqual(
      sectionHeadings,
      ['Overview', 'Background', 'Details'],
      'secondary strategy should walk plain h2/h3 headings without the AON .title class',
    );
    const levels = out.sections.map((sec) => sec.level);
    assert.deepEqual(levels, [2, 3, 2], 'heading levels should be preserved by the strategy');

    // ── H15 — SourceRefStrategy: `<div class="citation">` blocks recognised
    assert.equal(out.sources.length, 2, 'secondary strategy should capture both citation blocks');
    assert.deepEqual(out.sources[0], {
      book:      'Field Guide Vol. 1',
      page:      13,
      source_id: 42,
      raw:       'Field Guide Vol. 1',
    });
    assert.deepEqual(out.sources[1], {
      book:      'Field Guide Vol. 2',
      page:      120,
      source_id: 7,
      raw:       'Field Guide Vol. 2',
    });
  });
});

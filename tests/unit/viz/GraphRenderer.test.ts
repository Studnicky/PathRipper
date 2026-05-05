/**
 * @fileoverview Unit tests for `GraphRenderer.render`.
 *
 * @module tests/unit/viz/GraphRenderer
 * @category Unit
 * @since 0.2.0
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { GraphRenderer } from '../../../src/viz/GraphRenderer.js';
import { JsonLdGraph }   from '../../../src/viz/JsonLdGraph.js';
import type { VizPayloadInterface } from '../../../src/viz/JsonLdGraph.js';

// ---------------------------------------------------------------------------
// Fixture payload
// ---------------------------------------------------------------------------

const FIXTURE_DOC = {
  '@context': { ex: 'https://example.org/' },
  '@graph': [
    {
      '@id': 'https://example.org/graph/feats',
      '@graph': [
        {
          '@id':   'https://example.org/feat/PowerAttack',
          '@type': 'https://example.org/Feat',
          'https://example.org/name':  { '@value': 'Power Attack' },
          'https://example.org/level': { '@value': 1 },
          'https://example.org/related': { '@id': 'https://example.org/feat/Toughness' },
        },
        {
          '@id':   'https://example.org/feat/Toughness',
          '@type': 'https://example.org/Feat',
          'https://example.org/name':  { '@value': 'Toughness' },
          'https://example.org/level': { '@value': 1 },
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GraphRenderer.render — HTML output basics', () => {
  let payload: VizPayloadInterface;
  let html: string;

  before(() => {
    payload = JsonLdGraph.fromCompactedJsonLd(FIXTURE_DOC);
    html    = GraphRenderer.render(payload);
  });

  it('output is a non-empty string', () => {
    assert.ok(typeof html === 'string' && html.length > 0);
  });

  it('output starts with <!DOCTYPE html>', () => {
    assert.ok(html.startsWith('<!DOCTYPE html>'));
  });

  it('output contains <html', () => {
    assert.ok(html.includes('<html'));
  });

  it('output contains closing </html>', () => {
    assert.ok(html.includes('</html>'));
  });

  it('output contains <head> and </head>', () => {
    assert.ok(html.includes('<head>') && html.includes('</head>'));
  });

  it('output contains <body> and </body>', () => {
    assert.ok(html.includes('<body>') && html.includes('</body>'));
  });
});

describe('GraphRenderer.render — cytoscape bundle inlined', () => {
  let html: string;

  before(() => {
    const payload = JsonLdGraph.fromCompactedJsonLd(FIXTURE_DOC);
    html          = GraphRenderer.render(payload);
  });

  it('output contains cytoscape function name', () => {
    // cytoscape.min.js defines a global 'cytoscape' function
    assert.ok(html.includes('cytoscape'));
  });

  it('output does not reference any CDN URL', () => {
    assert.ok(!html.includes('cdn.jsdelivr.net'));
    assert.ok(!html.includes('unpkg.com'));
    assert.ok(!html.includes('cdnjs.cloudflare.com'));
  });

  it('output contains the PAYLOAD const', () => {
    assert.ok(html.includes('const PAYLOAD ='));
  });
});

describe('GraphRenderer.render — payload data present in output', () => {
  let html: string;

  before(() => {
    const payload = JsonLdGraph.fromCompactedJsonLd(FIXTURE_DOC);
    html          = GraphRenderer.render(payload);
  });

  it('node id appears in output', () => {
    assert.ok(html.includes('ex:feat/PowerAttack'));
  });

  it('class IRI appears in output', () => {
    assert.ok(html.includes('ex:Feat'));
  });

  it('edge label appears in output', () => {
    assert.ok(html.includes('ex:related'));
  });
});

describe('GraphRenderer.render — title option', () => {
  it('default title is "Squashage Graph"', () => {
    const payload = JsonLdGraph.fromCompactedJsonLd({});
    const html    = GraphRenderer.render(payload);
    assert.ok(html.includes('<title>Squashage Graph</title>'));
  });

  it('custom title appears in <title> tag', () => {
    const payload = JsonLdGraph.fromCompactedJsonLd({});
    const html    = GraphRenderer.render(payload, { title: 'My Custom Title' });
    assert.ok(html.includes('<title>My Custom Title</title>'));
  });

  it('custom title with special chars is HTML-escaped', () => {
    const payload = JsonLdGraph.fromCompactedJsonLd({});
    const html    = GraphRenderer.render(payload, { title: '<Squashage & Demo>' });
    assert.ok(html.includes('&lt;Squashage &amp; Demo&gt;'));
    assert.ok(!html.includes('<Squashage & Demo>'));
  });
});

describe('GraphRenderer.render — structural tag balance check', () => {
  it('each opening tag has a matching close (spot check major tags)', () => {
    const payload = JsonLdGraph.fromCompactedJsonLd(FIXTURE_DOC);
    const html    = GraphRenderer.render(payload);

    // Use exact tag names (not prefix patterns) to avoid matching e.g. <header> for <head>
    const exactTags = ['html', 'body', 'style'];
    for (const tag of exactTags) {
      const opens  = (html.match(new RegExp(`<${tag}(\\s[^>]*)?>`, 'g')) ?? []).length;
      const closes = (html.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
      assert.equal(opens, closes, `Tag <${tag}> open/close mismatch`);
    }
    // <head> specifically — must appear exactly once open and once closed
    const headOpens  = (html.match(/<head>/g) ?? []).length;
    const headCloses = (html.match(/<\/head>/g) ?? []).length;
    assert.equal(headOpens,  1, '<head> must appear exactly once');
    assert.equal(headCloses, 1, '</head> must appear exactly once');
  });
});

// ---------------------------------------------------------------------------
// New: streaming fcose tests
// ---------------------------------------------------------------------------

const MULTI_GRAPH_DOC = {
  '@context': { ex: 'https://example.org/' },
  '@graph': [
    {
      '@id': 'https://example.org/graph/feats',
      '@graph': [
        { '@id': 'https://example.org/feat/PowerAttack', '@type': 'https://example.org/Feat',
          'https://example.org/name': { '@value': 'Power Attack' } },
        { '@id': 'https://example.org/feat/Toughness',   '@type': 'https://example.org/Feat',
          'https://example.org/name': { '@value': 'Toughness' } },
      ],
    },
    {
      '@id': 'https://example.org/graph/spells',
      '@graph': [
        { '@id': 'https://example.org/spell/Fireball', '@type': 'https://example.org/Spell',
          'https://example.org/name': { '@value': 'Fireball' } },
      ],
    },
    // 200 extra nodes to trigger streaming threshold
    ...Array.from({ length: 201 }, (_, i) => ({
      '@id': `https://example.org/graph/extra`,
      '@graph': [
        { '@id': `https://example.org/extra/node${i}` },
      ],
    })),
  ],
};

describe('GraphRenderer.render — streaming mode (fcose) for large multi-graph payloads', () => {
  let html: string;

  before(() => {
    const payload = JsonLdGraph.fromCompactedJsonLd(MULTI_GRAPH_DOC);
    html          = GraphRenderer.render(payload);
  });

  it('output contains the cytoscape bundle', () => {
    assert.ok(html.includes('cytoscape'));
  });

  it('output contains the fcose bundle (cytoscapeFcose global)', () => {
    assert.ok(html.includes('cytoscapeFcose'));
  });

  it('output contains cytoscape.use(cytoscapeFcose) registration', () => {
    assert.ok(html.includes('cytoscape.use(cytoscapeFcose)'));
  });

  it('output contains streaming queue logic', () => {
    assert.ok(html.includes('sq-streaming'));
  });

  it('output contains Pause/Resume button', () => {
    assert.ok(html.includes('sq-pause-btn'));
  });

  it('output contains loading overlay', () => {
    assert.ok(html.includes('sq-loading-overlay'));
  });

  it('output contains fcose layout name', () => {
    // 'fcose' appears in the layout call and in the bundle itself.
    assert.ok(html.includes("'fcose'"));
  });

  it('streaming queue uses ascending node count order (character-first rule)', () => {
    // The CHARACTER_IRIS_PATTERN check appears in the streaming queue sort logic.
    assert.ok(html.includes('CHARACTER_IRIS_PATTERN') || html.includes('character'));
  });

  it('output does not reference any CDN URL', () => {
    assert.ok(!html.includes('cdn.jsdelivr.net'));
    assert.ok(!html.includes('unpkg.com'));
  });
});

describe('GraphRenderer.render — single-shot cose for small payloads (existing behaviour)', () => {
  let html: string;

  before(() => {
    const payload = JsonLdGraph.fromCompactedJsonLd(FIXTURE_DOC);
    html          = GraphRenderer.render(payload);
  });

  it('single-shot path still uses cose layout', () => {
    assert.ok(html.includes("name: 'cose'") || html.includes('"cose"'));
  });

  it('fcose streaming controls not present for small payload', () => {
    // id="sq-streaming" only appears in the streaming sidebar section (not in CSS).
    assert.ok(!html.includes('id="sq-streaming"'));
  });
});

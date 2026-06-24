import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { extractLinks, classifyLinks } from '../../../src/crawlers/CrawlLinks.js';

// ── extractLinks ──────────────────────────────────────────────────────────────

describe('extractLinks', () => {
  it('resolves relative href against baseUrl', () => {
    const html = '<html><body><a href="/foo">Foo</a></body></html>';
    const result = extractLinks(html, 'https://example.com');
    assert.deepEqual(result, ['https://example.com/foo']);
  });

  it('keeps absolute href unchanged', () => {
    const html = '<html><body><a href="https://other.test/bar">Bar</a></body></html>';
    const result = extractLinks(html, 'https://example.com');
    assert.deepEqual(result, ['https://other.test/bar']);
  });

  it('skips fragment-only href', () => {
    const html = '<html><body><a href="#section">Top</a></body></html>';
    const result = extractLinks(html, 'https://example.com');
    assert.deepEqual(result, []);
  });

  it('includes javascript: hrefs as valid absolute URLs (browser filters, not the extractor)', () => {
    // new URL('javascript:void(0)', base) succeeds — extractLinks is an extractor,
    // not a security filter. classifyLinks drops non-domain links downstream.
    const html = '<html><body><a href="javascript:void(0)">JS</a></body></html>';
    const result = extractLinks(html, 'https://example.com');
    assert.deepEqual(result, ['javascript:void(0)']);
  });

  it('returns empty array for HTML with no <a> tags', () => {
    const html = '<html><body><p>No links here</p></body></html>';
    const result = extractLinks(html, 'https://example.com');
    assert.deepEqual(result, []);
  });

  it('resolves multiple links, skips fragment-only hrefs, includes javascript: as valid URL', () => {
    // extractLinks skips '#'-prefixed hrefs only; javascript: is a valid URL scheme.
    // classifyLinks is responsible for domain filtering downstream.
    const html = '<html><body>'
      + '<a href="/spells">Spells</a>'
      + '<a href="#top">Top</a>'
      + '<a href="javascript:void(0)">JS</a>'
      + '<a href="https://other.test/page">Other</a>'
      + '</body></html>';
    const result = extractLinks(html, 'https://example.com');
    assert.deepEqual(result, [
      'https://example.com/spells',
      'javascript:void(0)',
      'https://other.test/page',
    ]);
  });

  it('resolves a path-relative href against the full base URL', () => {
    const html = '<html><body><a href="child">Child</a></body></html>';
    const result = extractLinks(html, 'https://example.com/parent/');
    assert.deepEqual(result, ['https://example.com/parent/child']);
  });
});

// ── classifyLinks ─────────────────────────────────────────────────────────────

describe('classifyLinks', () => {
  const domainRe    = /example\.com/;
  const delimiterRe = /category/;
  const targetRe    = /\?id=/;

  it('splits correctly into targets and traversables', () => {
    const links = [
      'https://example.com/category/item?id=1',   // target
      'https://example.com/category/a',            // traversable
      'https://other.test/category/item?id=1',     // dropped: fails domain
      'https://example.com/other/thing',            // dropped: fails delimiter
    ];
    const { targets, traversables } = classifyLinks(links, domainRe, delimiterRe, targetRe);
    assert.deepEqual(targets,      ['https://example.com/category/item?id=1']);
    assert.deepEqual(traversables, ['https://example.com/category/a']);
  });

  it('returns empty arrays for empty link list', () => {
    const { targets, traversables } = classifyLinks([], domainRe, delimiterRe, targetRe);
    assert.deepEqual(targets,      []);
    assert.deepEqual(traversables, []);
  });

  it('drops a link that matches target but not delimiter', () => {
    const links = ['https://example.com/other/item?id=1'];
    const { targets, traversables } = classifyLinks(links, domainRe, delimiterRe, targetRe);
    assert.deepEqual(targets,      []);
    assert.deepEqual(traversables, []);
  });

  it('classifies a link matching domain + delimiter + target as a target', () => {
    const links = [
      'https://example.com/category/item?id=99',
    ];
    const { targets, traversables } = classifyLinks(links, domainRe, delimiterRe, targetRe);
    assert.deepEqual(targets,      ['https://example.com/category/item?id=99']);
    assert.deepEqual(traversables, []);
  });

  it('drops a link that fails the domain check with an anchored domain pattern', () => {
    // Use an anchored pattern so "notexample.com" does not match "example.com".
    // The default /example\.com/ would match as a substring — this test uses
    // /^https:\/\/example\.com/ to assert the boundary behaviour.
    const anchoredDomainRe = /^https:\/\/example\.com/;
    const links = [
      'https://notexample.com/category/item?id=1',
    ];
    const { targets, traversables } = classifyLinks(links, anchoredDomainRe, delimiterRe, targetRe);
    assert.deepEqual(targets,      []);
    assert.deepEqual(traversables, []);
  });

  it('classifies multiple traversable links when none match targetRe', () => {
    const links = [
      'https://example.com/category/a',
      'https://example.com/category/b',
    ];
    const { targets, traversables } = classifyLinks(links, domainRe, delimiterRe, targetRe);
    assert.deepEqual(targets, []);
    assert.deepEqual(traversables, [
      'https://example.com/category/a',
      'https://example.com/category/b',
    ]);
  });
});

// Test suite for linkedAnchorList capability helper.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseLinkedAnchorList, type AnchorRef } from '../../../../../plugins/aonprd/capabilities/linkedAnchorList.js';

describe('parseLinkedAnchorList', () => {
  it('parses a comma-separated anchor list', () => {
    const html = '<a href="/languages.aspx?ID=1">Common</a>, <a href="/languages.aspx?ID=2">Draconic</a>';

    const result = parseLinkedAnchorList(html);

    assert.equal(result.length, 2);
    assert.deepEqual(result[0], {
      name: 'Common',
      href: '/languages.aspx?ID=1',
      aon_id: 1,
    });
    assert.deepEqual(result[1], {
      name: 'Draconic',
      href: '/languages.aspx?ID=2',
      aon_id: 2,
    });
  });

  it('handles anchors without ID query parameters', () => {
    const html = '<a href="/languages.aspx">Elvish</a>';

    const result = parseLinkedAnchorList(html);

    assert.equal(result.length, 1);
    assert.deepEqual(result[0], {
      name: 'Elvish',
      href: '/languages.aspx',
      aon_id: null,
    });
  });

  it('returns empty array for empty HTML', () => {
    const result = parseLinkedAnchorList('');

    assert.equal(result.length, 0);
  });

  it('extracts numeric ID from various query parameter formats', () => {
    const html = '<a href="/sources.aspx?ID=456">Advanced Manual</a>';

    const result = parseLinkedAnchorList(html);

    assert.equal(result.length, 1);
    assert.equal(result[0]!.aon_id, 456);
  });

  it('strips whitespace from anchor text', () => {
    const html = '<a href="/test.aspx?ID=1">  Spaced Text  </a>';

    const result = parseLinkedAnchorList(html);

    assert.equal(result.length, 1);
    assert.equal(result[0]!.name, 'Spaced Text');
  });
});
